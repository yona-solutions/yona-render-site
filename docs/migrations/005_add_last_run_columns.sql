-- Migration: Add last_run_manual and last_run_automated columns
-- Run this in Render Database Shell

-- Add columns to track when schedules were last run manually vs automatically
ALTER TABLE report_schedules
ADD COLUMN IF NOT EXISTS last_run_manual TIMESTAMP,
ADD COLUMN IF NOT EXISTS last_run_automated TIMESTAMP;

-- Verify the columns were added
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'report_schedules'
AND column_name IN ('last_run_manual', 'last_run_automated');

SELECT 'Migration 005 complete - added last_run_manual and last_run_automated columns' AS status;
