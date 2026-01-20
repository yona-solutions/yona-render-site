# Critical Concepts & Implementation Notes

## Overview
This document captures the most important technical concepts and implementation details for the Yona P&L Reporting System. These are critical for understanding why certain design decisions were made and for maintaining the system correctly.

---

## 1. Account Rollup Logic

### The Problem
In financial reporting, accounts have parent-child relationships (e.g., "40100 Revenue - Housekeeping" → "40000 Revenue" → "Income"). When displaying a P&L, parent accounts need to show the sum of all their children.

### The Critical Insight: `displayExcluded` vs. Calculation
**CRITICAL**: The `displayExcluded` flag in `account_config.json` has a specific meaning that is easy to misunderstand:

- ✅ **What it means**: "Don't show this account as its own row in the P&L report"
- ❌ **What it does NOT mean**: "Don't include this account's value in parent totals"

### Real-World Example
```
Income                                  $100,000
  ├─ 40000 Revenue (displayExcluded)    $100,000  ← Hidden from display
      └─ 40100 Housekeeping Wages        $50,000
      └─ 40200 Housekeeping Supplies     $30,000
      └─ 40300 Laundry Wages             $20,000
```

**What you see in the report:**
```
Income                                  $100,000
```

**What happens in the calculation:**
1. Compute "40100 Housekeeping Wages" = $50,000
2. Compute "40200 Housekeeping Supplies" = $30,000  
3. Compute "40300 Laundry Wages" = $20,000
4. Roll up into "40000 Revenue" = $100,000
5. **Even though "40000 Revenue" has `displayExcluded=true`, it MUST roll up into "Income"**
6. Income = $100,000 ✅

**What would happen if we excluded `displayExcluded` accounts:**
```
Income = $0  ❌ WRONG! Revenue exists but isn't counted.
```

### Implementation
See `src/services/accountService.js` → `computeRollups()` function:

```javascript
// ALWAYS include children in parent rollups, regardless of displayExcluded
for (const childLabel of children) {
  const childConfig = labelToConfig[childLabel] || {};
  
  // Only exclude if operationalExcluded (different from displayExcluded)
  const shouldExclude = isOperational && childConfig.operationalExcluded;
  
  if (!shouldExclude) {
    total += compute(childLabel);  // Include ALL children
  }
}
```

### The Bug We Fixed
**Before Fix:**
- Code was excluding `displayExcluded` accounts from rollups
- Facilities showed Income = $0 even though they had revenue in child accounts
- Parent totals were incorrect

**After Fix:**
- `displayExcluded` only affects rendering (which rows to show)
- All accounts included in rollups for accurate totals
- Facilities now show correct Income values

---

## 2. YTD (Year-to-Date) Reporting

### Purpose
Financial analysis requires comparing:
- **Current Month**: Performance for a specific month (e.g., August 2025)
- **Year-to-Date**: Cumulative performance from January 1 through the selected month

### Implementation
Each P&L request generates **two BigQuery queries**:

**Month Query:**
```sql
WHERE time_date = @date  -- Only August 2025
```

**YTD Query:**
```sql
WHERE time_date <= @date                        -- Through August 2025
  AND time_date >= DATE_TRUNC(@date, YEAR)      -- From January 1, 2025
```

### Data Flow
```
API Request (hierarchy, selectedId, date)
    ↓
BigQueryService.getPLData({ ytd: false })  → Month data
BigQueryService.getPLData({ ytd: true })   → YTD data
    ↓
AccountService.computeRollups() for both datasets
    ↓
PnlRenderService.generatePNLReport(monthData, ytdData)
    ↓
HTML with side-by-side columns:
  [Month: Actual | % | Budget] [YTD: Actual | % | Budget]
```

### Performance Consideration
- YTD queries scan more data (up to 12 months vs. 1 month)
- Both queries run in parallel (not sequential)
- Response time: ~2-3 seconds for district with 10 facilities

---

## 3. Multi-Level District Rendering

### Purpose
Districts need both:
1. **Aggregate view**: Total performance across all facilities
2. **Individual breakdown**: Each facility's detailed P&L

### Implementation Flow

**Step 1: Get District Customers**
```javascript
const customers = await storageService.getCustomersForDistrict(districtId);
// Returns: [{ id, label, customer_internal_id, parent }, ...]
```

**Step 2: Generate District Summary**
```javascript
// Query BigQuery with ALL customer IDs
const districtData = await bigQueryService.getPLData({
  hierarchy: 'district',
  customerIds: [101, 102, 103, ...],  // All facilities
  ytd: false
});

// Generate summary HTML
const districtHTML = pnlRenderService.generatePNLReport(districtData, ytdData, ...);
```

**Step 3: Generate Individual Facility P&Ls**
```javascript
for (const customer of customers) {
  // Query BigQuery for JUST this facility
  const facilityData = await bigQueryService.getPLData({
    hierarchy: 'district',
    customerIds: [customer.customer_internal_id],  // Single facility
    ytd: false
  });
  
  // Generate facility HTML
  const facilityHTML = pnlRenderService.generatePNLReport(facilityData, ytdData, ...);
  
  // Only include if facility has revenue
  if (!facilityResult.noRevenue) {
    htmlParts.push(facilityHTML);
  }
}
```

**Step 4: Combine**
```javascript
const finalHTML = htmlParts.join('\n');  // District + Facility1 + Facility2 + ...
```

### Revenue Filter
Facilities are only included if `Income > 0` after rollups:
- Prevents empty/zero reports
- Matches Retool behavior
- Keeps response size manageable

### Performance
**Example: District 101 with 11 facilities**
- 1 district summary query (Month + YTD) = 2 queries
- 11 facility queries × 2 (Month + YTD) = 22 queries  
- **Total: 24 BigQuery queries**
- Response time: ~3-4 seconds
- HTML size: ~360KB

