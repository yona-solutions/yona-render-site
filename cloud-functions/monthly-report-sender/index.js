/**
 * Monthly Report Sender - Google Cloud Function
 *
 * This function is triggered once a month by Cloud Scheduler.
 * It fetches all enabled report schedules and sends emails to all recipients.
 *
 * Environment Variables Required:
 *   - API_BASE_URL: Base URL of the production API (e.g., https://your-app.onrender.com)
 *   - SCHEDULER_API_KEY: API key for authenticating with the scheduler endpoint
 */

const https = require('https');
const http = require('http');

/**
 * Main Cloud Function entry point
 * Triggered by Cloud Scheduler via HTTP
 */
exports.sendMonthlyReports = async (req, res) => {
  const startTime = Date.now();
  const runId = `run_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  console.log('========================================');
  console.log(`Monthly Report Sender - Starting`);
  console.log(`Run ID: ${runId}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('========================================');

  // Validate environment
  const apiBaseUrl = process.env.API_BASE_URL;
  const apiKey = process.env.SCHEDULER_API_KEY;

  if (!apiBaseUrl) {
    const error = 'Missing required environment variable: API_BASE_URL';
    console.error(`ERROR: ${error}`);
    return res.status(500).json({
      success: false,
      error,
      runId
    });
  }

  if (!apiKey) {
    const error = 'Missing required environment variable: SCHEDULER_API_KEY';
    console.error(`ERROR: ${error}`);
    return res.status(500).json({
      success: false,
      error,
      runId
    });
  }

  console.log(`API Base URL: ${apiBaseUrl}`);

  try {
    // Step 1: Fetch all enabled schedules
    console.log('\n--- Step 1: Fetching enabled schedules ---');
    const schedules = await fetchEnabledSchedules(apiBaseUrl, apiKey);

    if (schedules.length === 0) {
      console.log('No enabled schedules found. Exiting.');
      return res.status(200).json({
        success: true,
        message: 'No enabled schedules to process',
        schedulesProcessed: 0,
        runId,
        durationMs: Date.now() - startTime
      });
    }

    console.log(`Found ${schedules.length} enabled schedule(s):`);
    schedules.forEach(s => {
      console.log(`  - [${s.id}] ${s.template_name} (${s.template_type}/${s.process})`);
    });

    // Step 2: Process each schedule
    console.log('\n--- Step 2: Processing schedules ---');
    const results = [];
    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;

    for (const schedule of schedules) {
      console.log(`\nProcessing schedule: ${schedule.template_name} (ID: ${schedule.id})`);

      try {
        const result = await processSchedule(apiBaseUrl, apiKey, schedule);
        results.push(result);

        if (result.status === 'success') {
          successCount++;
          console.log(`  SUCCESS: ${result.emailsSent} email(s) sent`);
        } else if (result.status === 'partial') {
          successCount++; // Count as success since some emails went out
          console.log(`  PARTIAL: ${result.emailsSent} sent, ${result.emailsFailed} failed`);
        } else if (result.status === 'skipped') {
          skipCount++;
          console.log(`  SKIPPED: ${result.skipReason}`);
        } else {
          failCount++;
          console.log(`  FAILED: ${result.error}`);
        }
      } catch (error) {
        failCount++;
        const errorResult = {
          scheduleId: schedule.id,
          scheduleName: schedule.template_name,
          status: 'error',
          error: error.message
        };
        results.push(errorResult);
        console.error(`  ERROR: ${error.message}`);
        // Continue to next schedule - don't let one failure stop others
      }
    }

    // Step 3: Summary
    const durationMs = Date.now() - startTime;
    console.log('\n========================================');
    console.log('Monthly Report Sender - Complete');
    console.log(`Run ID: ${runId}`);
    console.log(`Duration: ${durationMs}ms`);
    console.log(`Results: ${successCount} success, ${failCount} failed, ${skipCount} skipped`);
    console.log('========================================');

    const totalEmailsSent = results.reduce((sum, r) => sum + (r.emailsSent || 0), 0);
    const totalEmailsFailed = results.reduce((sum, r) => sum + (r.emailsFailed || 0), 0);

    return res.status(200).json({
      success: failCount === 0,
      message: failCount === 0
        ? 'All schedules processed successfully'
        : `Completed with ${failCount} failure(s)`,
      runId,
      durationMs,
      summary: {
        schedulesProcessed: schedules.length,
        successful: successCount,
        failed: failCount,
        skipped: skipCount,
        totalEmailsSent,
        totalEmailsFailed
      },
      results
    });

  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error('\n========================================');
    console.error('Monthly Report Sender - FAILED');
    console.error(`Run ID: ${runId}`);
    console.error(`Error: ${error.message}`);
    console.error(`Stack: ${error.stack}`);
    console.error('========================================');

    return res.status(500).json({
      success: false,
      error: error.message,
      runId,
      durationMs
    });
  }
};

