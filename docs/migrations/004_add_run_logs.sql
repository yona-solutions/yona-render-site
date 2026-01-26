-- Migration 004: Add Run Logs Table
-- This table tracks each scheduled report run with details about configuration and recipients

-- Create run_logs table
CREATE TABLE IF NOT EXISTS run_logs (
  id SERIAL PRIMARY KEY,

  -- Schedule reference (nullable in case schedule is deleted)
  schedule_id INTEGER REFERENCES report_schedules(id) ON DELETE SET NULL,

  -- Run timing
  run_started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  run_completed_at TIMESTAMP,

  -- Report configuration (snapshot at time of run)
  template_name VARCHAR(255) NOT NULL,
  template_type VARCHAR(50) NOT NULL,  -- district, region, subsidiary
  process VARCHAR(50) NOT NULL,        -- standard, operational

  -- Entity details (snapshot at time of run)
  entity_id VARCHAR(255),
  entity_name VARCHAR(255),

  -- Report date used
  report_date VARCHAR(50),

  -- Run status: 'success', 'partial', 'failed', 'skipped'
  status VARCHAR(20) NOT NULL DEFAULT 'pending',

  -- Skip/error reason if applicable
  error_message TEXT,

  -- Email details
  emails_sent INTEGER DEFAULT 0,
  emails_failed INTEGER DEFAULT 0,
  recipient_emails TEXT[],  -- Array of all recipient emails

  -- Trigger type: 'scheduled', 'manual', 'test'
  trigger_type VARCHAR(20) NOT NULL DEFAULT 'scheduled',

  -- PDF size in bytes (for reference)
  pdf_size_bytes INTEGER,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for common queries
CREATE INDEX idx_run_logs_schedule_id ON run_logs(schedule_id);
CREATE INDEX idx_run_logs_run_started_at ON run_logs(run_started_at DESC);
CREATE INDEX idx_run_logs_status ON run_logs(status);
CREATE INDEX idx_run_logs_template_name ON run_logs(template_name);

-- Add comment for documentation
COMMENT ON TABLE run_logs IS 'Tracks each scheduled or manual report run with full configuration and recipient details';
