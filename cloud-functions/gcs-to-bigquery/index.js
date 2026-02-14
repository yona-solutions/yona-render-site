/**
 * GCS-to-BigQuery Loader - Google Cloud Function
 *
 * Reads CSV files from gs://yona-csv-uploads and loads them into BigQuery tables.
 * Each folder becomes a table in the raw_source_data dataset.
 * Multiple files in a folder are combined into one table.
 *
 * Triggered via HTTP (Cloud Scheduler or manual).
 */

const { BigQuery } = require('@google-cloud/bigquery');
const { Storage } = require('@google-cloud/storage');
const { Pool } = require('pg');

const BUCKET_NAME = 'yona-csv-uploads';
const DATASET_ID = 'raw_netsuite_gcs_export';
const PROJECT_ID = 'yona-solutions-poc';
const STATUS_OBJECT = '__gcs_import_status.json';

// Fivetran configuration
const FIVETRAN_API_BASE = 'https://api.fivetran.com/v1';
const TRANSFORMATION_ID = 'justness_luminous';

// Dimension config export settings
const DIMENSION_BUCKET = 'dimension_configurations';
const DBT_DATASET = 'dbt_production';

const DIMENSION_CONFIGS = [
  {
    name: 'Region',
    table: 'dim_regions',
    idCol: 'region_id',
    labelCol: 'display_name',
    internalIdField: 'region_internal_id',
    applyRegionFilters: true,
    outputFile: 'region_config.json',
  },
  {
    name: 'Vendor',
    table: 'dim_vendors',
    idCol: 'vendor_id',
    labelCol: 'display_name',
    internalIdField: 'vendor_internal_id',
    applyRegionFilters: false,
    outputFile: 'vendor_config.json',
  },
];

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

async function exportDimensionConfigs(bigquery, storage) {
  const results = [];

  // Region + Vendor configs
  for (const cfg of DIMENSION_CONFIGS) {
    let idCounter = 0;
    const nextId = () => (++idCounter).toString();

    const query = `
      SELECT
        ${cfg.idCol} AS source_id,
        ${cfg.labelCol} AS label
      FROM \`${PROJECT_ID}.${DBT_DATASET}.${cfg.table}\`
      WHERE ${cfg.labelCol} IS NOT NULL
      ${cfg.applyRegionFilters ? 'AND is_leaf_region = TRUE' : ''}
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
      out[id] = baseDimensionNode(r.label, allId, cfg.internalIdField, r.source_id);
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
    const INTERNAL_ID_KEY = 'time_internal_id';
    const yearIdByYear = new Map();
    const quarterIdByYearQ = new Map();
    const twoDigitYear = (yr) => String(yr).slice(-2);
    const quarterLabel = (yr, qtr) => `Q${qtr}-${twoDigitYear(yr)}`;

    for (const r of rows) {
      const yr = r.yr;
      const qtr = r.qtr;
      const yKey = String(yr);
      const qKey = `${yr}-Q${qtr}`;

      if (!yearIdByYear.has(yKey)) {
        const yId = nextId();
        yearIdByYear.set(yKey, yId);
        out[yId] = baseDimensionNode(String(yr), null, INTERNAL_ID_KEY, null);
        out[yId].hasChildren = true;
        out[yId].startDate = r.year_start?.value || r.year_start;
        out[yId].endDate = r.year_end?.value || r.year_end;
        out[yId].granularity = 'YEAR';
      }

      if (!quarterIdByYearQ.has(qKey)) {
        const qId = nextId();
        quarterIdByYearQ.set(qKey, qId);
        out[qId] = baseDimensionNode(quarterLabel(yr, qtr), yearIdByYear.get(yKey), INTERNAL_ID_KEY, null);
        out[qId].hasChildren = true;
        out[qId].startDate = r.quarter_start?.value || r.quarter_start;
        out[qId].endDate = r.quarter_end?.value || r.quarter_end;
        out[qId].granularity = 'QUARTER';
      }

      const mId = nextId();
      out[mId] = baseDimensionNode(r.posting_period, quarterIdByYearQ.get(qKey), INTERNAL_ID_KEY, r.time_internal_id);
      out[mId].startDate = r.time_date?.value || r.time_date;
      out[mId].endDate = r.month_end?.value || r.month_end;
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
  const file = bucket.file(STATUS_OBJECT);
  const body = JSON.stringify(status, null, 2);
  await file.save(body, { contentType: 'application/json' });
}

async function logRunToDatabase(logData) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn('DATABASE_URL not set — skipping run log');
    return;
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    max: 1,
    idleTimeoutMillis: 5000,
  });

  try {
    await pool.query(
      `INSERT INTO gcs_import_logs
        (started_at, completed_at, status, duration_seconds, tables_loaded, transformation_status, dimension_export_status, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        logData.startedAt,
        logData.completedAt,
        logData.status,
        logData.durationSeconds,
        logData.tablesLoaded ? JSON.stringify(logData.tablesLoaded) : null,
        logData.transformationStatus || null,
        logData.dimensionExportStatus || null,
        logData.error || null,
      ]
    );
    console.log('Run logged to database');
  } catch (err) {
    console.error('Failed to log run to database:', err.message);
  } finally {
    await pool.end();
  }
}

