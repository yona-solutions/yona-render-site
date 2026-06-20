/**
 * GCS-to-BigQuery Loader - Google Cloud Function
 *
 * Full pipeline:
 *   1. Trigger NetSuite saved search export → GCS (via RESTlet + Map/Reduce)
 *   2. Load the exported CSVs from GCS into BigQuery (raw_netsuite_gcs_export)
 *   3. Delete the exported files from GCS
 *   4. Trigger Fivetran dbt transformation
 *   5. Export dimension configs (region, vendor, time) to GCS
 *
 * Each run uses a unique prefix (run_YYYYMMDD_HHmmss/) in the GCS bucket so
 * the loader only reads files from that specific run.
 *
 * Triggered via HTTP (Cloud Scheduler or manual).
 */

const crypto  = require('crypto');
const sgMail = require('@sendgrid/mail');
const { BigQuery } = require('@google-cloud/bigquery');
const { Storage }  = require('@google-cloud/storage');
const { Pool }     = require('pg');

// ── GCS / BigQuery ────────────────────────────────────────────────────────────
const BUCKET_NAME   = 'yona-csv-uploads';
const DATASET_ID    = 'raw_netsuite_gcs_export';
const PROJECT_ID    = 'yona-solutions-poc';
const STATUS_OBJECT = '__gcs_import_status.json';
const GCS_IMPORT_LOG_TABLE = 'gcs_import_logs';
const DEFAULT_SENDER_NAME = 'Yona Solutions SPHERE';

// ── NetSuite ──────────────────────────────────────────────────────────────────
const NETSUITE_RESTLET_URL =
  'https://5975228.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=1858&deploy=1';
const NETSUITE_GCS_POLL_INTERVAL_MS = 30_000; // 30 s between GCS checks
const NETSUITE_GCS_MAX_ROUNDS       = 40;     // 20 min max (40 × 30s)

// ── Fivetran ──────────────────────────────────────────────────────────────────
const FIVETRAN_API_BASE   = 'https://api.fivetran.com/v1';
const TRANSFORMATION_ID   = 'justness_luminous';

// ── Dimension export ──────────────────────────────────────────────────────────
const DIMENSION_BUCKET = 'dimension_configurations';
const DBT_DATASET      = 'dbt_production';

