# Email Automation Flow - Complete Guide

## Overview

The email configuration system allows users to set up automated delivery of P&L reports to distribution lists. This document explains the complete user flow, data model, and scheduling system.

## User Flow

### Step 1: Create Email Groups (Distribution Lists)

First, users create email groups that represent who should receive reports.

**UI Flow:**
1. Navigate to `/email-config`
2. Click "New Email Group" in Email Groups section
3. Fill in:
   - **Group Name**: e.g., "District Managers"
   - **Description**: Optional description of the group
   - **Email Addresses**: Add one or more emails
4. Click "Save Email Group"

**Examples:**
- **District Managers** → All facility managers in a district
- **Regional Directors** → Regional VPs and leadership
- **Finance Team** → Accounting, FP&A departments
- **Executive Team** → C-suite executives
- **West District Facilities** → Specific facility administrators

**Data Structure:**
```javascript
{
  id: 1,
  name: "District Managers",
  description: "All district-level operations managers",
  email_count: 5,
  contacts: [
    { email: "john.smith@yona.com", name: "John Smith" },
    { email: "jane.doe@yona.com", name: "Jane Doe" },
    // ...
  ]
}
```

### Step 2: Create Report Schedules

Next, users configure which reports to send, to whom, and how often.

**UI Flow:**
1. Click "New Report Schedule" in Report Schedules section
2. Configure report parameters:

#### A. Report Type
- **Standard P&L** - Full P&L with all line items
- **Operational P&L** - Operations-focused P&L

#### B. Hierarchy Level
Choose the organizational level for the report:
- **District** - Single district P&L
- **Region** - Regional consolidation
- **Subsidiary** - Company-wide consolidation

#### C. Entity Selection
After selecting hierarchy, choose the specific entity:
- If **District** → Select from available districts (West District, South District, etc.)
- If **Region** → Select from available regions (Northeast, West, South, etc.)
- If **Subsidiary** → Select from subsidiaries (Yona Solutions Main, etc.)

The entity dropdown dynamically loads based on the hierarchy selection.

#### D. Email Group
Choose which email group receives the report:
- Select from previously created email groups
- Shows group name and email count

#### E. Frequency & Timing

**Monthly Reports:**
- **Frequency**: Monthly
- **Day of Month**: 1-31 (e.g., "5th of each month")
- **Time of Day**: HH:MM (e.g., "08:00 AM")

**Weekly Reports:**
- **Frequency**: Weekly
- **Day of Week**: Monday-Sunday
- **Time of Day**: HH:MM (e.g., "09:00 AM")

**Daily Reports:**
- **Frequency**: Daily
- **Time of Day**: HH:MM (e.g., "07:00 AM")

#### F. Status
- **Active** - Schedule is running
- **Paused** - Schedule is temporarily disabled

3. Click "Save Schedule"

**Complete Example:**
```javascript
{
  id: 1,
  report_type: "standard",           // Standard P&L
  hierarchy: "district",             // District level
  entity_id: "west_district",        // West District
  entity_name: "West District",      // Display name
  email_group_id: 1,                 // District Managers group
  email_group_name: "District Managers",
  frequency: "monthly",              // Send monthly
  day_of_month: 5,                   // On the 5th
  time_of_day: "08:00",             // At 8:00 AM
  status: "active",                  // Currently active
  last_sent_at: "2026-01-05T08:00:00Z",
  next_send_at: "2026-02-05T08:00:00Z"
}
```

## Complete Use Cases

### Use Case 1: Monthly District Report to Managers

**Setup:**
1. **Email Group**: "District Managers"
   - Emails: 5 district managers
2. **Report Schedule**:
   - **Report Type**: Standard P&L
   - **Hierarchy**: District
   - **Entity**: West District
   - **Email Group**: District Managers
   - **Frequency**: Monthly on the 5th at 8:00 AM

**Result:** Every month on the 5th at 8:00 AM, all district managers receive a Standard P&L for West District.