exports.gcsToBigQuery = async (req, res) => {
  const startTime = Date.now();
  console.log('=== GCS-to-BigQuery Loader Starting ===');

  const bigquery = new BigQuery({ projectId: PROJECT_ID });
  const storage = new Storage({ projectId: PROJECT_ID });
  const bucket = storage.bucket(BUCKET_NAME);

  if (req.query && (req.query.status === '1' || req.query.status === 'true')) {
    const status = await readStatus(bucket);
    return res.status(200).json(
      status || {
        running: false,
        stage: 'idle',
        startedAt: null,
        completedAt: null,
        result: null,
        error: null,
      }
    );
  }

  const status = {
    running: true,
    stage: 'loading',
    startedAt: new Date().toISOString(),
    completedAt: null,
    result: null,
    error: null,
  };

  await writeStatus(bucket, status);

  try {
    // List all folders (prefixes) in the bucket
    const [files] = await bucket.getFiles();
    const folders = new Set();
    for (const file of files) {
      if (file.name === STATUS_OBJECT) continue;
      const parts = file.name.split('/');
      if (parts.length > 1 && parts[0]) {
        folders.add(parts[0]);
      }
    }

    console.log(`Found folders: ${[...folders].join(', ')}`);
    const results = {};

    for (const folder of folders) {
      const tableName = folder; // folder name = table name
      console.log(`\nProcessing folder: ${folder} -> table: ${DATASET_ID}.${tableName}`);

      // Get all CSV files in this folder
      const [folderFiles] = await bucket.getFiles({ prefix: `${folder}/` });
      const csvFiles = folderFiles.filter(f => f.name.endsWith('.csv'));

      if (csvFiles.length === 0) {
        console.log(`  No CSV files found in ${folder}, skipping`);
        continue;
      }

      console.log(`  Found ${csvFiles.length} CSV file(s)`);

      // Build GCS URIs for all files in this folder
      const sourceUris = csvFiles.map(f => `gs://${BUCKET_NAME}/${f.name}`);

      // Read the header from the first CSV to build an all-STRING schema
      const [headerBytes] = await csvFiles[0].download({ start: 0, end: 4096 });
      const headerLine = headerBytes.toString('utf8').split('\n')[0].trim();
      const columns = headerLine.split(',').map(c => c.trim().replace(/"/g, ''));
      const schemaFields = columns.map(name => ({ name, type: 'STRING' }));

      // Load into BigQuery using raw job configuration
      const jobConfig = {
        configuration: {
          load: {
            destinationTable: {
              projectId: PROJECT_ID,
              datasetId: DATASET_ID,
              tableId: tableName,
            },
            sourceUris,
            sourceFormat: 'CSV',
            skipLeadingRows: 1,
            schema: { fields: schemaFields },
            allowQuotedNewlines: true,
            allowJaggedRows: true,
            writeDisposition: 'WRITE_TRUNCATE',
          },
        },
      };

      const [job] = await bigquery.createJob(jobConfig);
      console.log(`  Started job ${job.id}`);

      // Poll until job completes
      let jobMeta;
      do {
        await new Promise(r => setTimeout(r, 2000));
        [jobMeta] = await job.getMetadata();
      } while (jobMeta.status.state !== 'DONE');

      if (jobMeta.status.errorResult) {
        throw new Error(`Load failed for ${tableName}: ${jobMeta.status.errorResult.message}`);
      }
      const rowCount = jobMeta.statistics?.load?.outputRows || 'unknown';
      console.log(`  Loaded ${rowCount} rows into ${DATASET_ID}.${tableName}`);

      results[tableName] = {
        files: csvFiles.length,
        rows: rowCount,
        status: 'success',
      };
    }

    // Update status: loading complete, moving to cleanup
    status.stage = 'cleanup';
    status.result = { tables: results };
    await writeStatus(bucket, status);

    // Delete all files from GCS bucket after successful load
    console.log('\n--- Cleaning up GCS bucket ---');
    const [allFiles] = await bucket.getFiles();
    const deletableFiles = allFiles.filter(f => f.name !== STATUS_OBJECT);
    await Promise.all(deletableFiles.map(f => f.delete()));
    console.log(`  Deleted ${deletableFiles.length} files from gs://${BUCKET_NAME}`);

    // Update status: cleanup complete, moving to transformation
    status.stage = 'transform';
    await writeStatus(bucket, status);

    // Trigger Fivetran dbt transformation
    console.log('\n--- Triggering Fivetran transformation ---');
    let transformationResult;
    try {
      const fivetranApiKey = process.env.FIVETRAN_API_KEY;
      const fivetranApiSecret = process.env.FIVETRAN_API_SECRET;

      if (!fivetranApiKey || !fivetranApiSecret) {
        throw new Error('FIVETRAN_API_KEY or FIVETRAN_API_SECRET not set');
      }

      const auth = Buffer.from(`${fivetranApiKey}:${fivetranApiSecret}`).toString('base64');
      const triggerRes = await fetch(
        `${FIVETRAN_API_BASE}/transformations/${TRANSFORMATION_ID}/run`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const triggerData = await triggerRes.json();
      if (!triggerRes.ok) {
        throw new Error(triggerData.message || `Fivetran API error: ${triggerRes.status}`);
      }

      console.log(`  Transformation ${TRANSFORMATION_ID} triggered successfully`);

      // Poll until transformation completes
      console.log('  Waiting for transformation to complete...');
      const POLL_INTERVAL = 15000; // 15 seconds
      const MAX_POLLS = 120;       // 30 minutes max

      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));

        const statusRes = await fetch(
          `${FIVETRAN_API_BASE}/transformations/${TRANSFORMATION_ID}`,
          {
            headers: { 'Authorization': `Basic ${auth}` },
          }
        );
        const statusData = await statusRes.json();
        const tStatus = (statusData.data?.status || '').toUpperCase();
        console.log(`  Poll ${i + 1}: transformation status = ${tStatus}`);

        if (tStatus === 'SUCCEEDED') {
          transformationResult = { id: TRANSFORMATION_ID, status: 'succeeded' };
          break;
        }
        if (tStatus === 'FAILED') {
          transformationResult = { id: TRANSFORMATION_ID, status: 'failed', error: 'dbt transformation failed' };
          break;
        }
      }

      if (!transformationResult) {
        transformationResult = { id: TRANSFORMATION_ID, status: 'failed', error: 'Timed out waiting for transformation' };
      }
    } catch (ftError) {
      console.error(`  Transformation failed: ${ftError.message}`);
      transformationResult = { id: TRANSFORMATION_ID, status: 'failed', error: ftError.message };
    }

    // Export dimension configs (only if transformation succeeded)
    let dimensionExportResult = null;
    if (transformationResult?.status === 'succeeded') {
      status.stage = 'dimension_export';
      await writeStatus(bucket, status);

      console.log('\n--- Exporting dimension configs ---');
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
    console.log(`\n=== Completed in ${elapsed}s ===`);

    const response = {
      success: true,
      elapsed: `${elapsed}s`,
      tables: results,
      transformation: transformationResult,
      dimensionExport: dimensionExportResult,
    };

    status.stage = 'done';
    status.result = response;
    res.status(200).json(response);
  } catch (error) {
    console.error('ERROR:', error.message);
    status.stage = 'failed';
    status.error = error.message;
    res.status(500).json({
      success: false,
      error: error.message,
    });
  } finally {
    status.running = false;
    status.completedAt = new Date().toISOString();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    await logRunToDatabase({
      startedAt: status.startedAt,
      completedAt: status.completedAt,
      status: status.stage === 'done' ? 'success' : 'failed',
      durationSeconds: parseFloat(elapsed),
      tablesLoaded: status.result?.tables || status.result?.success && status.result?.tables || null,
      transformationStatus: status.result?.transformation?.status || null,
      dimensionExportStatus: Array.isArray(status.result?.dimensionExport) ? 'success' : (status.result?.dimensionExport?.status || null),
      error: status.error || null,
    });

    await writeStatus(bucket, status);
  }
};