---

## 4. Hierarchy System

### Three Hierarchy Types

1. **District**: Geographic/operational groupings of facilities
   - Data source: `customer_config.json`
   - Filter: `isDistrict === true`
   - Children: Customers (facilities)
   - ID mapping: `customer_internal_id`

2. **Region**: Geographic regions containing multiple districts
   - Data source: `region_config.json`
   - Filter: `parent === '2'` (leaf nodes only)
   - ID mapping: `region_internal_id`

3. **Subsidiary**: Legal entities/departments
   - Data source: `department_config.json`
   - Filter: `parent === '2'` (leaf nodes only)
   - ID mapping: `subsidiary_internal_id`

### Tag System
Tags are groupings that span multiple items:
```json
{
  "id": "1971",
  "label": "District 101",
  "isDistrict": true,
  "tags": ["District 121 - Ben Riegel"]  // This facility is tagged
}
```

When a user selects a tag, the system:
1. Finds all items with that tag
2. Collects their `customer_internal_id` values
3. Queries BigQuery with `customer_internal_id IN (...)` filter

---

## 5. API Design for Workflow Automation

### Key Principle: Stateless HTML Generation
The `/api/pl/data` endpoint is designed to be called from anywhere:
- Web frontend (current use)
- Zapier workflows
- Python scripts
- Email automation tools

### Request Format
```
GET /api/pl/data?hierarchy=district&selectedId=1971&date=2025-08-01
```

### Response Format
```json
{
  "html": "<div class='pnl-report-container'>...</div>",
  "hierarchy": "district",
  "selectedLabel": "District 101",
  "date": "2025-08-01",
  "facilityCount": 10,
  "meta": { ... }
}
```

### Usage in Workflows
```python
# Example: Send P&L email via Python
import requests

response = requests.get(
    'https://yona-render-site.onrender.com/api/pl/data',
    params={
        'hierarchy': 'district',
        'selectedId': '1971',
        'date': '2025-08-01'
    }
)

html_content = response.json()['html']

# Send via email
send_email(
    to='manager@company.com',
    subject='District 101 P&L - August 2025',
    html_body=html_content
)
```

---

## 6. Configuration Files Structure

All configuration files stored in GCP Cloud Storage bucket: `dimension_configurations`

### account_config.json
```json
{
  "1540": {
    "label": "Income",
    "parent": 2,
    "displayExcluded": false,
    "operationalExcluded": false
  },
  "1541": {
    "label": "40000 Revenue",
    "parent": 1540,
    "displayExcluded": true,      // Hidden but included in rollups
    "operationalExcluded": false
  }
}
```

### customer_config.json
```json
{
  "1971": {
    "id": "1971",
    "label": "District 101 - John Miller",
    "parent": "101",
    "isDistrict": true,
    "customer_internal_id": null,  // Districts don't have customer IDs
    "tags": ["District 121 - Ben Riegel"]
  },
  "AMB01": {
    "id": "AMB01",
    "label": "Ambassador, a Villa Center 39",
    "parent": "1971",              // Child of District 101
    "customer_internal_id": 39,    // Facilities have customer IDs
    "tags": []
  }
}
```

### Finding Children
```javascript
// To find all facilities in a district:
const facilities = Object.values(customerConfig).filter(
  c => c.parent === districtId || c.tags.includes(districtId)
);

// Extract customer IDs for BigQuery
const customerIds = facilities.map(f => f.customer_internal_id);
```

---

## 7. Common Pitfalls & Solutions

### Pitfall 1: Treating displayExcluded as a calculation flag
**Wrong**: Skip `displayExcluded` accounts in rollups  
**Right**: Always include in rollups, only skip in rendering

### Pitfall 2: Forgetting to fetch YTD data
**Wrong**: Pass `null` for `ytdData` parameter  
**Right**: Always fetch both Month and YTD data

### Pitfall 3: Using account IDs instead of labels
**Wrong**: Index by `account_internal_id` (e.g., `1540`)  
**Right**: Index by `label` (e.g., `"Income"`)

### Pitfall 4: Including zero-revenue facilities
**Wrong**: Show all facilities regardless of revenue  
**Right**: Filter out facilities where `Income === 0` after rollups

### Pitfall 5: Treating tags as entities
**Wrong**: Query BigQuery with tag as an ID  
**Right**: Resolve tags to actual customer IDs first

---

## 8. Testing Critical Paths

### Test 1: Rollup Logic
```bash
curl 'http://localhost:3000/api/pl/data?hierarchy=district&selectedId=1971&date=2025-08-01'
```
**Verify**: Income > 0 for facilities (not 0)

### Test 2: YTD Data
Check HTML for two sets of columns:
- Month: Actual, %, Budget
- YTD: Actual, %, Budget

### Test 3: Multi-Level Rendering
**Verify**: HTML contains:
- 1 district report (Type: District)
- N facility reports (Type: Facility)
- No facilities with zero income

### Test 4: Tag Resolution
```bash
curl 'http://localhost:3000/api/pl/data?hierarchy=district&selectedId=tag_District%20121&date=2025-08-01'
```
**Verify**: Includes all facilities tagged with "District 121"

---

## Conclusion

These critical concepts are the foundation of the P&L reporting system. Understanding them is essential for:
- Maintaining the codebase
- Debugging issues
- Adding new features
- Training new developers

When in doubt, refer back to these principles, especially:
1. **Rollup Logic**: Always include `displayExcluded` accounts
2. **YTD**: Always fetch both Month and YTD data
3. **Multi-Level**: District = summary + facilities with revenue