const DIMENSION_CONFIGS = [
  {
    name:              'Region',
    table:             'dim_regions',
    idCol:             'region_id',
    labelCol:          'display_name',
    internalIdField:   'region_internal_id',
    extraSelectColumns: ['parent_id', 'is_root_region', 'is_leaf_region'],
    outputFile:        'region_config.json',
  },
  {
    name:              'Vendor',
    table:             'dim_vendors',
    idCol:             'vendor_id',
    labelCol:          'display_name',
    internalIdField:   'vendor_internal_id',
    outputFile:        'vendor_config.json',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildRunId() {
  const now = new Date();
  const p   = n => String(n).padStart(2, '0');
  return `run_${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

function normalizeEmail(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

function isCloudSchedulerRequest(req) {
  const schedulerHeader = String(req.get?.('X-CloudScheduler') || req.headers?.['x-cloudscheduler'] || '').toLowerCase();
  const userAgent = String(req.get?.('User-Agent') || req.headers?.['user-agent'] || '');
  return schedulerHeader === 'true' || userAgent.includes('Google-Cloud-Scheduler');
}

function getTriggerType(req) {
  const explicitTriggerType = String(req.body?.triggerType || req.query?.triggerType || '').trim().toLowerCase();
  if (explicitTriggerType) {
    return explicitTriggerType;
  }

  return isCloudSchedulerRequest(req) ? 'scheduled' : 'manual';
}

function getSource(req) {
  const explicitSource = String(req.body?.source || req.query?.source || '').trim().toLowerCase();
  if (explicitSource) {
    return explicitSource;
  }

  return isCloudSchedulerRequest(req) ? 'cloud_scheduler' : 'http';
}

function getInitiatedByEmail(req) {
  return normalizeEmail(req.body?.initiatedByEmail || req.query?.initiatedByEmail);
}

function createPool() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return null;
  }

  return new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    max: 1,
    idleTimeoutMillis: 5000,
  });
}

function getEmailConfig() {
  const apiKey = process.env.SENDGRID_API_KEY;
  const senderEmail = process.env.SENDER_EMAIL;
  const senderName = process.env.SENDER_NAME || DEFAULT_SENDER_NAME;

  if (!apiKey || !senderEmail) {
    return null;
  }

  sgMail.setApiKey(apiKey);
  return { senderEmail, senderName };
}

async function fetchAdminRecipientEmails(pool) {
  if (!pool) {
    console.warn('DATABASE_URL not set - skipping admin sync completion email recipients lookup');
    return [];
  }

  const result = await pool.query(`
    SELECT DISTINCT LOWER(BTRIM(email)) AS email
    FROM user_roles
    WHERE LOWER(role) = 'admin'
      AND email IS NOT NULL
      AND BTRIM(email) <> ''
    ORDER BY 1
  `);

  return result.rows
    .map(row => row.email)
    .filter(email => typeof email === 'string' && email.length > 0);
}

function buildRecipientList(adminRecipients, initiatedByEmail) {
  const uniqueRecipients = new Set();
  const recipients = [];

  for (const candidate of [...adminRecipients, initiatedByEmail]) {
    const email = normalizeEmail(candidate);
    if (!email || uniqueRecipients.has(email)) {
      continue;
    }

    uniqueRecipients.add(email);
    recipients.push(email);
  }

  return recipients;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatCount(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 'Unknown';
  }

  return numericValue.toLocaleString('en-US');
}

function formatDurationSeconds(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 'Unknown';
  }

  return `${numericValue.toFixed(1)} seconds`;
}

function getInitiatorLabel(initiatedByEmail, triggerType, source) {
  if (initiatedByEmail) {
    return initiatedByEmail;
  }

  if (triggerType === 'scheduled' || source === 'cloud_scheduler') {
    return 'Scheduler';
  }

  if (triggerType === 'manual' || source === 'sphere_ui') {
    return 'Manual / Unknown';
  }

  return 'System';
}

function getCompletionOutcome({ finalStatus, transformationStatus, dimensionExportStatus }) {
  if (finalStatus === 'failed') {
    return 'failed';
  }

  if (transformationStatus && transformationStatus !== 'succeeded') {
    return 'completed_with_issues';
  }

  if (dimensionExportStatus && dimensionExportStatus !== 'success') {
    return 'completed_with_issues';
  }

  return 'completed_successfully';
}

function buildSyncCompletionEmail({
  runId,
  initiatedByEmail,
  triggerType,
  source,
  startedAt,
  completedAt,
  durationSeconds,
  finalStatus,
  tablesLoaded,
  transformationStatus,
  dimensionExportStatus,
  error,
}) {
  const outcome = getCompletionOutcome({ finalStatus, transformationStatus, dimensionExportStatus });
  const initiatorLabel = getInitiatorLabel(initiatedByEmail, triggerType, source);
  const subject = outcome === 'failed'
    ? 'SPHERE NetSuite sync failed'
    : outcome === 'completed_with_issues'
      ? 'SPHERE NetSuite sync completed with issues'
      : 'SPHERE NetSuite sync completed successfully';

  const tableEntries = Object.entries(tablesLoaded || {});
  const tableTextLines = tableEntries.length > 0
    ? tableEntries.map(([tableName, info]) => `- ${tableName}: ${formatCount(info?.rows)} rows across ${formatCount(info?.files)} file(s)`)
    : ['- No tables were recorded'];
  const tableHtmlRows = tableEntries.length > 0
    ? tableEntries.map(([tableName, info]) => `
        <tr>
          <td>${escapeHtml(tableName)}</td>
          <td>${escapeHtml(formatCount(info?.rows))}</td>
          <td>${escapeHtml(formatCount(info?.files))}</td>
        </tr>
      `).join('')
    : `
        <tr>
          <td colspan="3">No tables were recorded</td>
        </tr>
      `;

  const text = [
    'Hello,',
    '',
    `The SPHERE NetSuite sync ${outcome.replaceAll('_', ' ')}.`,
    '',
    `Run ID: ${runId}`,
    `Initiated by: ${initiatorLabel}`,
    `Trigger type: ${triggerType || 'unknown'}`,
    `Source: ${source || 'unknown'}`,
    `Started at (UTC): ${startedAt || 'Unknown'}`,
    `Completed at (UTC): ${completedAt || 'Unknown'}`,
    `Duration: ${formatDurationSeconds(durationSeconds)}`,
    `Transformation status: ${transformationStatus || 'not run'}`,
    `Dimension export status: ${dimensionExportStatus || 'skipped'}`,
    '',
    'Loaded tables:',
    ...tableTextLines,
    error ? '' : null,
    error ? `Error: ${error}` : null,
    '',
    'Best regards,',
    'Yona Solutions SPHERE',
  ].filter(line => line !== null).join('\n');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 720px;
          margin: 0 auto;
          padding: 20px;
        }
        table {
          border-collapse: collapse;
          width: 100%;
          margin: 16px 0;
        }
        th, td {
          padding: 8px 10px;
          border: 1px solid #d9d9d9;
          text-align: left;
        }
        th {
          background: #f7f7f7;
          width: 220px;
        }
        .status {
          font-weight: 600;
        }
        .status.failed {
          color: #b91c1c;
        }
        .status.issues {
          color: #92400e;
        }
        .status.success {
          color: #166534;
        }
      </style>
    </head>
    <body>
      <p>Hello,</p>
      <p class="status ${outcome === 'failed' ? 'failed' : outcome === 'completed_with_issues' ? 'issues' : 'success'}">
        The SPHERE NetSuite sync ${escapeHtml(outcome.replaceAll('_', ' '))}.
      </p>
      <table>
        <tr><th>Run ID</th><td>${escapeHtml(runId)}</td></tr>
        <tr><th>Initiated by</th><td>${escapeHtml(initiatorLabel)}</td></tr>
        <tr><th>Trigger type</th><td>${escapeHtml(triggerType || 'unknown')}</td></tr>
        <tr><th>Source</th><td>${escapeHtml(source || 'unknown')}</td></tr>
        <tr><th>Started at (UTC)</th><td>${escapeHtml(startedAt || 'Unknown')}</td></tr>
        <tr><th>Completed at (UTC)</th><td>${escapeHtml(completedAt || 'Unknown')}</td></tr>
        <tr><th>Duration</th><td>${escapeHtml(formatDurationSeconds(durationSeconds))}</td></tr>
        <tr><th>Transformation status</th><td>${escapeHtml(transformationStatus || 'not run')}</td></tr>
        <tr><th>Dimension export status</th><td>${escapeHtml(dimensionExportStatus || 'skipped')}</td></tr>
        ${error ? `<tr><th>Error</th><td>${escapeHtml(error)}</td></tr>` : ''}
      </table>
      <p><strong>Loaded tables</strong></p>
      <table>
        <thead>
          <tr>
            <th>Table</th>
            <th>Rows</th>
            <th>Files</th>
          </tr>
        </thead>
        <tbody>${tableHtmlRows}</tbody>
      </table>
      <p>Best regards,<br>Yona Solutions SPHERE</p>
    </body>
    </html>
  `;

  return { subject, text, html };
}

async function sendSyncCompletionEmail(notificationData) {
  const emailConfig = getEmailConfig();
  if (!emailConfig) {
    return {
      attempted: false,
      delivered: false,
      reason: 'sendgrid_not_configured',
    };
  }

  let pool = null;
  try {
    pool = createPool();
    const adminRecipients = await fetchAdminRecipientEmails(pool);
    const recipients = buildRecipientList(adminRecipients, notificationData.initiatedByEmail);
    if (recipients.length === 0) {
      return {
        attempted: false,
        delivered: false,
        reason: 'no_recipients_found',
      };
    }

    const { subject, text, html } = buildSyncCompletionEmail(notificationData);
    const sendResults = await Promise.allSettled(
      recipients.map(recipientEmail =>
        sgMail.send({
          to: recipientEmail,
          from: {
            email: emailConfig.senderEmail,
            name: emailConfig.senderName,
          },
          subject,
          text,
          html,
        })
      )
    );

    const deliveredRecipients = [];
    const failedRecipients = [];
    sendResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        deliveredRecipients.push(recipients[index]);
        return;
      }

      failedRecipients.push({
        email: recipients[index],
        error: result.reason?.message || String(result.reason || 'Unknown error'),
      });
    });

    return {
      attempted: true,
      delivered: failedRecipients.length === 0,
      recipientCount: recipients.length,
      deliveredRecipients,
      failedRecipients,
    };
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

/**
 * Build an OAuth 1.0a HMAC-SHA256 Authorization header for a NetSuite RESTlet call.
 * IMPORTANT: query string params must be included in the signature base string.
 */
function oauth1Header(method, fullUrl) {
  const accountId      = process.env.NETSUITE_ACCOUNT_ID;
  const consumerKey    = process.env.NETSUITE_CONSUMER_KEY;
  const consumerSecret = process.env.NETSUITE_CONSUMER_SECRET;
  const tokenId        = process.env.NETSUITE_TOKEN_ID;
  const tokenSecret    = process.env.NETSUITE_TOKEN_SECRET;

  const url     = new URL(fullUrl);
  const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;

  const queryParams = {};
  url.searchParams.forEach((v, k) => { queryParams[k] = v; });

  const oauthParams = {
    oauth_consumer_key:     consumerKey,
    oauth_token:            tokenId,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp:        String(Math.floor(Date.now() / 1000)),
    oauth_nonce:            crypto.randomBytes(16).toString('hex'),
    oauth_version:          '1.0',
  };

  const allParams    = { ...queryParams, ...oauthParams };
  const sortedParams = Object.keys(allParams)
    .sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
    .join('&');

  const baseString = `${method}&${encodeURIComponent(baseUrl)}&${encodeURIComponent(sortedParams)}`;
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;

  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(baseString)
    .digest('base64');

  oauthParams.oauth_signature = signature;

  const parts = [
    `OAuth realm="${accountId}"`,
    ...Object.entries(oauthParams).map(([k, v]) => `${k}="${encodeURIComponent(v)}"`),
  ];
  return parts.join(', ');
}

/**
 * POST to the NetSuite RESTlet to kick off the Map/Reduce export job.
 * Returns the taskId.
 */
async function triggerNetsuiteExport(runPrefix) {
  console.log(`  Triggering NetSuite export with prefix "${runPrefix}"...`);
  const header = oauth1Header('POST', NETSUITE_RESTLET_URL);

  const res = await fetch(NETSUITE_RESTLET_URL, {
    method: 'POST',
    headers: {
      'Authorization': header,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ gcsPathPrefix: runPrefix, gcsUploadBaseUrl: '' }),
  });

  const rawText = await res.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (_) {
    throw new Error(`NetSuite trigger failed (${res.status}): ${rawText.slice(0, 300)}`);
  }
  if (!res.ok || !data.success) {
    throw new Error(`NetSuite trigger failed (${res.status}): ${data.message || JSON.stringify(data)}`);
  }

  console.log(`  NetSuite job submitted. taskId: ${data.taskId}`);
  return data.taskId;
}

