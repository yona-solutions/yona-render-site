/**
 * Application Setup Module
 * 
 * Central module that initializes and configures the Express application.
 * Brings together all configuration, services, and routes.
 * 
 * @module app
 */

const express = require('express');
const { configureExpress } = require('./config/express');
const { initializeStorage, initializeBigQuery } = require('./config/gcp');
const StorageService = require('./services/storageService');
const BigQueryService = require('./services/bigQueryService');
const emailConfigService = require('./services/emailConfigService');
const emailService = require('./services/emailService');
const googleSheetsService = require('./services/googleSheetsService');
const createApiRoutes = require('./routes/api');
const { router: emailConfigApiRoutes, initializeEmailConfigRoutes } = require('./routes/emailConfigApi');
const authApiRoutes = require('./routes/authApi');
const createViewRoutes = require('./routes/views');
const { createRequireAuth, initializeUserRolesTable } = require('./middleware/auth');

/**
 * Create and configure Express application
 * 
 * @returns {express.Application} Configured Express app
 */
async function createApp() {
  const app = express();

  // Configure Express middleware
  configureExpress(app);

  // Initialize services
  const storage = initializeStorage();
  const storageService = new StorageService(storage);
  
  const bigquery = initializeBigQuery();
  const bigQueryService = new BigQueryService(bigquery);

  // Initialize email config routes with bigQueryService
  initializeEmailConfigRoutes(bigQueryService);

  // Initialize email service (SendGrid)
  emailService.initialize();

  // Initialize Google Sheets service
  googleSheetsService.initialize();

  // Initialize email config service (PostgreSQL)
  // Only initialize if DATABASE_URL is provided
  if (process.env.DATABASE_URL) {
    try {
      await emailConfigService.initialize();
    } catch (error) {
      console.warn('⚠️  Email config database not available:', error.message);
      console.warn('   Email configuration features will be disabled');
    }
  } else {
    console.warn('⚠️  DATABASE_URL not set - email configuration features disabled');
  }

  // Ensure global_settings table exists
  if (process.env.DATABASE_URL && emailConfigService.isAvailable()) {
    try {
      const reportSchedulesTable = await emailConfigService.pool.query(`
        SELECT to_regclass('public.report_schedules') AS table_name
      `);
      if (reportSchedulesTable.rows[0]?.table_name) {
        await emailConfigService.pool.query(`
          ALTER TABLE report_schedules
          ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT ARRAY[]::TEXT[]
        `);
        await emailConfigService.pool.query(`
          ALTER TABLE report_schedules
          ADD COLUMN IF NOT EXISTS service_filter_id VARCHAR(255),
          ADD COLUMN IF NOT EXISTS service_filter_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS header_subsidiary_id VARCHAR(255),
          ADD COLUMN IF NOT EXISTS header_subsidiary_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ
        `);
        await emailConfigService.pool.query(`
          UPDATE report_schedules
          SET tags = ARRAY[]::TEXT[]
          WHERE tags IS NULL
        `);
        await emailConfigService.pool.query(`
          UPDATE report_schedules
          SET last_run_at = COALESCE(last_run_at, GREATEST(last_run_manual, last_run_automated, last_sent_at))
          WHERE last_run_at IS NULL
        `);

        const runLogsTable = await emailConfigService.pool.query(`
          SELECT to_regclass('public.run_logs') AS table_name
        `);
        if (runLogsTable.rows[0]?.table_name) {
          await emailConfigService.pool.query(`
            UPDATE report_schedules rs
            SET last_run_at = latest.last_run_at
            FROM (
              SELECT
                schedule_id,
                MAX(COALESCE(run_completed_at, run_started_at)) AS last_run_at
              FROM run_logs
              WHERE schedule_id IS NOT NULL
              GROUP BY schedule_id
            ) AS latest
            WHERE rs.id = latest.schedule_id
              AND (rs.last_run_at IS NULL OR latest.last_run_at > rs.last_run_at)
          `);
        }

        await emailConfigService.pool.query(`
          ALTER TABLE report_schedules
          DROP COLUMN IF EXISTS last_run_manual,
          DROP COLUMN IF EXISTS last_run_automated
        `);
      }

      await emailConfigService.pool.query(`
        CREATE TABLE IF NOT EXISTS global_settings (
          key VARCHAR(255) PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await emailConfigService.pool.query(`
        CREATE TABLE IF NOT EXISTS report_batch_runs (
          id SERIAL PRIMARY KEY,
          tag TEXT NOT NULL,
          report_date DATE NOT NULL,
          run_mode VARCHAR(20) NOT NULL DEFAULT 'send',
          status VARCHAR(20) NOT NULL DEFAULT 'queued',
          requested_by_email TEXT,
          total_schedules INTEGER NOT NULL DEFAULT 0,
          processed_schedules INTEGER NOT NULL DEFAULT 0,
          successful_schedules INTEGER NOT NULL DEFAULT 0,
          partial_schedules INTEGER NOT NULL DEFAULT 0,
          failed_schedules INTEGER NOT NULL DEFAULT 0,
          skipped_schedules INTEGER NOT NULL DEFAULT 0,
          emails_sent INTEGER NOT NULL DEFAULT 0,
          emails_failed INTEGER NOT NULL DEFAULT 0,
          error_message TEXT,
          started_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT chk_report_batch_runs_mode CHECK (run_mode IN ('generate', 'send')),
          CONSTRAINT chk_report_batch_runs_status CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled'))
        )
      `);

      await emailConfigService.pool.query(`
        CREATE TABLE IF NOT EXISTS report_batch_run_items (
          id SERIAL PRIMARY KEY,
          batch_run_id INTEGER NOT NULL REFERENCES report_batch_runs(id) ON DELETE CASCADE,
          schedule_id INTEGER REFERENCES report_schedules(id) ON DELETE SET NULL,
          schedule_name VARCHAR(255) NOT NULL,
          report_date DATE NOT NULL,
          run_mode VARCHAR(20) NOT NULL DEFAULT 'send',
          status VARCHAR(20) NOT NULL DEFAULT 'queued',
          attempt_count INTEGER NOT NULL DEFAULT 0,
          last_attempt_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          emails_sent INTEGER NOT NULL DEFAULT 0,
          emails_failed INTEGER NOT NULL DEFAULT 0,
          pdf_size_bytes INTEGER,
          error_message TEXT,
          task_name VARCHAR(255),
          result_payload JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT chk_report_batch_run_items_mode CHECK (run_mode IN ('generate', 'send')),
          CONSTRAINT chk_report_batch_run_items_status CHECK (status IN ('queued', 'running', 'success', 'partial', 'skipped', 'failed')),
          CONSTRAINT uq_report_batch_run_item_schedule UNIQUE (batch_run_id, schedule_id)
        )
      `);

      await emailConfigService.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_report_batch_runs_status
          ON report_batch_runs(status)
      `);

      await emailConfigService.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_report_batch_runs_tag_date
          ON report_batch_runs(tag, report_date DESC)
      `);

      await emailConfigService.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_report_batch_run_items_batch_id
          ON report_batch_run_items(batch_run_id)
      `);

      await emailConfigService.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_report_batch_run_items_status
          ON report_batch_run_items(status)
      `);
    } catch (error) {
      console.warn('⚠️  Could not ensure global_settings table:', error.message);
    }
  }

  // Ensure gcs_import_logs table exists (safety net)
  if (process.env.DATABASE_URL && emailConfigService.isAvailable()) {
    try {
      await emailConfigService.pool.query(`
        CREATE TABLE IF NOT EXISTS gcs_import_logs (
          id SERIAL PRIMARY KEY,
          started_at TIMESTAMPTZ NOT NULL,
          completed_at TIMESTAMPTZ,
          status VARCHAR(20) NOT NULL DEFAULT 'running',
          duration_seconds NUMERIC(10,1),
          tables_loaded JSONB,
          transformation_status VARCHAR(20),
          dimension_export_status VARCHAR(20),
          error TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    } catch (error) {
      console.warn('⚠️  Could not ensure gcs_import_logs table:', error.message);
    }
  }

  // Initialize user_roles table and auth middleware
  let requireAuth = (req, res, next) => next(); // no-op fallback
  if (process.env.DATABASE_URL && emailConfigService.isAvailable()) {
    try {
      await initializeUserRolesTable(emailConfigService.pool);
      requireAuth = createRequireAuth(emailConfigService.pool);
    } catch (error) {
      console.warn('⚠️  Auth middleware not available:', error.message);
    }
  }

  // Public auth routes (no authentication required)
  app.use('/api/auth', authApiRoutes);

  // GET /api/me - returns current user info (must be before requireAuth applies)
  app.get('/api/me', requireAuth, (req, res) => {
    res.json({ email: req.user.email, role: req.user.role });
  });

  // Apply auth middleware to all /api routes (except /api/auth which is already registered)
  app.use('/api', requireAuth);

  // Register routes
  app.use('/api', createApiRoutes(storageService, bigQueryService, emailConfigService.isAvailable() ? emailConfigService.pool : null));
  app.use('/api', emailConfigApiRoutes); // Email config API routes
  app.use('/', createViewRoutes());

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ 
      error: 'Not Found',
      message: `Cannot ${req.method} ${req.url}`,
      code: 'ROUTE_NOT_FOUND'
    });
  });

  // Error handler
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: err.message,
      code: 'INTERNAL_ERROR'
    });
  });

  return app;
}

module.exports = createApp;
