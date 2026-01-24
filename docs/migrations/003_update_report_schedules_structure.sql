-- Update Report Schedules Structure to Match P&L Page
-- Migration: 003
-- Created: 2026-01-24
-- Description: Updates report_schedules table with template-based structure

-- First, rename old columns to preserve data temporarily
ALTER TABLE report_schedules 
  RENAME COLUMN report_type TO old_report_type;
ALTER TABLE report_schedules 
  RENAME COLUMN hierarchy TO old_hierarchy;
ALTER TABLE report_schedules 
  RENAME COLUMN entity_id TO old_entity_id;
ALTER TABLE report_schedules 
  RENAME COLUMN entity_name TO old_entity_name;
ALTER TABLE report_schedules 
  RENAME COLUMN status TO old_status;

-- Add new template-based columns
ALTER TABLE report_schedules
  ADD COLUMN template_name VARCHAR(255),
  ADD COLUMN template_type VARCHAR(50),
  ADD COLUMN process VARCHAR(50),
  ADD COLUMN district_id VARCHAR(255),
  ADD COLUMN district_name VARCHAR(255),
  ADD COLUMN region_id VARCHAR(255),
  ADD COLUMN region_name VARCHAR(255),
  ADD COLUMN subsidiary_id VARCHAR(255),
  ADD COLUMN subsidiary_name VARCHAR(255),
  ADD COLUMN enabled BOOLEAN DEFAULT true;

-- Migrate data from old structure to new structure
UPDATE report_schedules SET
  template_name = CONCAT(
    CASE old_hierarchy
      WHEN 'district' THEN 'District '
      WHEN 'region' THEN 'Region '
      WHEN 'subsidiary' THEN 'Company '
    END,
    CASE old_report_type
      WHEN 'standard' THEN 'Standard'
      WHEN 'operational' THEN 'Operational'
    END,
    ' Report - ',
    old_entity_name
  ),
  template_type = old_hierarchy,
  process = old_report_type,
  district_id = CASE WHEN old_hierarchy = 'district' THEN old_entity_id ELSE NULL END,
  district_name = CASE WHEN old_hierarchy = 'district' THEN old_entity_name ELSE NULL END,
  region_id = CASE WHEN old_hierarchy = 'region' THEN old_entity_id ELSE NULL END,
  region_name = CASE WHEN old_hierarchy = 'region' THEN old_entity_name ELSE NULL END,
  subsidiary_id = CASE WHEN old_hierarchy = 'subsidiary' THEN old_entity_id ELSE NULL END,
  subsidiary_name = CASE WHEN old_hierarchy = 'subsidiary' THEN old_entity_name ELSE NULL END,
  enabled = CASE WHEN old_status = 'active' THEN true ELSE false END;

-- Make new columns NOT NULL after migration
ALTER TABLE report_schedules
  ALTER COLUMN template_name SET NOT NULL,
  ALTER COLUMN template_type SET NOT NULL,
  ALTER COLUMN process SET NOT NULL,
  ALTER COLUMN enabled SET NOT NULL;

-- Add constraints for new columns
ALTER TABLE report_schedules
  ADD CONSTRAINT chk_template_type CHECK (template_type IN ('district', 'region', 'subsidiary')),
  ADD CONSTRAINT chk_process CHECK (process IN ('standard', 'operational'));

-- Ensure at least one entity field is populated based on template_type
ALTER TABLE report_schedules
  ADD CONSTRAINT chk_entity_required CHECK (
    (template_type = 'district' AND district_id IS NOT NULL) OR
    (template_type = 'region' AND region_id IS NOT NULL) OR
    (template_type = 'subsidiary' AND subsidiary_id IS NOT NULL)
  );

-- Drop old constraints that referenced old columns
ALTER TABLE report_schedules
  DROP CONSTRAINT IF EXISTS chk_report_type,
  DROP CONSTRAINT IF EXISTS chk_hierarchy,
  DROP CONSTRAINT IF EXISTS chk_status;

-- Drop old columns after successful migration
ALTER TABLE report_schedules
  DROP COLUMN old_report_type,
  DROP COLUMN old_hierarchy,
  DROP COLUMN old_entity_id,
  DROP COLUMN old_entity_name,
  DROP COLUMN old_status;

-- Add comments for new columns
COMMENT ON COLUMN report_schedules.template_name IS 'User-defined name for the report template (free form)';
COMMENT ON COLUMN report_schedules.template_type IS 'Type of report: district, region, or subsidiary';
COMMENT ON COLUMN report_schedules.process IS 'P&L process type: standard or operational';
COMMENT ON COLUMN report_schedules.district_id IS 'District ID or tag (e.g., tag_West) when template_type=district';
COMMENT ON COLUMN report_schedules.district_name IS 'Display name for district';
COMMENT ON COLUMN report_schedules.region_id IS 'Region ID when template_type=region';
COMMENT ON COLUMN report_schedules.region_name IS 'Display name for region';
COMMENT ON COLUMN report_schedules.subsidiary_id IS 'Subsidiary ID when template_type=subsidiary';
COMMENT ON COLUMN report_schedules.subsidiary_name IS 'Display name for subsidiary';
COMMENT ON COLUMN report_schedules.enabled IS 'Whether this schedule is enabled (replaces status active/paused)';

-- Migration complete
SELECT 'Migration 003_update_report_schedules_structure completed successfully!' AS status;

-- Display sample of migrated data
SELECT 
  id, 
  template_name, 
  template_type, 
  process,
  COALESCE(district_name, region_name, subsidiary_name) as entity_name,
  frequency,
  enabled
FROM report_schedules
LIMIT 5;

