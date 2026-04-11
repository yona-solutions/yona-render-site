/**
 * Fivetran dbt Transformation Runner - Google Cloud Function
 *
 * HTTP-triggered function that starts one Fivetran dbt transformation, waits for
 * completion, and records the lifecycle in Postgres.
 */

const { Pool } = require('pg');

const FIVETRAN_API_BASE = 'https://api.fivetran.com/v1';
const DEFAULT_TRANSFORMATION_ID = 'justness_luminous';
const DEFAULT_POLL_INTERVAL_MS = 15000;
const DEFAULT_MAX_POLLS = 120;
const LOG_TABLE = 'fivetran_dbt_transformation_logs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function getTransformationId(req) {
  return (
    req.query?.transformationId ||
    req.body?.transformationId ||
    process.env.FIVETRAN_TRANSFORMATION_ID ||
    DEFAULT_TRANSFORMATION_ID
  );
}

function getTriggerType(req) {
  return req.query?.triggerType || req.body?.triggerType || 'manual';
}

function getSource(req) {
  return req.query?.source || req.body?.source || 'http';
}

function getMetadata(req) {
  if (req.body?.budgetPublish && typeof req.body.budgetPublish === 'object') {
    return { budgetPublish: req.body.budgetPublish };
  }
  if (req.body?.metadata && typeof req.body.metadata === 'object') {
    return req.body.metadata;
  }
  return null;
}

function getExecutionId() {
  return process.env.FUNCTION_TARGET || process.env.K_SERVICE || null;
}

function getPositiveInteger(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function buildFivetranAuth() {
  const apiKey = process.env.FIVETRAN_API_KEY;
  const apiSecret = process.env.FIVETRAN_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('FIVETRAN_API_KEY or FIVETRAN_API_SECRET not set');
  }

  return Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
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

async function ensureLogTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${LOG_TABLE} (
      id SERIAL PRIMARY KEY,
      transformation_id TEXT NOT NULL,
      run_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      run_completed_at TIMESTAMPTZ,
      status VARCHAR(20) NOT NULL DEFAULT 'running',
      fivetran_status VARCHAR(40),
      trigger_type VARCHAR(40),
      source TEXT,
      poll_count INTEGER DEFAULT 0,
      duration_seconds NUMERIC(10,1),
      error TEXT,
      execution_id TEXT,
      trigger_response JSONB,
      final_response JSONB,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE ${LOG_TABLE}
    ADD COLUMN IF NOT EXISTS metadata JSONB
  `);
}

async function insertRunLog(pool, logData) {
  if (!pool) {
    console.warn('DATABASE_URL not set - skipping transformation run log');
    return null;
  }

  await ensureLogTable(pool);
  const result = await pool.query(
    `INSERT INTO ${LOG_TABLE}
      (transformation_id, status, trigger_type, source, execution_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, run_started_at`,
    [
      logData.transformationId,
      'running',
      logData.triggerType,
      logData.source,
      logData.executionId,
      logData.metadata ? JSON.stringify(logData.metadata) : null,
    ]
  );

  return result.rows[0];
}

async function updateRunLog(pool, id, updateData) {
  if (!pool || !id) {
    return;
  }

  await pool.query(
    `UPDATE ${LOG_TABLE}
     SET run_completed_at = COALESCE($2, run_completed_at),
         status = $3,
         fivetran_status = $4,
         poll_count = $5,
         duration_seconds = $6,
         error = $7,
         trigger_response = $8,
         final_response = $9
     WHERE id = $1`,
    [
      id,
      updateData.completedAt || null,
      updateData.status,
      updateData.fivetranStatus || null,
      updateData.pollCount || 0,
      updateData.durationSeconds,
      updateData.error || null,
      updateData.triggerResponse ? JSON.stringify(updateData.triggerResponse) : null,
      updateData.finalResponse ? JSON.stringify(updateData.finalResponse) : null,
    ]
  );
}

async function fetchBudgetPublishLogs(pool, req) {
  if (!pool) {
    throw new Error('DATABASE_URL not set');
  }

  await ensureLogTable(pool);

  const page = getPositiveInteger(req.query?.page, 1, 100000);
  const limit = getPositiveInteger(req.query?.limit, 50, 100);
  const offset = (page - 1) * limit;
  const budgetPublishFilter = `
    WHERE trigger_type = 'budget_publish'
       OR source = 'sphere_budget_publish'
       OR metadata ? 'budgetPublish'
  `;

  const [logsResult, countResult] = await Promise.all([
    pool.query(
      `
        SELECT
          id,
          transformation_id,
          run_started_at,
          run_completed_at,
          status,
          fivetran_status,
          trigger_type,
          source,
          poll_count,
          duration_seconds,
          error,
          execution_id,
          metadata,
          created_at
        FROM ${LOG_TABLE}
        ${budgetPublishFilter}
        ORDER BY COALESCE(run_started_at, created_at) DESC
        LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    ),
    pool.query(`SELECT COUNT(*) FROM ${LOG_TABLE} ${budgetPublishFilter}`),
  ]);

  return {
    logs: logsResult.rows,
    total: Number(countResult.rows[0]?.count || 0),
    page,
    limit,
  };
}

