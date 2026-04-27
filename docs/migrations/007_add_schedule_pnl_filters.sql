ALTER TABLE report_schedules
ADD COLUMN IF NOT EXISTS service_filter_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS service_filter_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS header_subsidiary_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS header_subsidiary_name VARCHAR(255);