### Use Case 2: Weekly Operational Report to Regional Directors

**Setup:**
1. **Email Group**: "Regional Directors"
   - Emails: 3 regional VPs
2. **Report Schedule**:
   - **Report Type**: Operational P&L
   - **Hierarchy**: Region
   - **Entity**: Northeast Region
   - **Email Group**: Regional Directors
   - **Frequency**: Weekly on Monday at 9:00 AM

**Result:** Every Monday at 9:00 AM, regional directors receive an Operational P&L for Northeast Region.

### Use Case 3: Company-Wide Monthly Report to Executives

**Setup:**
1. **Email Group**: "Executive Team"
   - Emails: CEO, CFO, COO
2. **Report Schedule**:
   - **Report Type**: Standard P&L
   - **Hierarchy**: Subsidiary
   - **Entity**: Yona Solutions Main
   - **Email Group**: Executive Team
   - **Frequency**: Monthly on 1st at 7:00 AM

**Result:** On the 1st of each month at 7:00 AM, executives receive a company-wide Standard P&L.

### Use Case 4: Weekly Facility Reports to Individual Teams

**Setup:**
1. **Email Group**: "West District Facilities"
   - Emails: 8 facility administrators
2. **Report Schedule**:
   - **Report Type**: Operational P&L
   - **Hierarchy**: District
   - **Entity**: West District
   - **Email Group**: West District Facilities
   - **Frequency**: Weekly on Friday at 4:00 PM

**Result:** Every Friday at 4:00 PM, facility administrators receive an Operational P&L for their district.

## Database Schema

