# Multi-Level P&L Implementation

## Overview

This document describes the implementation of multi-level P&L (Profit & Loss) reporting across three hierarchies: District, Region, and Subsidiary.

## Architecture

### Hierarchy Structures

1. **District View**
   - Structure: `District → Facilities`
   - Supports both direct district selection and tag-based grouping
   - Tags aggregate multiple districts with the same tag

2. **Region View** (within Subsidiary tab with optional Region filter)
   - Structure: `Region → Districts → Facilities`
   - Uses BigQuery `dim_customers` table to determine hierarchy
   - Optional subsidiary filter to narrow results

3. **Subsidiary View**
   - Structure: `Subsidiary → Regions → Districts → Facilities`
   - Uses BigQuery `dim_customers` table to determine hierarchy
   - Optional region filter to narrow results

## Performance Optimization

All three hierarchies use an **optimized query pattern** that minimizes BigQuery queries:

### Before Optimization
- **District** (N customers): 2 + 2N queries = ~30 queries for 14 customers
- **Region**: 2 + 2N queries per district
- **Subsidiary**: Even more queries

### After Optimization
All hierarchies now use **exactly 4 BigQuery queries** total:

1. **Query 1**: Summary level Month data (District/Region/Subsidiary)
2. **Query 2**: Summary level YTD data
3. **Query 3**: All customers Month data (using `IN` statement)
4. **Query 4**: All customers YTD data (using `IN` statement)

**In-Memory Filtering**: After retrieving all customer data, we filter in memory using `accountService.filterDataByCustomers()` for each:
- Region (from all customers in subsidiary)
- District (from all customers in region/subsidiary)
- Facility (individual customer)

### Performance Gains
- **87-95% reduction** in BigQuery queries
- Faster response times
- Lower BigQuery costs
- Scalable to any number of customers

## Tag Handling

### District Tags

Tags allow grouping multiple districts under a single selectable item in the dropdown.

#### Tag ID Format
- Tag IDs are prefixed with `tag_`: `tag_District 121 - Ben Riegel`
- The tag value (after `tag_`) may contain spaces and hyphens
- **Important**: Tag IDs are NOT split on ` - ` like regular IDs

#### Tag Parsing Logic
```javascript
if (selectedId.startsWith('tag_')) {
  actualId = selectedId;  // Keep full ID: "tag_District 121 - Ben Riegel"
  selectedLabel = selectedId.substring(4);  // Display: "District 121 - Ben Riegel"
}
```

#### Tag Filtering Logic

**Key Behavior**: For tag selections, `districtReportingExcluded` is **ignored**.

- **Direct district selection**: Respects `districtReportingExcluded` flag
- **Tag selection**: Ignores `districtReportingExcluded`, only checks `displayExcluded`

**Rationale**: Tags represent logical groupings that supersede individual district exclusions. If a district has a tag, it should be included when that tag is selected, even if `districtReportingExcluded: true`.

## Filter Implementation

### Subsidiary Tab - Region Filter

**Location**: Subsidiary tab dropdown (optional)

**Behavior**:
- Filters top-level subsidiary summary by `subsidiary_internal_id` AND `region_internal_id`
- Filters customer list from `dim_customers` by both IDs
- Groups remaining customers by region → district → facility

**Implementation**:
```javascript
// In api.js
const regionFilter = req.query.regionFilter;
if (regionFilter && regionFilter !== 'all') {
  regionId = await storageService.getRegionInternalId(regionFilter);
}
const customersInSubsidiary = await bigQueryService.getCustomersInSubsidiary(
  subsidiaryId, 
  regionId  // Optional filter
);
```

### Region Tab - Subsidiary Filter

**Location**: Region tab dropdown (optional)

**Behavior**:
- Filters top-level region summary by `region_internal_id` AND `subsidiary_internal_id`
- Filters customer list from `dim_customers` by both IDs
- Groups remaining customers by district → facility

## Header Regeneration

### Problem
Initial P&L headers show counts (districts, facilities) as 0 or total counts, not actual counts after filtering out entities with no revenue.

