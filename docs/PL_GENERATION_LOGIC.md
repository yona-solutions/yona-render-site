# P&L Generation Logic Documentation

## Table of Contents
1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Hierarchy Levels](#hierarchy-levels)
4. [Data Flow](#data-flow)
5. [Configuration Management](#configuration-management)
6. [Query Optimization](#query-optimization)
7. [P&L Generation Process](#pl-generation-process)
8. [API Endpoints](#api-endpoints)
9. [Tag System](#tag-system)
10. [Special Features](#special-features)

---

## Overview

The P&L (Profit & Loss) generation system creates hierarchical financial reports for Yona Solutions' multi-level organizational structure. The system supports three main hierarchy levels:

- **District Level**: Individual districts containing multiple facilities (customers)
- **Region Level**: Geographic regions containing multiple districts and facilities
- **Subsidiary Level**: Legal subsidiaries containing multiple regions, districts, and facilities

### Key Design Principles

1. **Performance**: Minimize BigQuery queries through intelligent data fetching and in-memory filtering
2. **Flexibility**: Support both direct selection and tag-based aggregation at each level
3. **Consistency**: Use the same rendering logic across all hierarchy levels
4. **Scalability**: Handle hundreds of facilities efficiently

---

## System Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (pl-view.html)               │
│  - Hierarchy selection (District/Region/Subsidiary)          │
│  - Date picker                                               │
│  - P&L Type toggle (Standard/Operational)                   │
│  - Filter controls (Region/Subsidiary filters)              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ HTTP Request
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    API Layer (api.js)                        │
│  - Request validation                                        │
│  - Configuration loading                                     │
│  - Query parameter building                                  │
│  - Multi-level P&L orchestration                            │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│  Storage    │ │  BigQuery   │ │   Render    │
│  Service    │ │  Service    │ │   Service   │
│             │ │             │ │             │
│ - GCS       │ │ - Queries   │ │ - HTML      │
│ - Config    │ │ - Dim       │ │ - Headers   │
│ - Grouping  │ │   Tables    │ │ - Accounts  │
└─────────────┘ └─────────────┘ └─────────────┘
```

### Data Sources

1. **Google Cloud Storage (GCS)**
   - `account_config.json`: Account hierarchy and properties
   - `customer_config.json`: Customer (facility) mappings to districts
   - `region_config.json`: Region configurations and mappings
   - `department_config.json`: Subsidiary configurations and mappings

2. **BigQuery Tables**
   - `fct_transactions_summary`: Financial transaction data
   - `dim_customers`: Customer dimension table
   - `dim_subsidiaries`: Subsidiary dimension table

3. **Google Sheets**
   - Census data (budget and actuals)

---

## Hierarchy Levels

### 1. District Level

**Structure**: District → Facilities (Customers)

**Selection Types**:
- **Single District**: Select one district by ID
- **District Tag**: Aggregate multiple districts with the same tag

**Data Flow**:
```
1. User selects district or tag
2. System finds all customers in that district/tag
3. Queries BigQuery for:
   - District summary (Month + YTD)
   - All customer details (Month + YTD)
4. Generates:
   - District summary P&L
   - Individual facility P&Ls (for customers with revenue)
```

**Query Optimization**:
- **4 BigQuery queries total** regardless of number of facilities
- In-memory filtering for individual facilities

### 2. Region Level

**Structure**: Region → Districts → Facilities

**Selection Types**:
- **Single Region**: Select one region by ID
- **Region Tag**: Aggregate multiple regions with the same tag

**Optional Filters**:
- Subsidiary filter: Narrow down to specific subsidiary within region

**Data Flow**:
```
1. User selects region/tag (+ optional subsidiary filter)
2. System queries dim_customers for all customers in region
3. Groups customers by their parent districts
4. Queries BigQuery for:
   - Region summary (Month + YTD)
   - All customer details (Month + YTD)
5. Generates:
   - Region summary P&L
   - District summary P&Ls (for each district)
   - Individual facility P&Ls (for customers with revenue)
```

**Query Optimization**:
- **4 BigQuery queries total** regardless of number of districts/facilities
- In-memory filtering and grouping

### 3. Subsidiary Level

**Structure**: Subsidiary → Regions → Districts → Facilities

**Selection Types**:
- **Single Subsidiary**: Select one subsidiary by ID
- **Subsidiary Tag**: Aggregate multiple subsidiaries with the same tag

**Optional Filters**:
- Region filter: Narrow down to specific region within subsidiary

**Data Flow**:
```
1. User selects subsidiary/tag (+ optional region filter)
2. System queries dim_customers for all customers in subsidiary
3. Groups customers by region, then by district
4. Queries BigQuery for:
   - Subsidiary summary (Month + YTD)
   - All customer details (Month + YTD)
5. Generates:
   - Subsidiary summary P&L
   - Region summary P&Ls (for each region)
   - District summary P&Ls (for each district)
   - Individual facility P&Ls (for customers with revenue)
```

**Query Optimization**:
- **4 BigQuery queries total** regardless of hierarchy depth
- Multi-level in-memory grouping and filtering

---

## Data Flow

### Request Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. HTTP Request                                              │
│    GET /api/pl/data?hierarchy=subsidiary&selectedId=3        │
│                     &date=2025-12-01&plType=standard         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Parse & Validate                                          │
│    - Extract hierarchy type (district/region/subsidiary)     │
│    - Parse selectedId (handle "id - label" format)           │
│    - Detect tags (IDs starting with "tag_")                  │
│    - Validate date format                                    │
│    - Determine P&L type (Standard/Operational)               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Load Configuration                                        │
│    - account_config.json from GCS                            │
│    - customer_config.json (if needed)                        │
│    - region_config.json (if needed)                          │
│    - department_config.json (if needed)                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Resolve IDs & Get Customers                               │
│    - For District: Get customers in district/tag             │
│    - For Region: Query dim_customers by region_internal_id   │
│    - For Subsidiary: Query dim_customers by subsidiary_id    │
│    - Group customers by hierarchy (district/region)          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Query BigQuery (4 queries)                                │
│    a. Summary Month data                                     │
│    b. Summary YTD data                                       │
│    c. All customers Month data                               │
│    d. All customers YTD data                                 │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Generate P&L Reports                                      │
│    - Summary P&L for top level                               │
│    - Sub-summaries for intermediate levels                   │
│    - Individual facility P&Ls (revenue > 0 only)             │
│    - Update headers with actual counts                       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Return HTML Response                                      │
│    - Complete HTML with all P&L reports                      │
│    - Metadata (counts, labels, dates)                        │
│    - No revenue flag (if applicable)                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Configuration Management

### Account Configuration (`account_config.json`)

Defines the account hierarchy and properties.

**Key Properties**:
- `label`: Display name
- `parent`: Parent account ID (for hierarchy)
- `account_internal_id`: Maps to BigQuery account ID
- `order`: Display order in P&L
- `displayExcluded`: Hide from all P&L reports
- `operationalExcluded`: Hide from Operational P&L only
- `doubleLines`: Add visual separator after account
- `type`: BASIC, TOTAL_SUM, or TOTAL_SUM_REVERSE

**Hierarchy Example**:
```json
{
  "100": {
    "label": "Revenue",
    "parent": "1",
    "order": 1,
    "account_internal_id": 12345
  },
  "200": {
    "label": "Cost of Goods Sold",
    "parent": "1",
    "order": 2,
    "account_internal_id": 12346
  }
}
```

### Customer Configuration (`customer_config.json`)

Maps facilities to districts and contains customer metadata.

**Key Properties**:
- `customer_internal_id`: Maps to BigQuery customer ID
- `customer_code`: Customer code (e.g., "ARM51")
- `parent`: Parent district ID
- `isDistrict`: Boolean flag for district nodes
- `districtTags`: Array of district tags
- `customerTags`: Array of customer tags
- `start_date_est`: Estimated start date
- `districtReportingExcluded`: Exclude from district reports

**Example**:
```json
{
  "101": {
    "label": "District North",
    "isDistrict": true,
    "districtTags": ["Premium", "Urban"]
  },
  "1001": {
    "label": "ARM51 - Wellstone Armada",
    "parent": "101",
    "customer_internal_id": 17001,
    "customer_code": "ARM51",
    "start_date_est": "2023-01-15"
  }
}
```

### Region Configuration (`region_config.json`)

Maps regions to BigQuery region IDs.

**Key Properties**:
- `region_internal_id`: Maps to BigQuery region ID
- `tags`: Array of region tags

### Department/Subsidiary Configuration (`department_config.json`)

Maps subsidiaries to BigQuery subsidiary IDs.

**Key Properties**:
- `subsidiary_internal_id`: Maps to BigQuery subsidiary ID
- `tags`: Array of subsidiary tags

---

## Query Optimization

### The 4-Query Pattern

All P&L reports use the same optimization pattern:

1. **Summary Month Query**: Aggregate data for the entire hierarchy
2. **Summary YTD Query**: Year-to-date aggregate for the entire hierarchy
3. **All Customers Month Query**: Individual customer data (filtered in-memory)
4. **All Customers YTD Query**: Year-to-date individual customer data

### Why This Is Fast

**Traditional Approach** (would be slow):
```
For each facility:
  - Query month data (1 query)
  - Query YTD data (1 query)
Total: 2N queries (where N = number of facilities)

For 100 facilities: 200 queries (~60 seconds)
```

**Optimized Approach** (current):
```
1. Query summary month data (1 query)
2. Query summary YTD data (1 query)
3. Query all customers month data (1 query)
4. Query all customers YTD data (1 query)
Total: 4 queries regardless of N

For 100 facilities: 4 queries (~2 seconds)
```

### In-Memory Filtering

After fetching all customer data, the system filters in memory:

```javascript
// Example: Filter data for a specific customer
function filterDataForCustomer(allData, customerId) {
  const filtered = {
    Account: [],
    Scenario: [],
    Value: []
  };
  
  for (let i = 0; i < allData.customer_internal_id.length; i++) {
    if (allData.customer_internal_id[i] === customerId) {
      filtered.Account.push(allData.Account[i]);
      filtered.Scenario.push(allData.Scenario[i]);
      filtered.Value.push(allData.Value[i]);
    }
  }
  
  return filtered;
}
```

This is extremely fast (microseconds) compared to network round-trip to BigQuery (seconds).

### BigQuery Query Structure

**Example Query** (District):
```sql
SELECT
  account_internal_id,
  customer_internal_id,
  region_internal_id,
  subsidiary_internal_id,
  scenario,
  SUM(value) AS value
FROM `dbt_production.fct_transactions_summary`
WHERE time_date = @date
  AND customer_internal_id IN UNNEST(@customerIds)
GROUP BY
  account_internal_id,
  customer_internal_id,
  region_internal_id,
  subsidiary_internal_id,
  scenario
ORDER BY
  account_internal_id,
  customer_internal_id
```

**Parameters**:
- `@date`: Target date (YYYY-MM-01 format)
- `@customerIds`: Array of customer IDs to include

---

## P&L Generation Process

### Step-by-Step: District Level

```
1. Parse Request
   ├─ Extract district ID (e.g., "101" or "tag_Urban")
   └─ Detect if tag (starts with "tag_")

2. Get Customers
   ├─ If single district: Find children in customer_config.json
   └─ If tag: Find all districts with tag, then all their children

3. Query BigQuery (4 queries)
   ├─ District Month: WHERE customer_internal_id IN (...)
   ├─ District YTD: WHERE customer_internal_id IN (...) AND time_date <= @date
   ├─ Customers Month: WHERE customer_internal_id IN (...)
   └─ Customers YTD: WHERE customer_internal_id IN (...) AND time_date <= @date

4. Generate District Summary
   ├─ Process account hierarchy
   ├─ Calculate totals
   ├─ Render HTML with header (placeholder counts)
   └─ Store for later

5. Generate Facility P&Ls
   ├─ For each customer:
   │  ├─ Filter month data (in memory)
   │  ├─ Filter YTD data (in memory)
   │  ├─ Check for revenue
   │  ├─ If revenue > 0:
   │  │  ├─ Get census data (if available)
   │  │  ├─ Generate P&L report
   │  │  └─ Add to facility list
   │  └─ Increment facility count
   └─ Store facility reports

6. Update Headers
   ├─ Update district header with actual facility count
   └─ Regenerate header HTML

7. Combine & Return
   ├─ District summary HTML
   ├─ All facility P&L HTMLs
   └─ Metadata (counts, labels, dates)
```

### Step-by-Step: Region Level

```
1. Parse Request
   ├─ Extract region ID
   ├─ Check for subsidiary filter
   └─ Detect if tag

2. Resolve Region ID(s)
   ├─ If single region: Get region_internal_id from config
   └─ If tag: Get all region_internal_ids with that tag

3. Query dim_customers
   ├─ WHERE region_internal_id = @regionId
   └─ Optional: AND subsidiary_internal_id = @subsidiaryId

4. Group Customers
   ├─ Group by parent district
   ├─ Build district groups with customer lists
   └─ Track district metadata

5. Query BigQuery (4 queries)
   ├─ Region Month: WHERE region_internal_id = ...
   ├─ Region YTD
   ├─ All Customers Month
   └─ All Customers YTD

6. Generate Region Summary
   └─ With placeholder counts

7. For Each District Group
   ├─ Filter data for district's customers (in memory)
   ├─ Generate district summary P&L
   ├─ For each customer in district:
   │  ├─ Filter data for customer (in memory)
   │  ├─ Check for revenue
   │  └─ Generate facility P&L if revenue > 0
   └─ Update district header

8. Update Region Header
   └─ With actual district and facility counts

9. Combine & Return
   ├─ Region summary
   ├─ District summaries
   └─ Facility P&Ls
```

### Step-by-Step: Subsidiary Level

```
1. Parse Request
   ├─ Extract subsidiary ID
   ├─ Check for region filter
   └─ Detect if tag

2. Resolve Subsidiary ID(s)
   ├─ If single subsidiary: Get subsidiary_internal_id from config
   └─ If tag: Get all subsidiary_internal_ids with that tag

3. Query dim_customers
   ├─ WHERE subsidiary_internal_id IN (...)
   └─ Optional: AND region_internal_id = @regionId

4. Group Customers
   ├─ Group by region_internal_id
   ├─ Within each region, group by parent district
   └─ Track region and district metadata

5. Query BigQuery (4 queries)
   ├─ Subsidiary Month: WHERE subsidiary_internal_id IN (...)
   ├─ Subsidiary YTD
   ├─ All Customers Month
   └─ All Customers YTD

6. Generate Subsidiary Summary
   └─ With placeholder counts

7. For Each Region Group
   ├─ Filter data for region (in memory)
   ├─ Generate region summary P&L
   ├─ For each district in region:
   │  ├─ Filter data for district (in memory)
   │  ├─ Generate district summary P&L
   │  ├─ For each customer in district:
   │  │  ├─ Filter data for customer (in memory)
   │  │  ├─ Check for revenue
   │  │  └─ Generate facility P&L if revenue > 0
   │  └─ Update district header
   └─ Update region header

8. Update Subsidiary Header
   └─ With actual region, district, and facility counts

9. Combine & Return
   ├─ Subsidiary summary
   ├─ Region summaries
   ├─ District summaries
   └─ Facility P&Ls
```

---

## API Endpoints

### Main P&L Endpoint

```
GET /api/pl/data
```

**Query Parameters**:
- `hierarchy`: "district" | "region" | "subsidiary"
- `selectedId`: ID or tag ID (format: "id" or "tag_TagName")
- `date`: Date in YYYY-MM-01 format
- `plType`: "standard" | "operational" (default: "standard")
- `regionFilter`: (Optional, for subsidiary view) Region ID to filter
- `subsidiaryFilter`: (Optional, for region view) Subsidiary ID to filter

**Response**:
```json
{
  "html": "<div>...</div>",
  "hierarchy": "subsidiary",
  "selectedId": "3",
  "selectedLabel": "Yona NorthStar, LLC",
  "date": "2025-12-01",
  "noRevenue": false,
  "regionCount": 2,
  "districtCount": 5,
  "facilityCount": 23,
  "meta": {
    "typeLabel": "Subsidiary",
    "entityName": "Yona NorthStar, LLC",
    "plType": "Standard"
  }
}
```

### Configuration Endpoints

```
GET /api/config/account       # Account hierarchy
GET /api/config/customer      # Customer mappings
GET /api/config/region        # Region configurations
GET /api/config/department    # Subsidiary configurations
```

### Hierarchy Data Endpoints

```
GET /api/storage/districts      # List of districts and district tags
GET /api/storage/regions        # List of regions and region tags
GET /api/storage/departments    # List of subsidiaries and subsidiary tags
```

### BigQuery Data Endpoints

```
GET /api/customers              # All customers from dim_customers
GET /api/bq/regions            # All unique region IDs from BigQuery
GET /api/bq/subsidiaries       # All subsidiaries from dim_subsidiaries
```

### Census Data Endpoints

```
GET /api/census/all            # All census data
GET /api/census/customer       # Census for specific customer and month
```

---

## Tag System

### Overview

Tags enable logical grouping across hierarchy levels without changing the organizational structure. Tags are defined in configuration files and can aggregate multiple entities.

### District Tags

**Purpose**: Group multiple districts for reporting

**Example Use Cases**:
- Geographic grouping: "Urban", "Rural", "Coastal"
- Performance tiers: "Premium", "Standard", "Development"
- Operational status: "Ramping Up", "Stable", "Downsizing"

**Configuration**:
```json
{
  "101": {
    "label": "District North",
    "isDistrict": true,
    "districtTags": ["Urban", "Premium"]
  },
  "102": {
    "label": "District South",
    "isDistrict": true,
    "districtTags": ["Urban", "Standard"]
  }
}
```

**Selection**:
- Tag ID format: `tag_Urban`
- Aggregates all districts with "Urban" tag
- Shows as "District Tag: Urban" in header

### Region Tags

**Purpose**: Group multiple regions for reporting

**Example Use Cases**:
- Market segments: "Expansion Markets", "Core Markets"
- Service types: "Dining", "Healthcare"

**Configuration**:
```json
{
  "101": {
    "label": "Northeast Region",
    "region_internal_id": 2,
    "tags": ["Expansion Markets"]
  }
}
```

### Subsidiary Tags

**Purpose**: Group multiple legal subsidiaries

**Example Use Cases**:
- Ownership structure: "Parent Companies", "Staff Leasing"
- Geographic consolidation: "Eastern Operations", "Western Operations"

**Configuration**:
```json
{
  "5": {
    "label": "Yona Eagle Staff Leasing, LLC",
    "subsidiary_internal_id": 12,
    "tags": ["Staff Leasing", "Eastern Operations"]
  }
}
```

**BigQuery Filtering**:
- For single subsidiary: `WHERE subsidiary_internal_id = 12`
- For subsidiary tag: `WHERE subsidiary_internal_id IN (11, 12, 13)`

### Tag Implementation Details

**Tag Detection**:
```javascript
const isTag = selectedId.startsWith('tag_');
const tagValue = selectedId.substring(4); // Remove "tag_" prefix
```

**Finding Tagged Entities**:
```javascript
// Example: Find all subsidiaries with tag
const subsidiaryIds = [];
for (const [id, config] of Object.entries(configData)) {
  const tags = config.tags || [];
  if (tags.includes(tagValue)) {
    subsidiaryIds.push(config.subsidiary_internal_id);
  }
}
```

**BigQuery Query for Tags**:
```sql
-- Single ID
WHERE subsidiary_internal_id = @subsidiaryId

-- Multiple IDs (tag)
WHERE subsidiary_internal_id IN UNNEST(@subsidiaryIds)
```

---

## Special Features

### P&L Types: Standard vs Operational

**Standard P&L**:
- Excludes accounts with `displayExcluded: true`
- Shows all operational accounts
- Default view

**Operational P&L**:
- Excludes accounts with `displayExcluded: true`
- ALSO excludes accounts with `operationalExcluded: true`
- Focuses on core operational metrics

**Implementation**:
```javascript
// Filter accounts based on P&L type
const excludeAccount = (account, plType) => {
  if (account.displayExcluded) return true;
  if (plType === 'operational' && account.operationalExcluded) return true;
  return false;
};
```

### Census Data Integration

**Source**: Google Sheets (`census_flattened_safe`)

**Data Structure**:
- `type`: "Actuals" or "Budget"
- `customer_code`: Matches customer code in customer_config
- `month`: Date in MM/DD/YYYY format
- `value`: Census count

**Display**:
- Only shown on individual facility P&Ls
- Format: "Census Actual: 101.5" and "Census Budget: 105.0"
- Not shown on district/region/subsidiary summaries

**Matching Logic**:
```javascript
const census = await censusService.getCensusForCustomer(
  customer.customer_code,
  date
);

if (census.actual || census.budget) {
  meta.actualCensus = census.actual;
  meta.budgetCensus = census.budget;
}
```

### Start Date Display

**Source**: `start_date_est` field in customer configuration

**Display**:
- Only shown on individual facility P&Ls
- Format: "Start Date: 01/15/2023" (MM/DD/YYYY)
- Pulled from BigQuery dim_customers table

### Revenue Check

**Logic**: Only generate facility P&L if revenue > 0

```javascript
const hasRevenue = facilityMonthData.Account.some((acct, idx) => {
  const isRevenueAccount = acct >= 12000 && acct < 13000;
  const value = facilityMonthData.Value[idx];
  return isRevenueAccount && Math.abs(value) > 0.01;
});

if (!hasRevenue) {
  continue; // Skip this facility
}
```

This prevents generating empty reports for inactive facilities.

### Header Count Updates

Headers are generated with placeholder counts, then updated after processing:

```javascript
// Initial generation
const meta = {
  typeLabel: 'Region',
  entityName: 'Northeast',
  facilityCount: 0  // Placeholder
};

// After processing all facilities
meta.facilityCount = actualCount;
const updatedHeader = await generateHeader(meta);
```

This ensures counts are accurate regardless of which facilities have revenue.

### Account Ordering

Accounts are displayed in order specified by the `order` field in account configuration:

```javascript
childrenMap[parent].sort((a, b) => {
  const aOrder = accountConfig[a]?.order || 999999;
  const bOrder = accountConfig[b]?.order || 999999;
  return aOrder - bOrder;
});
```

### Double Lines

Accounts with `doubleLines: true` get visual separator after them:

```html
<div class="pnl-row">
  <div class="pnl-label">Total Operating Expenses</div>
  ...
</div>
<hr class="pnl-separator">  <!-- Added if doubleLines: true -->
```

---

## Performance Metrics

### Typical Generation Times

- **District (20 facilities)**: ~2 seconds
- **Region (5 districts, 50 facilities)**: ~3 seconds
- **Subsidiary (3 regions, 15 districts, 100 facilities)**: ~5 seconds

### Scaling Characteristics

- **Query time**: O(1) - Always 4 queries
- **Processing time**: O(N) - Linear with number of facilities
- **Memory usage**: O(N) - Stores all customer data in memory

### Bottlenecks

1. **BigQuery query time**: ~300-500ms per query
2. **GCS config file loading**: ~100-200ms per file
3. **HTML rendering**: ~10-20ms per P&L report
4. **Census data lookup**: ~50ms (Google Sheets API, cached)

---

## Error Handling

### Common Error Cases

1. **No customers found**:
   ```json
   {
     "error": "No customers found for selected district",
     "code": "NO_CUSTOMERS_FOUND"
   }
   ```

2. **Invalid hierarchy**:
   ```json
   {
     "error": "Invalid hierarchy type",
     "code": "INVALID_HIERARCHY"
   }
   ```

3. **Missing configuration**:
   ```json
   {
     "error": "Subsidiary not found",
     "code": "SUBSIDIARY_NOT_FOUND"
   }
   ```

4. **BigQuery failure**:
   ```json
   {
     "error": "Failed to fetch P&L data",
     "code": "BIGQUERY_ERROR"
   }
   ```

---

## Future Considerations

### Potential Optimizations

1. **Caching**: Cache configuration files in memory (currently loaded per request)
2. **Parallel Generation**: Generate facility P&Ls in parallel
3. **Incremental Rendering**: Stream HTML as it's generated
4. **Data Compression**: Compress BigQuery results before processing

### Scalability Limits

- **Current**: Tested up to 200 facilities per request
- **Memory**: ~100MB for 200 facilities with full year data
- **Time**: ~10 seconds for 200 facilities

### Extension Points

1. **Additional Hierarchy Levels**: System can support more levels with same pattern
2. **Custom Aggregations**: Tag system can be extended to any hierarchy level
3. **Additional Data Sources**: Template pattern allows easy integration of new data
4. **Export Formats**: PDF and email generation use same HTML generation logic

---

## Appendix: Key Code Locations

### Main Files

- `/src/routes/api.js`: P&L generation orchestration (lines 252-1500+)
- `/src/services/bigQueryService.js`: BigQuery queries and data fetching
- `/src/services/storageService.js`: Configuration management and grouping
- `/src/services/pnlRenderService.js`: HTML generation and account processing
- `/src/services/accountService.js`: Account hierarchy management
- `/public/pl-view.html`: Frontend P&L viewer

### Important Functions

- `api.js`: `router.get('/pl/data')` - Main P&L endpoint
- `bigQueryService.js`: `getPLData()` - BigQuery data fetching
- `bigQueryService.js`: `getCustomersInRegion()` - Customer fetching
- `storageService.js`: `getCustomersForDistrict()` - District customer lookup
- `storageService.js`: `groupCustomersByDistrict()` - Customer grouping
- `pnlRenderService.js`: `generatePNLReport()` - P&L HTML generation
- `pnlRenderService.js`: `generateHeader()` - Header HTML generation

---

## Document Version

- **Version**: 1.0
- **Last Updated**: January 25, 2026
- **Author**: Yona Solutions Development Team
