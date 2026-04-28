-- Complete Database Schema for Email Scheduler
-- Run this in Render Database Shell to set up all tables
-- This combines all migrations into one file

-- ============================================
-- Email Groups Table
-- ============================================
CREATE TABLE IF NOT EXISTS email_groups (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- Email Group Contacts Table
-- ============================================
CREATE TABLE IF NOT EXISTS email_group_contacts (
  id SERIAL PRIMARY KEY,
  email_group_id INTEGER NOT NULL REFERENCES email_groups(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(email_group_id, email)
);

-- ============================================
-- Report Schedules Table
-- ============================================
CREATE TABLE IF NOT EXISTS report_schedules (
  id SERIAL PRIMARY KEY,
  template_name VARCHAR(255) NOT NULL,
  template_type VARCHAR(50) NOT NULL,
  process VARCHAR(50) NOT NULL,
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  service_filter_id VARCHAR(255),
  service_filter_name VARCHAR(255),
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
  email_group_id INTEGER REFERENCES email_groups(id),
  email_group_ids INTEGER[],
  frequency VARCHAR(50) NOT NULL,
  day_of_week VARCHAR(10),
  day_of_month INTEGER,
  time_of_day TIME DEFAULT '08:00:00',
  enabled BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_sent_at TIMESTAMP,
  next_send_at TIMESTAMP,
  last_run_at TIMESTAMP,
  
  CONSTRAINT chk_template_type CHECK (template_type IN ('district', 'region', 'subsidiary', 'customer_tag')),
  CONSTRAINT chk_process CHECK (process IN ('standard', 'operational')),
  CONSTRAINT chk_frequency CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  CONSTRAINT chk_day_of_week CHECK (
    day_of_week IS NULL OR 
    day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')
  ),
  CONSTRAINT chk_day_of_month CHECK (
    day_of_month IS NULL OR 
    (day_of_month >= 1 AND day_of_month <= 31)
  )
);

-- ============================================
-- Run Logs Table
-- ============================================
CREATE TABLE IF NOT EXISTS run_logs (
  id SERIAL PRIMARY KEY,
  schedule_id INTEGER REFERENCES report_schedules(id) ON DELETE SET NULL,
  run_started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  run_completed_at TIMESTAMP,
  template_name VARCHAR(255) NOT NULL,
  template_type VARCHAR(50) NOT NULL,
  process VARCHAR(50) NOT NULL,
  entity_id VARCHAR(255),
  entity_name VARCHAR(255),
  report_date VARCHAR(50),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  error_message TEXT,
  emails_sent INTEGER DEFAULT 0,
  emails_failed INTEGER DEFAULT 0,
  recipient_emails TEXT[],
  trigger_type VARCHAR(20) NOT NULL DEFAULT 'scheduled',
  pdf_size_bytes INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- Report Batch Runs Table
-- ============================================
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
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT chk_report_batch_runs_mode CHECK (run_mode IN ('generate', 'send')),
  CONSTRAINT chk_report_batch_runs_status CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled'))
);

-- ============================================
-- Report Batch Run Items Table
-- ============================================
CREATE TABLE IF NOT EXISTS report_batch_run_items (
  id SERIAL PRIMARY KEY,
  batch_run_id INTEGER NOT NULL REFERENCES report_batch_runs(id) ON DELETE CASCADE,
  schedule_id INTEGER REFERENCES report_schedules(id) ON DELETE SET NULL,
  schedule_name VARCHAR(255) NOT NULL,
  report_date DATE NOT NULL,
  run_mode VARCHAR(20) NOT NULL DEFAULT 'send',
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMP,
  completed_at TIMESTAMP,
  emails_sent INTEGER NOT NULL DEFAULT 0,
  emails_failed INTEGER NOT NULL DEFAULT 0,
  pdf_size_bytes INTEGER,
  error_message TEXT,
  task_name VARCHAR(255),
  result_payload JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT chk_report_batch_run_items_mode CHECK (run_mode IN ('generate', 'send')),
  CONSTRAINT chk_report_batch_run_items_status CHECK (status IN ('queued', 'running', 'success', 'partial', 'skipped', 'failed')),
  CONSTRAINT uq_report_batch_run_item_schedule UNIQUE (batch_run_id, schedule_id)
);

-- ============================================
-- Indexes for Performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_email_group_contacts_group_id
  ON email_group_contacts(email_group_id);

CREATE INDEX IF NOT EXISTS idx_report_schedules_group_id
  ON report_schedules(email_group_id);

CREATE INDEX IF NOT EXISTS idx_report_schedules_enabled
  ON report_schedules(enabled);

CREATE INDEX IF NOT EXISTS idx_report_schedules_next_send
  ON report_schedules(next_send_at);

CREATE INDEX IF NOT EXISTS idx_run_logs_schedule_id
  ON run_logs(schedule_id);

CREATE INDEX IF NOT EXISTS idx_run_logs_run_started_at
  ON run_logs(run_started_at DESC);

CREATE INDEX IF NOT EXISTS idx_run_logs_status
  ON run_logs(status);

CREATE INDEX IF NOT EXISTS idx_run_logs_template_name
  ON run_logs(template_name);

CREATE INDEX IF NOT EXISTS idx_report_batch_runs_status
  ON report_batch_runs(status);

CREATE INDEX IF NOT EXISTS idx_report_batch_runs_tag_date
  ON report_batch_runs(tag, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_report_batch_run_items_batch_id
  ON report_batch_run_items(batch_run_id);

CREATE INDEX IF NOT EXISTS idx_report_batch_run_items_status
  ON report_batch_run_items(status);

-- ============================================
-- Auto-Update Timestamp Triggers
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_email_groups_updated_at ON email_groups;
CREATE TRIGGER update_email_groups_updated_at
  BEFORE UPDATE ON email_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_report_schedules_updated_at ON report_schedules;
CREATE TRIGGER update_report_schedules_updated_at
  BEFORE UPDATE ON report_schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Verify Setup
-- ============================================
SELECT 'Database schema created successfully!' AS status;

-- Show created tables
SELECT 
  tablename,
  schemaname
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;
