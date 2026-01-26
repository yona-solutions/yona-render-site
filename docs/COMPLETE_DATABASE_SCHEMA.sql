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
  district_id VARCHAR(255),
  district_name VARCHAR(255),
  region_id VARCHAR(255),
  region_name VARCHAR(255),
  subsidiary_id VARCHAR(255),
  subsidiary_name VARCHAR(255),
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
  
  CONSTRAINT chk_template_type CHECK (template_type IN ('district', 'region', 'subsidiary')),
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