/**
 * Poll GCS for the _complete.json marker written by the Map/Reduce summarize function.
 * Throws if the marker indicates errors or if we time out.
 */
async function pollNetsuiteJobViaGCS(runPrefix) {
  const storage    = new Storage({ projectId: PROJECT_ID });
  const bucket     = storage.bucket(BUCKET_NAME);
  const markerFile = bucket.file(`${runPrefix}_complete.json`);

  for (let i = 0; i < NETSUITE_GCS_MAX_ROUNDS; i++) {
    await new Promise(r => setTimeout(r, NETSUITE_GCS_POLL_INTERVAL_MS));

    const [exists] = await markerFile.exists();
    console.log(`  GCS poll ${i + 1}/${NETSUITE_GCS_MAX_ROUNDS}: _complete.json ${exists ? 'FOUND' : 'not yet'}`);

    if (exists) {
      const [contents] = await markerFile.download();
      const marker = JSON.parse(contents.toString());
      if (!marker.success) {
        throw new Error(`NetSuite Map/Reduce reported errors. completedAt: ${marker.completedAt}`);
      }
      console.log(`  NetSuite export complete. completedAt: ${marker.completedAt}`);
      return;
    }
  }

  throw new Error(
    `NetSuite export timed out after ${(NETSUITE_GCS_MAX_ROUNDS * NETSUITE_GCS_POLL_INTERVAL_MS) / 60_000} min — _complete.json never appeared.`
  );
}

