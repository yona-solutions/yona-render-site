-- Add durable batch run tracking for tag-based report execution

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
);

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
);

CREATE INDEX IF NOT EXISTS idx_report_batch_runs_status
  ON report_batch_runs(status);

CREATE INDEX IF NOT EXISTS idx_report_batch_runs_tag_date
  ON report_batch_runs(tag, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_report_batch_run_items_batch_id
  ON report_batch_run_items(batch_run_id);

CREATE INDEX IF NOT EXISTS idx_report_batch_run_items_status
  ON report_batch_run_items(status);
