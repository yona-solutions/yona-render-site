-- Add Scheduling Fields to Report Schedules
-- Migration: 002
-- Created: 2026-01-24
-- Description: Adds detailed scheduling fields for automated report delivery

-- Add scheduling columns
ALTER TABLE report_schedules 
  ADD COLUMN IF NOT EXISTS day_of_week VARCHAR(10),
  ADD COLUMN IF NOT EXISTS day_of_month INTEGER,
  ADD COLUMN IF NOT EXISTS time_of_day TIME DEFAULT '08:00:00';

-- Add constraints
ALTER TABLE report_schedules
  ADD CONSTRAINT chk_day_of_week CHECK (
    day_of_week IS NULL OR 
    day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')
  );

ALTER TABLE report_schedules
  ADD CONSTRAINT chk_day_of_month CHECK (
    day_of_month IS NULL OR 
    (day_of_month >= 1 AND day_of_month <= 31)
  );

-- Add comments
COMMENT ON COLUMN report_schedules.day_of_week IS 'Day of week for weekly schedules (Monday-Sunday)';
COMMENT ON COLUMN report_schedules.day_of_month IS 'Day of month for monthly schedules (1-31)';
COMMENT ON COLUMN report_schedules.time_of_day IS 'Time of day to send report (HH:MM:SS format)';

-- Validation: Weekly schedules should have day_of_week
-- Validation: Monthly schedules should have day_of_month
-- (This is enforced at application level, not database level)

SELECT 'Migration 002_add_scheduling_fields completed successfully!' AS status;