// ── Dimension export ──────────────────────────────────────────────────────────

function baseDimensionNode(label, parent, internalIdKey, internalIdValue) {
  return {
    parent,
    label,
    tags: [],
    isDistrict: false,
    aggregation: null,
    type: 'BASIC',
    active: true,
    hasChildren: false,
    rollupType: null,
    writeProtection: 'NONE',
    [internalIdKey]: internalIdValue,
    displayExcluded: false,
    doubleLines: false,
    operationalExcluded: false,
  };
}

function formatDimensionExportLabel(cfg, row) {
  const label = row.label;

  if (cfg.name === 'Region' && row.is_leaf_region === false) {
    return `${label} (parent)`;
  }

  return label;
}

function applyDimensionExportMetadata(cfg, node, row) {
  if (cfg.name !== 'Region') {
    return;
  }

  if (row.parent_id !== null && row.parent_id !== undefined) {
    node.sourceParentRegionId = row.parent_id;
  }
  if (row.is_root_region !== null && row.is_root_region !== undefined) {
    node.isRootRegion = row.is_root_region;
  }
  if (row.is_leaf_region !== null && row.is_leaf_region !== undefined) {
    node.isLeafRegion = row.is_leaf_region;
  }
}

async function exportDimensionConfigs(bigquery, storage) {
  const results = [];

  for (const cfg of DIMENSION_CONFIGS) {
    let idCounter = 0;
    const nextId = () => (++idCounter).toString();

    const extraSelect = Array.isArray(cfg.extraSelectColumns) && cfg.extraSelectColumns.length > 0
      ? `,\n        ${cfg.extraSelectColumns.join(',\n        ')}`
      : '';

    const query = `
      SELECT
        ${cfg.idCol} AS source_id,
        ${cfg.labelCol} AS label
        ${extraSelect}
      FROM \`${PROJECT_ID}.${DBT_DATASET}.${cfg.table}\`
      WHERE ${cfg.labelCol} IS NOT NULL
    `;

    const [rows] = await bigquery.query({ query });
    const out = {};

    const rootId = nextId();
    out[rootId] = baseDimensionNode(cfg.name, null, cfg.internalIdField, null);
    out[rootId].hasChildren = true;

    const allId = nextId();
    out[allId] = baseDimensionNode(`All ${cfg.name}s`, rootId, cfg.internalIdField, null);
    out[allId].hasChildren = true;

    rows.forEach(r => {
      const id = nextId();
      const node = baseDimensionNode(
        formatDimensionExportLabel(cfg, r),
        allId,
        cfg.internalIdField,
        r.source_id
      );
      applyDimensionExportMetadata(cfg, node, r);
      out[id] = node;
    });

    const bucket = storage.bucket(DIMENSION_BUCKET);
    await bucket.file(cfg.outputFile).save(JSON.stringify(out, null, 2), {
      contentType: 'application/json',
      resumable: false,
    });

    results.push({ config: cfg.name, count: Object.keys(out).length, file: `gs://${DIMENSION_BUCKET}/${cfg.outputFile}` });
  }

  // Time config (Year -> Quarter -> Month)
  {
    let idCounter = 0;
    const nextId = () => (++idCounter).toString();

    const query = `
      SELECT
        time_internal_id,
        time_date,
        posting_period,
        EXTRACT(YEAR FROM time_date) AS yr,
        EXTRACT(QUARTER FROM time_date) AS qtr,
        LAST_DAY(time_date) AS month_end,
        DATE_TRUNC(time_date, QUARTER) AS quarter_start,
        DATE_SUB(DATE_ADD(DATE_TRUNC(time_date, QUARTER), INTERVAL 3 MONTH), INTERVAL 1 DAY) AS quarter_end,
        DATE_TRUNC(time_date, YEAR) AS year_start,
        DATE_SUB(DATE_ADD(DATE_TRUNC(time_date, YEAR), INTERVAL 1 YEAR), INTERVAL 1 DAY) AS year_end
      FROM \`${PROJECT_ID}.${DBT_DATASET}.dim_time\`
      WHERE posting_period IS NOT NULL
      ORDER BY time_date
    `;

    const [rows] = await bigquery.query({ query });
    const out = {};
    const INTERNAL_ID_KEY  = 'time_internal_id';
    const yearIdByYear     = new Map();
    const quarterIdByYearQ = new Map();
    const twoDigitYear     = yr => String(yr).slice(-2);
    const quarterLabel     = (yr, qtr) => `Q${qtr}-${twoDigitYear(yr)}`;

    for (const r of rows) {
      const yr   = r.yr;
      const qtr  = r.qtr;
      const yKey = String(yr);
      const qKey = `${yr}-Q${qtr}`;

      if (!yearIdByYear.has(yKey)) {
        const yId = nextId();
        yearIdByYear.set(yKey, yId);
        out[yId] = baseDimensionNode(String(yr), null, INTERNAL_ID_KEY, null);
        out[yId].hasChildren = true;
        out[yId].startDate   = r.year_start?.value || r.year_start;
        out[yId].endDate     = r.year_end?.value   || r.year_end;
        out[yId].granularity = 'YEAR';
      }

      if (!quarterIdByYearQ.has(qKey)) {
        const qId = nextId();
        quarterIdByYearQ.set(qKey, qId);
        out[qId] = baseDimensionNode(quarterLabel(yr, qtr), yearIdByYear.get(yKey), INTERNAL_ID_KEY, null);
        out[qId].hasChildren = true;
        out[qId].startDate   = r.quarter_start?.value || r.quarter_start;
        out[qId].endDate     = r.quarter_end?.value   || r.quarter_end;
        out[qId].granularity = 'QUARTER';
      }

      const mId  = nextId();
      out[mId]   = baseDimensionNode(r.posting_period, quarterIdByYearQ.get(qKey), INTERNAL_ID_KEY, r.time_internal_id);
      out[mId].startDate   = r.time_date?.value  || r.time_date;
      out[mId].endDate     = r.month_end?.value  || r.month_end;
      out[mId].granularity = 'MONTH';
    }

    const bucket = storage.bucket(DIMENSION_BUCKET);
    await bucket.file('time_config.json').save(JSON.stringify(out, null, 2), {
      contentType: 'application/json',
      resumable: false,
    });

    results.push({ config: 'Time', count: Object.keys(out).length, file: `gs://${DIMENSION_BUCKET}/time_config.json` });
  }

  return results;
}