async function triggerTransformation(transformationId, auth) {
  const response = await fetch(`${FIVETRAN_API_BASE}/transformations/${transformationId}/run`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || `Fivetran API error: ${response.status}`);
  }

  return data;
}

async function fetchTransformationStatus(transformationId, auth) {
  const response = await fetch(`${FIVETRAN_API_BASE}/transformations/${transformationId}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || `Fivetran status API error: ${response.status}`);
  }

  return data;
}

async function waitForTransformation(transformationId, auth) {
  const pollIntervalMs = Number(process.env.FIVETRAN_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS);
  const maxPolls = Number(process.env.FIVETRAN_MAX_POLLS || DEFAULT_MAX_POLLS);

  for (let i = 0; i < maxPolls; i++) {
    await sleep(pollIntervalMs);

    const statusData = await fetchTransformationStatus(transformationId, auth);
    const fivetranStatus = (statusData.data?.status || '').toUpperCase();
    console.log(`Poll ${i + 1}: transformation status = ${fivetranStatus}`);

    if (fivetranStatus === 'SUCCEEDED') {
      return {
        status: 'succeeded',
        fivetranStatus,
        pollCount: i + 1,
        finalResponse: statusData,
      };
    }

    if (['FAILED', 'CANCELLED'].includes(fivetranStatus)) {
      return {
        status: 'failed',
        fivetranStatus,
        pollCount: i + 1,
        error: `dbt transformation ${fivetranStatus.toLowerCase()}`,
        finalResponse: statusData,
      };
    }
  }

  return {
    status: 'timed_out',
    fivetranStatus: 'TIMEOUT',
    pollCount: maxPolls,
    error: 'Timed out waiting for transformation',
  };
}

exports.runFivetranDbtTransformation = async (req, res) => {
  if (req.method === 'GET' && (req.query?.health === '1' || req.query?.status === '1')) {
    res.status(200).json({
      status: 'ok',
      transformationId: getTransformationId(req),
      logTable: LOG_TABLE,
    });
    return;
  }

  if (req.method === 'GET' && req.query?.logs === '1') {
    let pool = null;
    try {
      pool = createPool();
      const logs = await fetchBudgetPublishLogs(pool, req);
      res.status(200).json(logs);
    } catch (error) {
      console.error(`Failed to fetch budget publish logs: ${error.message}`);
      res.status(500).json({ error: 'Failed to fetch budget publish logs' });
    } finally {
      if (pool) {
        await pool.end();
      }
    }
    return;
  }

  const startTime = Date.now();
  const completedAt = () => new Date().toISOString();
  const durationSeconds = () => Number(((Date.now() - startTime) / 1000).toFixed(1));
  const transformationId = getTransformationId(req);
  const triggerType = getTriggerType(req);
  const source = getSource(req);
  const metadata = getMetadata(req);
  const executionId = getExecutionId();

  let pool = null;
  let runLog = null;
  let triggerResponse = null;

  console.log(`=== Fivetran dbt transformation starting (${transformationId}) ===`);

  try {
    pool = createPool();
    runLog = await insertRunLog(pool, {
      transformationId,
      triggerType,
      source,
      executionId,
      metadata,
    });

    const auth = buildFivetranAuth();

    console.log(`Triggering transformation ${transformationId}`);
    triggerResponse = await triggerTransformation(transformationId, auth);
    console.log(`Transformation ${transformationId} triggered`);

    const result = await waitForTransformation(transformationId, auth);
    const finalStatus = result.status === 'succeeded' ? 'success' : result.status;

    await updateRunLog(pool, runLog?.id, {
      completedAt: completedAt(),
      status: finalStatus,
      fivetranStatus: result.fivetranStatus,
      pollCount: result.pollCount,
      durationSeconds: durationSeconds(),
      error: result.error,
      triggerResponse,
      finalResponse: result.finalResponse,
    });

    const responseStatus = result.status === 'succeeded' ? 200 : 500;
    const response = {
      success: result.status === 'succeeded',
      runLogId: runLog?.id || null,
      transformationId,
      status: finalStatus,
      fivetranStatus: result.fivetranStatus,
      pollCount: result.pollCount,
      durationSeconds: durationSeconds(),
      error: result.error || null,
    };

    console.log(`=== Fivetran dbt transformation ${finalStatus} in ${response.durationSeconds}s ===`);
    res.status(responseStatus).json(response);
  } catch (error) {
    console.error(`Transformation failed: ${error.message}`);

    await updateRunLog(pool, runLog?.id, {
      completedAt: completedAt(),
      status: 'failed',
      pollCount: 0,
      durationSeconds: durationSeconds(),
      error: error.message,
      triggerResponse,
    });

    res.status(500).json({
      success: false,
      runLogId: runLog?.id || null,
      transformationId,
      status: 'failed',
      durationSeconds: durationSeconds(),
      error: error.message,
    });
  } finally {
    if (pool) {
      await pool.end();
    }
  }
};