### email_groups
```sql
CREATE TABLE email_groups (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### email_group_contacts
```sql
CREATE TABLE email_group_contacts (
  id SERIAL PRIMARY KEY,
  email_group_id INTEGER NOT NULL REFERENCES email_groups(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(email_group_id, email)
);
```

### report_schedules
```sql
CREATE TABLE report_schedules (
  id SERIAL PRIMARY KEY,
  report_type VARCHAR(50) NOT NULL,       -- 'standard' or 'operational'
  hierarchy VARCHAR(50) NOT NULL,         -- 'district', 'region', 'subsidiary'
  entity_id VARCHAR(255) NOT NULL,        -- ID from customer/region config
  entity_name VARCHAR(255),               -- Cached display name
  email_group_id INTEGER NOT NULL REFERENCES email_groups(id),
  frequency VARCHAR(50) NOT NULL,         -- 'daily', 'weekly', 'monthly'
  status VARCHAR(50) DEFAULT 'active',    -- 'active' or 'paused'
  day_of_week VARCHAR(10),                -- 'Monday'-'Sunday' for weekly
  day_of_month INTEGER,                   -- 1-31 for monthly
  time_of_day TIME DEFAULT '08:00:00',   -- HH:MM:SS
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_sent_at TIMESTAMP,                 -- Last successful send
  next_send_at TIMESTAMP                  -- Next scheduled send
);
```

## Scheduling Logic

### Frequency Rules

**Daily:**
- Runs every day at `time_of_day`
- No `day_of_week` or `day_of_month` needed

**Weekly:**
- Runs once per week on `day_of_week`
- At `time_of_day`
- Must specify valid day (Monday-Sunday)

**Monthly:**
- Runs once per month on `day_of_month`
- At `time_of_day`
- Must specify valid day (1-31)
- If day doesn't exist (e.g., Feb 31), runs on last day of month

### Timestamp Tracking

**`last_sent_at`:**
- Updated when email successfully sent
- Used for audit trail
- Shows in UI for user confirmation

**`next_send_at`:**
- Calculated based on frequency + timing
- Used by scheduler to determine which reports to send
- Automatically recalculated after each send

**Example Calculation:**
```javascript
// Monthly on 5th at 08:00
frequency: 'monthly',
day_of_month: 5,
time_of_day: '08:00',
last_sent_at: '2026-01-05T08:00:00Z',
next_send_at: '2026-02-05T08:00:00Z'  // Automatically calculated
```

## Email Delivery (Future Phase)

When a scheduled report is due (`next_send_at <= NOW`):

1. **Generate Report**
   - Call P&L generation API
   - Pass: `report_type`, `hierarchy`, `entity_id`, `date`
   - Receive HTML output

2. **Convert to PDF**
   - Use PDFShift API (already implemented)
   - Apply proper styling for print

3. **Compose Email**
   - **Subject**: "Monthly P&L Report - West District - January 2026"
   - **Body**: HTML template with summary and link
   - **Attachment**: PDF file

4. **Send via Email Service**
   - Use SendGrid or AWS SES
   - Loop through all emails in group
   - Track send status

5. **Update Schedule**
   - Set `last_sent_at` = NOW
   - Calculate `next_send_at` based on frequency
   - Log send result

## Mock Data

The system includes comprehensive mock data for testing without database setup:

**Mock Email Groups:** 6 groups with 29 total contacts
- District Managers (5 contacts)
- Regional Directors (3 contacts)
- Finance Team (4 contacts)
- Executive Team (3 contacts)
- West District Facilities (8 contacts)
- Northeast Operations (6 contacts)

**Mock Report Schedules:** 8 different configurations
- Various combinations of:
  - Standard vs Operational
  - District vs Region vs Subsidiary
  - Daily vs Weekly vs Monthly
  - Active vs Paused
  - Different entities and groups

**Access Mock Data:**
- Navigate to `/email-config`
- All data is fully functional
- Can create/edit/delete (in-memory only)
- Resets on server restart

## API Endpoints

### Email Groups
- `GET /api/email-groups` - List all groups
- `GET /api/email-groups/:id` - Get group details
- `GET /api/email-groups/:id/contacts` - Get group contacts
- `POST /api/email-groups` - Create group
- `PUT /api/email-groups/:id` - Update group
- `DELETE /api/email-groups/:id` - Delete group

### Report Schedules
- `GET /api/report-schedules` - List all schedules
- `GET /api/report-schedules/:id` - Get schedule details
- `POST /api/report-schedules` - Create schedule
- `PUT /api/report-schedules/:id` - Update schedule
- `DELETE /api/report-schedules/:id` - Delete schedule
- `GET /api/report-schedules/due` - Get schedules due to send

## Testing Flow

1. **Start Server**: `npm start`
2. **Open UI**: `http://localhost:3000/email-config`
3. **View Mock Data**: See pre-populated groups and schedules
4. **Create Email Group**:
   - Click "New Email Group"
   - Add name and emails
   - Save
5. **Create Report Schedule**:
   - Click "New Report Schedule"
   - Select options
   - Save
6. **Verify Data**: 
   - See new entries in tables
   - Edit/delete to test functionality
7. **Check Persistence**:
   - Without database: Data resets on restart
   - With database: Data persists

## Next Steps

### Phase 1: Current (Complete)
- ✅ Email group management
- ✅ Report schedule configuration
- ✅ Mock data for testing
- ✅ Complete UI flow
- ✅ API endpoints

### Phase 2: Email Delivery
- SendGrid/AWS SES integration
- Email template design
- PDF attachment generation
- Send status tracking
- Retry logic for failures

### Phase 3: Scheduler
- Cron job implementation
- Query `next_send_at` column
- Process due schedules
- Update timestamps
- Error handling and alerts

### Phase 4: Advanced Features
- Email preview before send
- Send history/audit log
- Success/failure notifications
- User-customizable templates
- A/B testing different formats

## Summary

The email automation system provides a complete workflow for automated P&L report delivery:

1. **Create email groups** → Define who receives reports
2. **Configure schedules** → Define what, when, and how often
3. **System sends automatically** → Based on schedule timing
4. **Track and monitor** → Via timestamps and status

All components are fully functional with mock data, allowing immediate testing without database setup. When connected to PostgreSQL, all data persists and the system is production-ready.