// ── Status helpers ────────────────────────────────────────────────────────────

async function readStatus(bucket) {
  const file = bucket.file(STATUS_OBJECT);
  try {
    const [exists] = await file.exists();
    if (!exists) return null;
    const [contents] = await file.download();
    return JSON.parse(contents.toString('utf8'));
  } catch (err) {
    console.error('Failed to read status:', err.message);
    return null;
  }
}

async function writeStatus(bucket, status) {
  await bucket.file(STATUS_OBJECT).save(JSON.stringify(status, null, 2), {
    contentType: 'application/json',
  });
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function saveSyncTimestamp(asOf) {
  const pool = createPool();
  if (!pool) return;

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sync_metadata (
        key        TEXT PRIMARY KEY,
        value      TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      INSERT INTO sync_metadata (key, value, updated_at)
      VALUES ('last_synced_at', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
    `, [asOf]);
    console.log(`  Saved last_synced_at = ${asOf}`);
  } catch (err) {
    console.error('Failed to save sync timestamp:', err.message);
  } finally {
    await pool.end();
  }
}

async function ensureGcsImportLogTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${GCS_IMPORT_LOG_TABLE} (
      id SERIAL PRIMARY KEY,
      started_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ,
      status VARCHAR(20) NOT NULL DEFAULT 'running',
      duration_seconds NUMERIC(10,1),
      tables_loaded JSONB,
      transformation_status VARCHAR(20),
      dimension_export_status VARCHAR(20),
      initiated_by_email TEXT,
      trigger_type TEXT,
      source TEXT,
      notification_result JSONB,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE ${GCS_IMPORT_LOG_TABLE}
    ADD COLUMN IF NOT EXISTS initiated_by_email TEXT
  `);

  await pool.query(`
    ALTER TABLE ${GCS_IMPORT_LOG_TABLE}
    ADD COLUMN IF NOT EXISTS trigger_type TEXT
  `);

  await pool.query(`
    ALTER TABLE ${GCS_IMPORT_LOG_TABLE}
    ADD COLUMN IF NOT EXISTS source TEXT
  `);

  await pool.query(`
    ALTER TABLE ${GCS_IMPORT_LOG_TABLE}
    ADD COLUMN IF NOT EXISTS notification_result JSONB
  `);
}

async function logRunToDatabase(logData) {
  const pool = createPool();
  if (!pool) {
    console.warn('DATABASE_URL not set — skipping run log');
    return;
  }

  try {
    await ensureGcsImportLogTable(pool);
    await pool.query(
      `INSERT INTO ${GCS_IMPORT_LOG_TABLE}
         (started_at, completed_at, status, duration_seconds, tables_loaded, transformation_status, dimension_export_status, initiated_by_email, trigger_type, source, notification_result, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        logData.startedAt,
        logData.completedAt,
        logData.status,
        logData.durationSeconds,
        logData.tablesLoaded           ? JSON.stringify(logData.tablesLoaded) : null,
        logData.transformationStatus   || null,
        logData.dimensionExportStatus  || null,
        logData.initiatedByEmail       || null,
        logData.triggerType            || null,
        logData.source                 || null,
        logData.notificationResult     ? JSON.stringify(logData.notificationResult) : null,
        logData.error                  || null,
      ]
    );
    console.log('Run logged to database');
  } catch (err) {
    console.error('Failed to log run to database:', err.message);
  } finally {
    await pool.end();
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

exports.gcsToBigQuery = async (req, res) => {
  const startTime = Date.now();
  const bigquery  = new BigQuery({ projectId: PROJECT_ID });
  const storage   = new Storage({ projectId: PROJECT_ID });
  const bucket    = storage.bucket(BUCKET_NAME);

  // Status-check endpoint (?status=1)
  if (req.query?.status === '1' || req.query?.status === 'true') {
    const status = await readStatus(bucket);
    return res.status(200).json(
      status || {
        running: false,
        stage: 'idle',
        startedAt: null,
        completedAt: null,
        initiatedByEmail: null,
        triggerType: null,
        source: null,
        result: null,
        error: null,
      }
    );
  }

  // Generate a unique run ID and GCS prefix for this run
  const runId     = buildRunId();
  const runPrefix = `${runId}/`; // e.g. "run_20260328_143052/"
  const initiatedByEmail = getInitiatedByEmail(req);
  const triggerType = getTriggerType(req);
  const source = getSource(req);
  let notificationResult = {
    attempted: false,
    delivered: false,
    reason: 'not_attempted',
  };

  console.log(`=== GCS-to-BigQuery Pipeline Starting (${runId}) ===`);
  console.log(`  Trigger type: ${triggerType}; source: ${source}; initiated by: ${initiatedByEmail || 'n/a'}`);

  const status = {
    running:     true,
    runId,
    stage:       'netsuite_export',
    startedAt:   new Date().toISOString(),
    completedAt: null,
    initiatedByEmail,
    triggerType,
    source,
    result:      null,
    error:       null,
  };

  await writeStatus(bucket, status);

  try {
    // ── Step 1: Trigger NetSuite export ──────────────────────────────────────
    console.log('\n--- Step 1: NetSuite Export ---');
    const dataAsOf = new Date().toISOString(); // snapshot time — only persisted on success
    await triggerNetsuiteExport(runPrefix);
    await pollNetsuiteJobViaGCS(runPrefix);
    console.log(`  NetSuite export complete. Files written to gs://${BUCKET_NAME}/${runPrefix}`);

    // ── Step 2: Load CSVs from GCS → BigQuery ────────────────────────────────
    status.stage = 'loading';
    await writeStatus(bucket, status);
    console.log('\n--- Step 2: Loading CSVs into BigQuery ---');

    // List all files under this run's prefix
    const [runFiles] = await bucket.getFiles({ prefix: runPrefix });
    const folders = new Set();
    for (const file of runFiles) {
      const relativePath = file.name.slice(runPrefix.length); // strip "run_xxx/"
      const parts = relativePath.split('/');
      if (parts.length > 1 && parts[0]) {
        folders.add(parts[0]);
      }
    }

    console.log(`  Found table folders: ${[...folders].join(', ')}`);
    const results = {};

    for (const folder of folders) {
      const tableName = folder;
      console.log(`\n  Processing ${folder} -> ${DATASET_ID}.${tableName}`);

      const [folderFiles] = await bucket.getFiles({ prefix: `${runPrefix}${folder}/` });
      const csvFiles = folderFiles.filter(f => f.name.endsWith('.csv'));

      if (csvFiles.length === 0) {
        console.log(`    No CSV files found in ${folder}, skipping`);
        continue;
      }

      console.log(`    Found ${csvFiles.length} CSV file(s)`);

      const sourceUris = csvFiles.map(f => `gs://${BUCKET_NAME}/${f.name}`);

      // Read header from first file to build all-STRING schema
      const [headerBytes] = await csvFiles[0].download({ start: 0, end: 4096 });
      const headerLine  = headerBytes.toString('utf8').split('\n')[0].trim();
      const columns     = headerLine.split(',').map(c => c.trim().replace(/"/g, ''));
      const schemaFields = columns.map(name => ({ name, type: 'STRING' }));

      const jobConfig = {
        configuration: {
          load: {
            destinationTable: { projectId: PROJECT_ID, datasetId: DATASET_ID, tableId: tableName },
            sourceUris,
            sourceFormat:       'CSV',
            skipLeadingRows:    1,
            schema:             { fields: schemaFields },
            allowQuotedNewlines: true,
            allowJaggedRows:    true,
            writeDisposition:   'WRITE_TRUNCATE',
          },
        },
      };

      const [job] = await bigquery.createJob(jobConfig);
      console.log(`    Started BigQuery job ${job.id}`);

      let jobMeta;
      do {
        await new Promise(r => setTimeout(r, 2000));
        [jobMeta] = await job.getMetadata();
      } while (jobMeta.status.state !== 'DONE');

      if (jobMeta.status.errorResult) {
        throw new Error(`BigQuery load failed for ${tableName}: ${jobMeta.status.errorResult.message}`);
      }

      const rowCount = jobMeta.statistics?.load?.outputRows || 'unknown';
      console.log(`    Loaded ${rowCount} rows into ${DATASET_ID}.${tableName}`);
      results[tableName] = { files: csvFiles.length, rows: rowCount, status: 'success' };
    }

    status.result = { tables: results };

    // ── Step 3: Clean up GCS files for this run ───────────────────────────────
    status.stage = 'cleanup';
    await writeStatus(bucket, status);
    console.log('\n--- Step 3: Cleaning up GCS ---');

    const [runFilesForCleanup] = await bucket.getFiles({ prefix: runPrefix });
    await Promise.all(runFilesForCleanup.map(f => f.delete()));
    console.log(`  Deleted ${runFilesForCleanup.length} files from gs://${BUCKET_NAME}/${runPrefix}`);

    // ── Step 4: Trigger Fivetran dbt transformation ───────────────────────────
    status.stage = 'transform';
    await writeStatus(bucket, status);
    console.log('\n--- Step 4: Fivetran dbt Transformation ---');

    let transformationResult;
    try {
      const fivetranApiKey    = process.env.FIVETRAN_API_KEY;
      const fivetranApiSecret = process.env.FIVETRAN_API_SECRET;

      if (!fivetranApiKey || !fivetranApiSecret) {
        throw new Error('FIVETRAN_API_KEY or FIVETRAN_API_SECRET not set');
      }

      const auth = Buffer.from(`${fivetranApiKey}:${fivetranApiSecret}`).toString('base64');

      const triggerRes = await fetch(
        `${FIVETRAN_API_BASE}/transformations/${TRANSFORMATION_ID}/run`,
        {
          method: 'POST',
          headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
        }
      );

      const triggerData = await triggerRes.json();
      if (!triggerRes.ok) {
        throw new Error(triggerData.message || `Fivetran API error: ${triggerRes.status}`);
      }

      console.log(`  Transformation ${TRANSFORMATION_ID} triggered`);

      const POLL_INTERVAL = 15_000;
      const MAX_POLLS     = 120; // 30 min

      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));

        const statusRes  = await fetch(
          `${FIVETRAN_API_BASE}/transformations/${TRANSFORMATION_ID}`,
          { headers: { 'Authorization': `Basic ${auth}` } }
        );
        const statusData = await statusRes.json();
        const tStatus    = (statusData.data?.status || '').toUpperCase();
        console.log(`  Poll ${i + 1}: transformation status = ${tStatus}`);

        if (tStatus === 'SUCCEEDED') { transformationResult = { id: TRANSFORMATION_ID, status: 'succeeded' }; break; }
        if (tStatus === 'FAILED')    { transformationResult = { id: TRANSFORMATION_ID, status: 'failed', error: 'dbt transformation failed' }; break; }
      }

      if (!transformationResult) {
        transformationResult = { id: TRANSFORMATION_ID, status: 'failed', error: 'Timed out waiting for transformation' };
      }
    } catch (ftError) {
      console.error(`  Transformation error: ${ftError.message}`);
      transformationResult = { id: TRANSFORMATION_ID, status: 'failed', error: ftError.message };
    }

    // ── Step 5: Export dimension configs (only if dbt succeeded) ─────────────
    let dimensionExportResult = null;
    if (transformationResult?.status === 'succeeded') {
      status.stage = 'dimension_export';
      await writeStatus(bucket, status);
      console.log('\n--- Step 5: Exporting Dimension Configs ---');
      try {
        dimensionExportResult = await exportDimensionConfigs(bigquery, storage);
        console.log(`  Exported ${dimensionExportResult.length} dimension configs`);
      } catch (dimError) {
        console.error(`  Dimension export failed: ${dimError.message}`);
        dimensionExportResult = { status: 'failed', error: dimError.message };
      }
    } else {
      console.log('\n--- Skipping dimension export (transformation did not succeed) ---');
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n=== Pipeline complete in ${elapsed}s (${runId}) ===`);

    const response = {
      success:         true,
      runId,
      initiatedByEmail,
      triggerType,
      source,
      elapsed:         `${elapsed}s`,
      tables:          results,
      transformation:  transformationResult,
      dimensionExport: dimensionExportResult,
    };

    await saveSyncTimestamp(dataAsOf);
    status.stage  = 'done';
    status.result = response;
    res.status(200).json(response);

  } catch (error) {
    console.error('PIPELINE ERROR:', error.message);
    status.stage = 'failed';
    status.error = error.message;
    status.result = {
      success: false,
      runId,
      initiatedByEmail,
      triggerType,
      source,
      error: error.message,
    };
    res.status(500).json(status.result);

  } finally {
    status.running     = false;
    status.completedAt = new Date().toISOString();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const finalStatus = status.stage === 'done' ? 'success' : 'failed';
    const transformationStatus = status.result?.transformation?.status || null;
    const dimensionExportStatus = Array.isArray(status.result?.dimensionExport)
      ? 'success'
      : (status.result?.dimensionExport?.status || null);
    const notificationError = status.error
      || status.result?.transformation?.error
      || status.result?.dimensionExport?.error
      || null;

    try {
      notificationResult = await sendSyncCompletionEmail({
        runId,
        initiatedByEmail,
        triggerType,
        source,
        startedAt: status.startedAt,
        completedAt: status.completedAt,
        durationSeconds: parseFloat(elapsed),
        finalStatus,
        tablesLoaded: status.result?.tables || null,
        transformationStatus,
        dimensionExportStatus,
        error: notificationError,
      });

      if (notificationResult.attempted) {
        console.log(
          `Sync completion email ${notificationResult.delivered ? 'sent' : 'partially sent'} to ${notificationResult.deliveredRecipients?.length || 0}/${notificationResult.recipientCount || 0} recipients`
        );
      } else {
        console.log(`Sync completion email skipped: ${notificationResult.reason}`);
      }
    } catch (emailError) {
      console.error(`Sync completion email failed: ${emailError.message}`);
      notificationResult = {
        attempted: true,
        delivered: false,
        error: emailError.message,
      };
    }

    status.result = {
      ...(status.result && typeof status.result === 'object'
        ? status.result
        : {
            success: false,
            runId,
            initiatedByEmail,
            triggerType,
            source,
            error: status.error || null,
          }),
      notification: notificationResult,
    };

    await logRunToDatabase({
      startedAt:             status.startedAt,
      completedAt:           status.completedAt,
      status:                finalStatus,
      durationSeconds:       parseFloat(elapsed),
      tablesLoaded:          status.result?.tables || null,
      transformationStatus,
      dimensionExportStatus,
      initiatedByEmail,
      triggerType,
      source,
      notificationResult,
      error:                 notificationError,
    });

    await writeStatus(bucket, status);
  }
};
