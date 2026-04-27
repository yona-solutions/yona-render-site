-- Add tags to report schedules for filtering and bulk organization
ALTER TABLE report_schedules
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE report_schedules
SET tags = ARRAY[]::TEXT[]
WHERE tags IS NULL;
