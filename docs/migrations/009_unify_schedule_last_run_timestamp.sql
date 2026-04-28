-- Migration: Replace manual/automated last run timestamps with a single last_run_at column

ALTER TABLE report_schedules
ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ;

UPDATE report_schedules
SET last_run_at = COALESCE(last_run_at, GREATEST(last_run_manual, last_run_automated, last_sent_at))
WHERE last_run_at IS NULL;

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
  AND (rs.last_run_at IS NULL OR latest.last_run_at > rs.last_run_at);

ALTER TABLE report_schedules
DROP COLUMN IF EXISTS last_run_manual,
DROP COLUMN IF EXISTS last_run_automated;

SELECT 'Migration 009 complete - unified report_schedules.last_run_at' AS status;