/**
 * Fetch all enabled schedules from the API
 */
async function fetchEnabledSchedules(baseUrl, apiKey) {
  const url = `${baseUrl}/api/report-schedules`;
  console.log(`Fetching schedules from: ${url}`);

  const response = await makeRequest(url, {
    method: 'GET',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch schedules: ${response.status} ${response.statusText}`);
  }

  const allSchedules = response.data;

  // Filter to only enabled schedules
  const enabledSchedules = allSchedules.filter(s => s.enabled === true);

  return enabledSchedules;
}

/**
 * Process a single schedule - calls the API to generate and send emails
 */
async function processSchedule(baseUrl, apiKey, schedule) {
  // Validate schedule has required configuration
  if (!schedule.template_type || !schedule.process) {
    return {
      scheduleId: schedule.id,
      scheduleName: schedule.template_name,
      status: 'skipped',
      skipReason: 'Missing template_type or process configuration'
    };
  }

  // Get entity ID based on template type
  let entityId;
  if (schedule.template_type === 'district') {
    entityId = schedule.district_id;
  } else if (schedule.template_type === 'region') {
    entityId = schedule.region_id;
  } else if (schedule.template_type === 'subsidiary') {
    entityId = schedule.subsidiary_id;
  }

  if (!entityId) {
    return {
      scheduleId: schedule.id,
      scheduleName: schedule.template_name,
      status: 'skipped',
      skipReason: `No ${schedule.template_type} selected`
    };
  }

  // Check for email groups
  const emailGroupIds = schedule.email_group_ids || [];
  if (emailGroupIds.length === 0 && !schedule.email_group_id) {
    return {
      scheduleId: schedule.id,
      scheduleName: schedule.template_name,
      status: 'skipped',
      skipReason: 'No email groups assigned'
    };
  }

  // Call the process-schedule endpoint
  const url = `${baseUrl}/api/report-schedules/${schedule.id}/process`;
  console.log(`  Calling: POST ${url}`);

  const response = await makeRequest(url, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      triggerType: 'scheduled'
    })
  });

  if (!response.ok) {
    // Try to parse error message from response
    let errorMsg = `API returned ${response.status}`;
    if (response.data && response.data.error) {
      errorMsg = response.data.error;
    } else if (response.data && response.data.message) {
      errorMsg = response.data.message;
    }

    return {
      scheduleId: schedule.id,
      scheduleName: schedule.template_name,
      status: 'error',
      error: errorMsg
    };
  }

  // Return the result from the API
  return {
    scheduleId: schedule.id,
    scheduleName: schedule.template_name,
    status: response.data.status || 'success',
    emailsSent: response.data.emailsSent || 0,
    emailsFailed: response.data.emailsFailed || 0,
    skipReason: response.data.skipReason,
    error: response.data.error
  };
}

/**
 * Make an HTTP/HTTPS request
 * Returns { ok: boolean, status: number, statusText: string, data: any }
 */
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const lib = isHttps ? https : http;

    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 300000 // 5 minute timeout
    };

    const req = lib.request(requestOptions, (res) => {
      let data = '';

      res.on('data', chunk => {
        data += chunk;
      });

      res.on('end', () => {
        let parsedData;
        try {
          parsedData = JSON.parse(data);
        } catch (e) {
          parsedData = data;
        }

        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage,
          data: parsedData
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

/**
 * Health check endpoint for monitoring
 */
exports.healthCheck = async (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    env: {
      hasApiBaseUrl: !!process.env.API_BASE_URL,
      hasApiKey: !!process.env.SCHEDULER_API_KEY
    }
  });
};