### Solution
After generating all sub-reports:
1. Count actual entities with revenue
2. Update meta object with real counts
3. **Regenerate** header with `pnlRenderService.generateHeader()`
4. **Reconstruct** HTML by splitting on `<hr class="pnl-divider">` and combining new header with original content

### HTML Structure
```html
<div class="pnl-report-container page-break">
  ${headerHtml}
  <hr class="pnl-divider">
  <table class="pnl-report-table">
    ...
  </table>
</div>
```

### Reconstruction Pattern
```javascript
// Split on divider
const parts = originalHtml.split('<hr class="pnl-divider">');
const contentHtml = parts[1];

// Reconstruct with new header
const updatedHtml = `    <div class="pnl-report-container page-break">
      ${newHeaderHtml}
      <hr class="pnl-divider">${contentHtml}`;
```

## Data Flow

### Subsidiary View Example

1. **User selects subsidiary** (optionally filters by region)
2. **Backend queries**:
   - `bigQueryService.getCustomersInSubsidiary(subsidiaryId, regionId)`
   - Returns all customers in subsidiary (optionally filtered by region)
3. **Group customers**:
   - `storageService.groupCustomersByRegionAndDistrict(customers)`
   - Groups by `region_internal_id` from BigQuery data
   - Then groups by parent district from `customer_config.json`
4. **Query BigQuery** (4 queries total):
   - Subsidiary summary (Month + YTD)
   - All customers (Month + YTD with `IN` statement)
5. **Filter in memory**:
   - For each region: filter customer data by region's customer IDs
   - For each district: filter by district's customer IDs
   - For each facility: filter by single customer ID
6. **Generate reports**:
   - Subsidiary summary
   - Region summaries (with district/facility counts)
   - District summaries (with facility counts)
   - Facility P&Ls (only those with revenue)
7. **Update headers** with actual counts
8. **Return** combined HTML

## Key Files

### Backend
- **`src/routes/api.js`**
  - Main P&L generation logic
  - Tag ID parsing
  - Multi-level rendering for all hierarchies
  - Filter handling

- **`src/services/storageService.js`**
  - `getCustomersForDistrict()`: Handles tags and districts
  - `groupCustomersByDistrict()`: Groups customers by parent district
  - `groupCustomersByRegionAndDistrict()`: Two-level grouping for subsidiary view

- **`src/services/bigQueryService.js`**
  - `getCustomersInRegion()`: Fetches customers by region (optional subsidiary filter)
  - `getCustomersInSubsidiary()`: Fetches customers by subsidiary (optional region filter)
  - `getPLData()`: Optimized to handle customer ID arrays with `IN` statements

- **`src/services/accountService.js`**
  - `filterDataByCustomers()`: In-memory filtering by customer IDs

- **`src/services/pnlRenderService.js`**
  - `generateHeader()`: Exported function to regenerate headers
  - `generatePNLReport()`: Main report generation

### Frontend
- **`public/pl-view.html`**
  - Region filter dropdown for Subsidiary tab
  - Subsidiary filter dropdown for Region tab
  - `SearchableSelect` component with `autoSelectFirst` parameter

## Testing

### District View with Tags
1. Select District tab
2. Choose a tag like "District 121 - Ben Riegel"
3. Verify district summary + facility P&Ls display
4. Check header shows correct facility count

### Region View (Subsidiary Tab)
1. Select Subsidiary tab
2. Choose a subsidiary
3. Optionally select a region filter
4. Verify: Subsidiary → Regions → Districts → Facilities hierarchy
5. Check counts in headers are accurate

### Performance Verification
Check server logs for:
```
🚀 Performance: Used only 4 BigQuery queries instead of XX
```

## Migration Notes

- All existing district/region/subsidiary P&L functionality remains intact
- Tags are backward compatible
- Filters are optional (default to no filter)
- Performance improvement is automatic for all views

## Future Enhancements

Potential improvements:
- Cache BigQuery results for repeated requests
- Parallel processing of sub-reports
- Progressive loading for large hierarchies
- Export to PDF/Excel with maintained hierarchy


