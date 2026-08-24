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
const createAdminUserRoutes = require('./routes/adminUsersApi');
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
      const emailGroupContactsTable = await emailConfigService.pool.query(`
        SELECT to_regclass('public.email_group_contacts') AS table_name
      `);
      if (emailGroupContactsTable.rows[0]?.table_name) {
        await emailConfigService.pool.query(`
          ALTER TABLE email_group_contacts
          ADD COLUMN IF NOT EXISTS first_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS last_name VARCHAR(255)
        `);

        await emailConfigService.pool.query(`
          WITH parsed_names AS (
            SELECT
              id,
              tokens[1] AS parsed_first_name,
              CASE
                WHEN array_length(tokens, 1) > 1 THEN tokens[array_length(tokens, 1)]
                ELSE NULL
              END AS parsed_last_name
            FROM (
              SELECT
                id,
                regexp_split_to_array(BTRIM(name), '[[:space:]]+') AS tokens
              FROM email_group_contacts
              WHERE name IS NOT NULL
                AND BTRIM(name) <> ''
            ) AS named_contacts
          )
          UPDATE email_group_contacts AS contacts
          SET
            first_name = COALESCE(NULLIF(BTRIM(contacts.first_name), ''), parsed_names.parsed_first_name),
            last_name = COALESCE(NULLIF(BTRIM(contacts.last_name), ''), parsed_names.parsed_last_name)
          FROM parsed_names
          WHERE contacts.id = parsed_names.id
            AND (
              contacts.first_name IS NULL OR BTRIM(contacts.first_name) = ''
              OR contacts.last_name IS NULL OR BTRIM(contacts.last_name) = ''
            )
        `);
      }

      const reportSchedulesTable = await emailConfigService.pool.query(`
        SELECT to_regclass('public.report_schedules') AS table_name
      `);
      if (reportSchedulesTable.rows[0]?.table_name) {
        const reportScheduleColumnsResult = await emailConfigService.pool.query(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'report_schedules'
        `);
        const reportScheduleColumns = new Set(
          reportScheduleColumnsResult.rows.map(row => row.column_name)
        );

        await emailConfigService.pool.query(`
          ALTER TABLE report_schedules
          ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT ARRAY[]::TEXT[],
          ADD COLUMN IF NOT EXISTS email_template_type VARCHAR(50)
        `);
        await emailConfigService.pool.query(`
          ALTER TABLE report_schedules
          ADD COLUMN IF NOT EXISTS apply_subsidiary_filter_to_detail BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS service_filter_id VARCHAR(255),
          ADD COLUMN IF NOT EXISTS service_filter_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS customer_tag_filter_id VARCHAR(255),
          ADD COLUMN IF NOT EXISTS customer_tag_filter_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS header_subsidiary_id VARCHAR(255),
          ADD COLUMN IF NOT EXISTS header_subsidiary_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS customer_tag_id VARCHAR(255),
          ADD COLUMN IF NOT EXISTS customer_tag_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ
        `);
        await emailConfigService.pool.query(`
          ALTER TABLE report_schedules
          DROP CONSTRAINT IF EXISTS chk_template_type
        `);
        await emailConfigService.pool.query(`
          ALTER TABLE report_schedules
          ADD CONSTRAINT chk_template_type CHECK (template_type IN ('district', 'region', 'subsidiary', 'customer_tag'))
        `);
        await emailConfigService.pool.query(`
          ALTER TABLE report_schedules
          DROP CONSTRAINT IF EXISTS chk_email_template_type
        `);
        await emailConfigService.pool.query(`
          ALTER TABLE report_schedules
          ADD CONSTRAINT chk_email_template_type CHECK (
            email_template_type IN ('district', 'region', 'customer_tag', 'multiple_districts', 'subsidiary_dietary', 'subsidiary')
            OR email_template_type IS NULL
          )
        `);
        await emailConfigService.pool.query(`
          UPDATE report_schedules
          SET tags = ARRAY[]::TEXT[]
          WHERE tags IS NULL
        `);
        const runTimestampColumns = ['last_run_manual', 'last_run_automated', 'last_sent_at']
          .filter(column => reportScheduleColumns.has(column));

        if (runTimestampColumns.length > 0) {
          const fallbackExpression = runTimestampColumns.length === 1
            ? runTimestampColumns[0]
            : `NULLIF(GREATEST(${runTimestampColumns.map(column => `COALESCE(${column}, '-infinity'::timestamptz)`).join(', ')}), '-infinity'::timestamptz)`;

          await emailConfigService.pool.query(`
            UPDATE report_schedules
            SET last_run_at = COALESCE(last_run_at, ${fallbackExpression})
            WHERE last_run_at IS NULL
          `);
        }

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

        await emailConfigService.pool.query(`
          CREATE TABLE IF NOT EXISTS report_schedule_reports (
            id SERIAL PRIMARY KEY,
            report_schedule_id INTEGER NOT NULL REFERENCES report_schedules(id) ON DELETE CASCADE,
            sort_order INTEGER NOT NULL DEFAULT 0,
            template_name VARCHAR(255) NOT NULL,
            template_type VARCHAR(50) NOT NULL,
            process VARCHAR(50) NOT NULL,
            apply_subsidiary_filter_to_detail BOOLEAN NOT NULL DEFAULT FALSE,
            service_filter_id VARCHAR(255),
            service_filter_name VARCHAR(255),
            customer_tag_filter_id VARCHAR(255),
            customer_tag_filter_name VARCHAR(255),
            header_subsidiary_id VARCHAR(255),
            header_subsidiary_name VARCHAR(255),
            district_id VARCHAR(255),
            district_name VARCHAR(255),
            region_id VARCHAR(255),
            region_name VARCHAR(255),
            subsidiary_id VARCHAR(255),
            subsidiary_name VARCHAR(255),
            customer_tag_id VARCHAR(255),
            customer_tag_name VARCHAR(255),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT chk_report_schedule_reports_template_type CHECK (template_type IN ('district', 'region', 'subsidiary', 'customer_tag')),
            CONSTRAINT chk_report_schedule_reports_process CHECK (process IN ('standard', 'operational'))
          )
        `);

        await emailConfigService.pool.query(`
          ALTER TABLE report_schedule_reports
          ADD COLUMN IF NOT EXISTS apply_subsidiary_filter_to_detail BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS service_filter_id VARCHAR(255),
          ADD COLUMN IF NOT EXISTS service_filter_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS customer_tag_filter_id VARCHAR(255),
          ADD COLUMN IF NOT EXISTS customer_tag_filter_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS header_subsidiary_id VARCHAR(255),
          ADD COLUMN IF NOT EXISTS header_subsidiary_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS district_id VARCHAR(255),
          ADD COLUMN IF NOT EXISTS district_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS region_id VARCHAR(255),
          ADD COLUMN IF NOT EXISTS region_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS subsidiary_id VARCHAR(255),
          ADD COLUMN IF NOT EXISTS subsidiary_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS customer_tag_id VARCHAR(255),
          ADD COLUMN IF NOT EXISTS customer_tag_name VARCHAR(255)
        `);

        await emailConfigService.pool.query(`
          CREATE INDEX IF NOT EXISTS idx_report_schedule_reports_schedule_id
            ON report_schedule_reports(report_schedule_id, sort_order, id)
        `);
        await emailConfigService.pool.query(`
          WITH report_meta AS (
            SELECT
              rs.id,
              COALESCE(report_counts.report_count, CASE WHEN rs.template_type IS NOT NULL AND rs.process IS NOT NULL THEN 1 ELSE 0 END) AS report_count,
              COALESCE(primary_report.template_type, rs.template_type) AS primary_template_type,
              LOWER(COALESCE(primary_report.service_filter_name, rs.service_filter_name, '')) AS primary_service_filter_name
            FROM report_schedules rs
            LEFT JOIN (
              SELECT
                report_schedule_id,
                COUNT(*) AS report_count
              FROM report_schedule_reports
              GROUP BY report_schedule_id
            ) AS report_counts ON report_counts.report_schedule_id = rs.id
            LEFT JOIN LATERAL (
              SELECT
                template_type,
                service_filter_name
              FROM report_schedule_reports
              WHERE report_schedule_id = rs.id
              ORDER BY sort_order ASC, id ASC
              LIMIT 1
            ) AS primary_report ON TRUE
          )
          UPDATE report_schedules rs
          SET email_template_type = CASE
            WHEN report_meta.report_count > 1 THEN 'multiple_districts'
            WHEN report_meta.primary_template_type = 'subsidiary' AND report_meta.primary_service_filter_name = 'dietary' THEN 'subsidiary_dietary'
            WHEN report_meta.primary_template_type = 'subsidiary' THEN 'subsidiary'
            WHEN report_meta.primary_template_type = 'district' THEN 'district'
            ELSE rs.email_template_type
          END
          FROM report_meta
          WHERE rs.id = report_meta.id
            AND (rs.email_template_type IS NULL OR BTRIM(rs.email_template_type) = '')
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
          initiated_by_email TEXT,
          trigger_type TEXT,
          source TEXT,
          notification_result JSONB,
          error TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await emailConfigService.pool.query(`
        ALTER TABLE gcs_import_logs
        ADD COLUMN IF NOT EXISTS initiated_by_email TEXT
      `);

      await emailConfigService.pool.query(`
        ALTER TABLE gcs_import_logs
        ADD COLUMN IF NOT EXISTS trigger_type TEXT
      `);

      await emailConfigService.pool.query(`
        ALTER TABLE gcs_import_logs
        ADD COLUMN IF NOT EXISTS source TEXT
      `);

      await emailConfigService.pool.query(`
        ALTER TABLE gcs_import_logs
        ADD COLUMN IF NOT EXISTS notification_result JSONB
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

  // Admin-only user management routes
  app.use('/api/admin', createAdminUserRoutes(emailConfigService.isAvailable() ? emailConfigService.pool : null));

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
