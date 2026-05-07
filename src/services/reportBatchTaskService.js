const { GoogleAuth } = require('google-auth-library');
const scheduleReportService = require('./scheduleReportService');

let queueEnsured = false;
let queueEnsurePromise = null;

function getServiceAccountCredentials() {
  if (!process.env.GCP_SERVICE_ACCOUNT_KEY) {
    return null;
  }

  try {
    return JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY);
  } catch (error) {
    console.error('❌ Failed to parse GCP_SERVICE_ACCOUNT_KEY for Cloud Tasks:', error.message);
    return null;
  }
}

function getProjectId() {
  const credentials = getServiceAccountCredentials();
  return process.env.GOOGLE_CLOUD_PROJECT || credentials?.project_id || null;
}

function getQueueLocation() {
  return process.env.GCP_CLOUD_TASKS_LOCATION || 'us-central1';
}

function getQueueName() {
  return process.env.GCP_CLOUD_TASKS_QUEUE || 'report-batch-runs';
}

function getRunnerBaseUrl() {
  return process.env.REPORT_BATCH_RUNNER_URL
    || process.env.RENDER_EXTERNAL_URL
    || scheduleReportService.getApplicationBaseUrl();
}

function shouldUseLocalDispatch() {
  const runnerBaseUrl = getRunnerBaseUrl();
  return !getProjectId()
    || !runnerBaseUrl
    || /localhost|127\.0\.0\.1/i.test(runnerBaseUrl)
    || process.env.DISABLE_GCP_BATCH_TASKS === 'true';
}

function getQueuePath() {
  return `projects/${getProjectId()}/locations/${getQueueLocation()}/queues/${getQueueName()}`;
}

function getQueueUrl() {
  return `https://cloudtasks.googleapis.com/v2/${getQueuePath()}`;
}

function getDesiredQueueConfig() {
  return {
    rateLimits: {
      maxDispatchesPerSecond: Number(process.env.GCP_CLOUD_TASKS_MAX_DISPATCHES_PER_SECOND || 3),
      // Default to serial execution so large report groups do not overlap on the same Render instance.
      maxConcurrentDispatches: Number(process.env.GCP_CLOUD_TASKS_MAX_CONCURRENT_DISPATCHES || 1)
    },
    retryConfig: {
      maxAttempts: Number(process.env.GCP_CLOUD_TASKS_MAX_ATTEMPTS || 3),
      maxRetryDuration: '3600s'
    }
  };
}

async function getAccessToken() {
  const credentials = getServiceAccountCredentials();
  const auth = new GoogleAuth({
    credentials: credentials || undefined,
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });

  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  return typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;
}

async function fetchCloudTasks(url, options = {}) {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Failed to acquire Google Cloud access token');
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  return fetch(url, {
    ...options,
    headers
  });
}

async function syncQueueConfiguration(queueUrl) {
  const updateMask = [
    'rateLimits.maxDispatchesPerSecond',
    'rateLimits.maxConcurrentDispatches',
    'retryConfig.maxAttempts',
    'retryConfig.maxRetryDuration'
  ].join(',');
  const response = await fetchCloudTasks(`${queueUrl}?updateMask=${encodeURIComponent(updateMask)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name: getQueuePath(),
      ...getDesiredQueueConfig()
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to update Cloud Tasks queue: ${response.status} ${errorText}`);
  }

  return response.json();
}

async function ensureQueueExists() {
  if (shouldUseLocalDispatch()) {
    return { dispatchType: 'local' };
  }

  if (queueEnsured) {
    return { dispatchType: 'cloud-tasks', queuePath: getQueuePath() };
  }

  if (queueEnsurePromise) {
    return queueEnsurePromise;
  }

  queueEnsurePromise = (async () => {
    const queueUrl = getQueueUrl();
    const existingResponse = await fetchCloudTasks(queueUrl, { method: 'GET' });

    if (existingResponse.ok) {
      await syncQueueConfiguration(queueUrl);
      queueEnsured = true;
      return { dispatchType: 'cloud-tasks', queuePath: getQueuePath() };
    }

    if (existingResponse.status !== 404) {
      const errorText = await existingResponse.text();
      throw new Error(`Failed to inspect Cloud Tasks queue: ${existingResponse.status} ${errorText}`);
    }

    const createUrl = `https://cloudtasks.googleapis.com/v2/projects/${getProjectId()}/locations/${getQueueLocation()}/queues`;
    const createResponse = await fetchCloudTasks(createUrl, {
      method: 'POST',
      body: JSON.stringify({
        name: getQueuePath(),
        ...getDesiredQueueConfig()
      })
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Failed to create Cloud Tasks queue: ${createResponse.status} ${errorText}`);
    }

    queueEnsured = true;
    return { dispatchType: 'cloud-tasks', queuePath: getQueuePath() };
  })();

  try {
    return await queueEnsurePromise;
  } finally {
    queueEnsurePromise = null;
  }
}

async function dispatchLocally(item) {
  const targetUrl = `${scheduleReportService.getApplicationBaseUrl()}/api/report-batches/items/${item.id}/execute`;
  const headers = {
    'Content-Type': 'application/json'
  };

  if (process.env.SCHEDULER_API_KEY) {
    headers['X-API-Key'] = process.env.SCHEDULER_API_KEY;
  }

  setTimeout(() => {
    fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ itemId: item.id })
    }).catch(error => {
      console.error(`❌ Local batch item dispatch failed for item ${item.id}:`, error.message);
    });
  }, 0);

  return {
    dispatchType: 'local',
    taskName: `local-batch-${item.batch_run_id}-item-${item.id}`
  };
}

async function enqueueCloudTask(item) {
  await ensureQueueExists();

  const taskName = `batch-${item.batch_run_id}-item-${item.id}`;
  const targetUrl = `${getRunnerBaseUrl()}/api/report-batches/items/${item.id}/execute`;
  const createTaskUrl = `${getQueueUrl()}/tasks`;
  const headers = {
    'Content-Type': 'application/json'
  };

  if (process.env.SCHEDULER_API_KEY) {
    headers['X-API-Key'] = process.env.SCHEDULER_API_KEY;
  }

  const response = await fetchCloudTasks(createTaskUrl, {
    method: 'POST',
    body: JSON.stringify({
      task: {
        name: `${getQueuePath()}/tasks/${taskName}`,
        httpRequest: {
          httpMethod: 'POST',
          url: targetUrl,
          headers,
          body: Buffer.from(JSON.stringify({ itemId: item.id })).toString('base64')
        }
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 409) {
      return {
        dispatchType: 'cloud-tasks',
        taskName
      };
    }
    throw new Error(`Failed to enqueue Cloud Task: ${response.status} ${errorText}`);
  }

  return {
    dispatchType: 'cloud-tasks',
    taskName
  };
}

async function enqueueBatchItem(item) {
  if (shouldUseLocalDispatch()) {
    return dispatchLocally(item);
  }

  return enqueueCloudTask(item);
}

async function enqueueBatchItems(items) {
  const results = [];

  for (const item of items) {
    const result = await enqueueBatchItem(item);
    results.push({
      itemId: item.id,
      ...result
    });
  }

  return results;
}

module.exports = {
  getProjectId,
  getQueueLocation,
  getQueueName,
  getRunnerBaseUrl,
  shouldUseLocalDispatch,
  ensureQueueExists,
  enqueueBatchItem,
  enqueueBatchItems
};
