# Email Report Schedule Specification

## Overview

This document specifies the exact structure and behavior for automated P&L report schedules, matching the P&L View page filtering logic.

## Report Schedule Fields

### 1. Template Name (Free Form)
- **Type**: Text input
- **Required**: Yes
- **Example**: "Weekly West District Standard Report"
- **Description**: User-defined name for easy identification
- **UI**: Standard text input field

### 2. Template Type
- **Type**: Dropdown
- **Required**: Yes
- **Options**:
  - District
  - Region
  - Subsidiary
- **Description**: Determines which entity fields are shown
- **UI**: Single-select dropdown
- **Behavior**: When changed, show/hide corresponding entity dropdowns

### 3. Process
- **Type**: Toggle/Dropdown
- **Required**: Yes
- **Options**:
  - Standard
  - Operational
- **Description**: Type of P&L report to generate
- **UI**: Toggle buttons or dropdown

### 4. District Dropdown
- **Visible**: Only when Template Type = "District"
- **Data Source**: `/api/storage/districts`
- **Filtering**: Excludes districts where:
  - `districtReportingExcluded === true`
  - `displayExcluded === true`
- **Includes**:
  - Individual districts (type: 'district')
  - District tags (type: 'tag', id starts with 'tag_')
- **Example Options**:
  ```
  West District (individual district)
  East District (individual district)
  West (district tag - groups multiple districts)
  Northeast (district tag - groups multiple districts)
  ```
- **Storage Format**:
  - **district_id**: ID from dropdown (e.g., "1234" or "tag_West")
  - **district_name**: Display label (e.g., "West District" or "West")

### 5. Region Dropdown
- **Visible**: Only when Template Type = "Region"
- **Data Source**: `/api/storage/regions`
- **Filtering**: Excludes regions where:
  - `displayExcluded === true`
  - `operationalExcluded === true` (when Process = "Operational")
- **Includes**:
  - Individual regions (type: 'region')
  - Region tags (type: 'tag')
- **Example Options**:
  ```
  Northeast Region (individual region)
  West Region (individual region)
  All Regions (region tag)
  ```
- **Storage Format**:
  - **region_id**: ID from dropdown
  - **region_name**: Display label

### 6. Subsidiary Dropdown
- **Visible**: Only when Template Type = "Subsidiary"
- **Data Source**: `/api/storage/departments` (or subsidiaries endpoint)
- **Filtering**: Based on configuration
- **Example Options**:
  ```
  Yona Solutions Main
  Yona Healthcare Division
  ```
- **Storage Format**:
  - **subsidiary_id**: ID from dropdown
  - **subsidiary_name**: Display label

### 7. Email Group
- **Type**: Dropdown
- **Required**: Yes
- **Data Source**: `/api/email-groups`
- **Display**: Shows group name and email count
- **Example**: "District Managers (5 emails)"

### 8. Frequency
- **Type**: Dropdown
- **Required**: Yes
- **Options**:
  - Daily
  - Weekly
  - Monthly
- **Behavior**: Shows/hides day/time fields based on selection

### 9. Day of Week
- **Visible**: Only when Frequency = "Weekly"
- **Type**: Dropdown
- **Options**: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday
- **Storage**: Stored as text (e.g., "Monday")

### 10. Day of Month
- **Visible**: Only when Frequency = "Monthly"
- **Type**: Number input (1-31)
- **Validation**: Must be between 1 and 31
- **Behavior**: If day doesn't exist in month (e.g., Feb 31), sends on last day

### 11. Time of Day
- **Type**: Time picker
- **Format**: HH:MM (24-hour)
- **Default**: 08:00
- **Storage**: Stored as TIME in database (HH:MM:SS)

### 12. Enabled
- **Type**: Toggle/Checkbox
- **Default**: True (enabled)
- **Options**:
  - On (enabled) - schedule will run
  - Off (disabled/paused) - schedule won't run
- **Replaces**: Old "status" field (active/paused)

## Database Schema

