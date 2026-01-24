-- Initial Email Configuration Schema
-- Migration: 001
-- Created: 2026-01-24
-- Description: Creates tables for email groups and report schedules

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

COMMENT ON TABLE email_groups IS 'Distribution lists for automated reports';
COMMENT ON COLUMN email_groups.name IS 'Unique name for the email group';
COMMENT ON COLUMN email_groups.description IS 'Optional description of the group purpose';

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

COMMENT ON TABLE email_group_contacts IS 'Individual email addresses within groups';
COMMENT ON COLUMN email_group_contacts.email_group_id IS 'Foreign key to email_groups';
COMMENT ON COLUMN email_group_contacts.email IS 'Email address';
COMMENT ON COLUMN email_group_contacts.name IS 'Optional contact name';

-- ============================================
-- Report Schedules Table
-- ============================================
CREATE TABLE IF NOT EXISTS report_schedules (
  id SERIAL PRIMARY KEY,
  report_type VARCHAR(50) NOT NULL,
  hierarchy VARCHAR(50) NOT NULL,
  entity_id VARCHAR(255) NOT NULL,
  entity_name VARCHAR(255),
  email_group_id INTEGER NOT NULL REFERENCES email_groups(id),
  frequency VARCHAR(50) NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_sent_at TIMESTAMP,
  next_send_at TIMESTAMP,
  
  CONSTRAINT chk_report_type CHECK (report_type IN ('standard', 'operational')),
  CONSTRAINT chk_hierarchy CHECK (hierarchy IN ('district', 'region', 'subsidiary')),
  CONSTRAINT chk_frequency CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  CONSTRAINT chk_status CHECK (status IN ('active', 'paused'))
);

COMMENT ON TABLE report_schedules IS 'Automated P&L report delivery schedules';
COMMENT ON COLUMN report_schedules.report_type IS 'Type of P&L report: standard or operational';
COMMENT ON COLUMN report_schedules.hierarchy IS 'Hierarchy level: district, region, or subsidiary';
COMMENT ON COLUMN report_schedules.entity_id IS 'ID of the entity from configuration';
COMMENT ON COLUMN report_schedules.entity_name IS 'Cached display name of entity';
COMMENT ON COLUMN report_schedules.frequency IS 'Send frequency: daily, weekly, or monthly';
COMMENT ON COLUMN report_schedules.status IS 'Schedule status: active or paused';
COMMENT ON COLUMN report_schedules.last_sent_at IS 'Timestamp of last report send';
COMMENT ON COLUMN report_schedules.next_send_at IS 'Timestamp when next report should be sent';

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_email_group_contacts_group_id 
  ON email_group_contacts(email_group_id);

CREATE INDEX IF NOT EXISTS idx_report_schedules_group_id 
  ON report_schedules(email_group_id);

CREATE INDEX IF NOT EXISTS idx_report_schedules_status 
  ON report_schedules(status);

CREATE INDEX IF NOT EXISTS idx_report_schedules_next_send 
  ON report_schedules(next_send_at);

-- ============================================
-- Triggers
-- ============================================

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to email_groups
DROP TRIGGER IF EXISTS update_email_groups_updated_at ON email_groups;
CREATE TRIGGER update_email_groups_updated_at
  BEFORE UPDATE ON email_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to report_schedules
DROP TRIGGER IF EXISTS update_report_schedules_updated_at ON report_schedules;
CREATE TRIGGER update_report_schedules_updated_at
  BEFORE UPDATE ON report_schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Verification Queries
-- ============================================

-- List all tables
SELECT tablename 
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;

-- Show table structures
\d email_groups
\d email_group_contacts
\d report_schedules

-- Show indexes
SELECT 
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- Migration complete
SELECT 'Migration 001_initial_schema completed successfully!' AS status;