```sql
CREATE TABLE report_schedules (
  id SERIAL PRIMARY KEY,
  
  -- Template Configuration
  template_name VARCHAR(255) NOT NULL,
  template_type VARCHAR(50) NOT NULL,  -- 'district', 'region', 'subsidiary'
  process VARCHAR(50) NOT NULL,        -- 'standard', 'operational'
  
  -- Entity Fields (only one set populated based on template_type)
  district_id VARCHAR(255),            -- District ID or 'tag_*' for tags
  district_name VARCHAR(255),          -- Display name
  region_id VARCHAR(255),              -- Region ID or 'tag_*' for tags
  region_name VARCHAR(255),            -- Display name
  subsidiary_id VARCHAR(255),          -- Subsidiary ID
  subsidiary_name VARCHAR(255),        -- Display name
  
  -- Email Configuration
  email_group_id INTEGER NOT NULL REFERENCES email_groups(id),
  
  -- Scheduling
  frequency VARCHAR(50) NOT NULL,      -- 'daily', 'weekly', 'monthly'
  day_of_week VARCHAR(10),             -- 'Monday'-'Sunday' for weekly
  day_of_month INTEGER,                -- 1-31 for monthly
  time_of_day TIME DEFAULT '08:00:00', -- HH:MM:SS
  
  -- Status
  enabled BOOLEAN DEFAULT true NOT NULL,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_sent_at TIMESTAMP,
  next_send_at TIMESTAMP,
  
  -- Constraints
  CONSTRAINT chk_template_type CHECK (template_type IN ('district', 'region', 'subsidiary')),
  CONSTRAINT chk_process CHECK (process IN ('standard', 'operational')),
  CONSTRAINT chk_day_of_week CHECK (
    day_of_week IS NULL OR 
    day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')
  ),
  CONSTRAINT chk_day_of_month CHECK (day_of_month IS NULL OR (day_of_month >= 1 AND day_of_month <= 31)),
  CONSTRAINT chk_entity_required CHECK (
    (template_type = 'district' AND district_id IS NOT NULL) OR
    (template_type = 'region' AND region_id IS NOT NULL) OR
    (template_type = 'subsidiary' AND subsidiary_id IS NOT NULL)
  )
);
```

## UI Behavior

### Form Layout

```
┌─────────────────────────────────────────────┐
│ Create Report Schedule                       │
├─────────────────────────────────────────────┤
│                                              │
│ Template Name *                              │
│ [_________________________________]          │
│                                              │
│ Template Type *       Process *              │
│ [District ▼]         [Standard ▼]           │
│                                              │
│ District *                                   │
│ [Select district or tag... ▼]               │
│   (Shows districts + district tags)          │
│   (Filtered: no districtReportingExcluded)   │
│                                              │
│ Email Group *                                │
│ [Select email group... ▼]                   │
│                                              │
│ Frequency *                                  │
│ [Weekly ▼]                                  │
│                                              │
│ Day of Week *         Time *                 │
│ [Monday ▼]           [08:00]                │
│                                              │
│ Enabled                                      │
│ [✓] On  [ ] Off                            │
│                                              │
│ [Cancel]  [Save Schedule]                    │
└─────────────────────────────────────────────┘
```

### Template Type Changes

**When Template Type = "District":**
- Show: District dropdown
- Hide: Region dropdown, Subsidiary dropdown
- District dropdown loads from `/api/storage/districts`
- Includes individual districts AND district tags

**When Template Type = "Region":**
- Show: Region dropdown
- Hide: District dropdown, Subsidiary dropdown
- Region dropdown loads from `/api/storage/regions`
- Includes individual regions AND region tags

**When Template Type = "Subsidiary":**
- Show: Subsidiary dropdown
- Hide: District dropdown, Region dropdown
- Subsidiary dropdown loads from `/api/storage/departments`

### Frequency Changes

**When Frequency = "Daily":**
- Show: Time of Day
- Hide: Day of Week, Day of Month

**When Frequency = "Weekly":**
- Show: Day of Week, Time of Day
- Hide: Day of Month

**When Frequency = "Monthly":**
- Show: Day of Month, Time of Day
- Hide: Day of Week

## Report Schedules Table Display

```
| Template Name                          | Type       | Process     | Entity              | Email Group       | Frequency | Enabled | Actions |
|----------------------------------------|------------|-------------|---------------------|-------------------|-----------|---------|---------|
| Weekly West District Standard Report  | District   | Standard    | West (tag)          | District Managers | Weekly    | ✓ On    | ✏️ 🗑️   |
| Monthly Northeast Region Ops Review    | Region     | Operational | Northeast Region    | Regional Directors| Monthly   | ✓ On    | ✏️ 🗑️   |
| Executive Monthly Standard Report      | Subsidiary | Standard    | Yona Solutions      | Executive Team    | Monthly   | ✓ On    | ✏️ 🗑️   |
| Friday Facility Operational Summary    | District   | Operational | West (tag)          | West Facilities   | Weekly    | ✓ On    | ✏️ 🗑️   |
| West Region Weekly Ops (PAUSED)        | Region     | Operational | West Region         | Regional Directors| Weekly    | ✗ Off   | ✏️ 🗑️   |
```

## Example Mock Data

### Example 1: District Tag Report
```javascript
{
  id: 1,
  template_name: "Weekly West District Standard Report",
  template_type: "district",
  process: "standard",
  district_id: "tag_West",           // Using a district tag
  district_name: "West",             // Tag name
  region_id: null,
  region_name: null,
  subsidiary_id: null,
  subsidiary_name: null,
  email_group_id: 1,
  frequency: "weekly",
  day_of_week: "Monday",
  time_of_day: "08:00",
  enabled: true
}
```

### Example 2: Individual District Report
```javascript
{
  id: 2,
  template_name: "East District Monthly Report",
  template_type: "district",
  process: "operational",
  district_id: "1234",               // Specific district ID
  district_name: "East District",
  region_id: null,
  region_name: null,
  subsidiary_id: null,
  subsidiary_name: null,
  email_group_id: 1,
  frequency: "monthly",
  day_of_month: 5,
  time_of_day: "09:00",
  enabled: true
}
```

### Example 3: Region Report
```javascript
{
  id: 3,
  template_name: "Northeast Region Monthly Review",
  template_type: "region",
  process: "standard",
  district_id: null,
  district_name: null,
  region_id: "210",
  region_name: "Northeast Region",
  subsidiary_id: null,
  subsidiary_name: null,
  email_group_id: 2,
  frequency: "monthly",
  day_of_month: 1,
  time_of_day: "07:00",
  enabled: true
}
```

### Example 4: Subsidiary Report
```javascript
{
  id: 4,
  template_name: "Company-Wide Quarterly Review",
  template_type: "subsidiary",
  process: "standard",
  district_id: null,
  district_name: null,
  region_id: null,
  region_name: null,
  subsidiary_id: "yona_main",
  subsidiary_name: "Yona Solutions",
  email_group_id: 4,
  frequency: "monthly",
  day_of_month: 1,
  time_of_day: "06:00",
  enabled: true
}
```

## Validation Rules

1. **Template Name**: Required, max 255 characters
2. **Template Type**: Required, must be district/region/subsidiary
3. **Process**: Required, must be standard/operational
4. **Entity Field**: Exactly one must be populated based on template_type
5. **Email Group**: Required, must exist in email_groups table
6. **Frequency**: Required, must be daily/weekly/monthly
7. **Day of Week**: Required if frequency=weekly
8. **Day of Month**: Required if frequency=monthly, must be 1-31
9. **Time of Day**: Required, valid HH:MM format
10. **Enabled**: Required, boolean

## Integration with P&L Generation

When a schedule is due (`next_send_at <= NOW` and `enabled = true`):

1. **Determine Entity**:
   ```javascript
   const entityId = schedule.district_id || schedule.region_id || schedule.subsidiary_id;
   const hierarchyType = schedule.template_type; // 'district', 'region', or 'subsidiary'
   ```

2. **Generate P&L Report**:
   ```javascript
   const plData = await generatePL({
     hierarchy: hierarchyType,
     selectedId: entityId,
     date: currentMonth,
     plType: schedule.process  // 'standard' or 'operational'
   });
   ```

3. **Convert to PDF** (using existing PDFShift implementation)

4. **Send Email** to all contacts in `email_group_id`

5. **Update Schedule**:
   ```javascript
   last_sent_at = NOW;
   next_send_at = calculateNext(frequency, day_of_week, day_of_month, time_of_day);
   ```

## Summary

The email report schedule system provides a complete template-based approach to automated P&L report delivery:

- **Template-Based**: Named templates for easy management
- **Flexible Filtering**: Uses exact same logic as P&L View page
- **District Tags**: Supports both individual districts and district tag groups
- **Region Tags**: Supports both individual regions and region tag groups
- **Smart Scheduling**: Daily, weekly, or monthly with precise timing
- **Enable/Disable**: Easy on/off control without deletion
- **Full Integration**: Ready to integrate with existing P&L generation and PDF export

All mock data has been updated to reflect this new structure and is available for immediate testing at `/email-config`.

