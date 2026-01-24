# Hierarchy System Documentation

## Overview

The application supports three hierarchical views for P&L reporting:
- **Districts** - Customer/location groupings
- **Regions** - Geographic regions
- **Subsidiaries** - Legal entities/departments

Users can toggle between these hierarchies via tabs, and the dropdown dynamically loads the appropriate options.

---

## Architecture

### Data Flow

```
User clicks tab → Frontend requests data → API endpoint → StorageService → GCP Storage → Parse & filter → Return to frontend → Populate dropdown
```

### Components

#### 1. Frontend (public/pl-view.html)
- **Hierarchy Tabs**: Three buttons (District, Region, Subsidiary)
- **Searchable Dropdown**: Single dropdown that changes content based on selected hierarchy
- **State Management**: `currentHierarchy` variable tracks active tab

#### 2. Backend API (src/routes/api.js)
- **GET /api/storage/districts**: Returns districts + tag values
- **GET /api/storage/regions**: Returns regions + tag values
- **GET /api/storage/departments**: Returns departments + tag values

#### 3. Service Layer (src/services/storageService.js)
- **getDistricts()**: Parses customer_config.json
- **getRegions()**: Parses region_config.json
- **getDepartments()**: Parses department_config.json

---

## Data Sources

### GCP Storage Bucket: `dimension_configurations`

#### Files Used:
1. **customer_config.json** - District configurations
2. **region_config.json** - Region configurations
3. **department_config.json** - Subsidiary/department configurations

---

## Configuration File Structures

### customer_config.json (Districts)

```json
{
  "1829": {
    "label": "District 121 - Ben Riegle (D)",
    "isDistrict": true,
    "districtReportingExcluded": true,
    "displayExcluded": false,
    "tags": ["District 121 - Ben Riegel"],
    "parent": "1751"
  }
}
```

**Key Fields:**
- `isDistrict`: Boolean flag identifying district entries
- `districtReportingExcluded`: If true, exclude from reporting
- `displayExcluded`: If true, exclude from display
- `tags`: Array of tag values (used for grouping)
- `label`: Display name

**Filtering Logic:**
```javascript
// Include if:
config.isDistrict === true
&& config.districtReportingExcluded !== true
&& config.displayExcluded !== true
```

---

### region_config.json (Regions)

```json
{
  "1": {
    "label": "Region",
    "parent": null,
    "type": "BASIC",
    "displayExcluded": false,
    "operationalExcluded": false
  },
  "2": {
    "label": "All Regions",
    "parent": "1",
    "type": "BASIC"
  },
  "3": {
    "label": "R100",
    "parent": "2",
    "type": "BASIC"
  }
}
```

**Hierarchy:**
- **Parent `null`**: Root node ("Region") - EXCLUDED
- **Parent `"1"`**: Aggregate node ("All Regions") - EXCLUDED
- **Parent `"2"`**: Leaf nodes (actual regions) - **INCLUDED**

**Key Fields:**
- `parent`: String ID of parent node
- `displayExcluded`: If true, exclude from display
- `operationalExcluded`: If true, exclude from operations
- `tags`: Array of tag values
- `label`: Display name

**Filtering Logic:**
```javascript
// Include if:
config.parent === '2'
&& config.displayExcluded !== true
&& config.operationalExcluded !== true
```

---

### department_config.json (Subsidiaries)

```json
{
  "1": {
    "label": "Department",
    "parent": null,
    "type": "BASIC",
    "displayExcluded": false,
    "operationalExcluded": false
  },
  "2": {
    "label": "All Departments",
    "parent": "1",
    "type": "BASIC"
  },
  "3": {
    "label": "Yona Gulf Coast, LLC",
    "parent": "2",
    "type": "BASIC",
    "subsidiary_internal_id": "1"
  }
}
```

**Hierarchy:**
- **Parent `null`**: Root node ("Department") - EXCLUDED
- **Parent `"1"`**: Aggregate node ("All Departments") - EXCLUDED
- **Parent `"2"`**: Leaf nodes (actual subsidiaries) - **INCLUDED**

**Filtering Logic:**
```javascript
// Include if:
config.parent === '2'
&& config.displayExcluded !== true
&& config.operationalExcluded !== true
```

---

## Tag System

### What are Tags?

Tags are string values stored in the `tags` field of configuration entries. They represent groupings or categories that can span multiple hierarchy items.

### Tag Extraction Logic

For all three hierarchy types:

```javascript
const uniqueTags = new Set();

// Iterate through all config entries
for (const [id, config] of Object.entries(configData)) {
  const tags = config.tags || [];
  tags.forEach(tag => uniqueTags.add(tag));
}

// Add tags as selectable items
uniqueTags.forEach(tag => {
  items.push({
    id: `tag_${tag}`,  // Prefix prevents ID collisions
    label: tag,
    type: 'tag'
  });
});
```

### Tag Examples

**District Tags:**
- "District 121 - Ben Riegel"
- "District 227"
- "District 301"
- etc.

**Region Tags:**
- Currently none in configuration

**Department Tags:**
- Currently none in configuration

---

## API Response Format

All three endpoints return the same structure:

```json
[
  {
    "id": "1971",
    "label": "District 101 - John Miller",
    "type": "district"
  },
  {
    "id": "tag_District 121 - Ben Riegel",
    "label": "District 121 - Ben Riegel",
    "type": "tag"
  }
]
```

**Fields:**
- `id`: Unique identifier (original ID or `tag_${tagValue}`)
- `label`: Display text for dropdown
- `type`: One of: `"district"`, `"region"`, `"department"`, `"tag"`

---

## Frontend Implementation

### Hierarchy Tab Click Handler

```javascript
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', function() {
    // Update active tab styling
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    this.classList.add('active');
    
    // Get hierarchy type
    const hierarchyType = this.textContent.toLowerCase(); // "district", "region", or "subsidiary"
    
    // Update dropdown label and placeholder
    const label = document.querySelector('.control-group:nth-child(3) .control-label');
    label.textContent = this.textContent;
    districtSelect.input.setAttribute('placeholder', `Select ${hierarchyType}...`);
    
    // Load appropriate data
    loadHierarchyOptions(hierarchyType);
  });
});
```

### Data Loading Function

```javascript
async function loadHierarchyOptions(hierarchyType = 'district') {
  // Map hierarchy types to API endpoints
  const endpointMap = {
    'district': '/api/storage/districts',
    'region': '/api/storage/regions',
    'subsidiary': '/api/storage/departments'
  };
  
  const endpoint = endpointMap[hierarchyType];
  const response = await fetch(endpoint);
  const items = await response.json();
  
  // Transform for searchable select
  const options = items.map(item => ({
    value: item.id,
    label: item.label,
    type: item.type
  }));
  
  // Update dropdown
  districtSelect.setOptions(options);
  
  // Update current hierarchy
  currentHierarchy = hierarchyType;
}
```

---

## Current Data Counts

### Districts
- **Individual Districts**: 44
- **Tag Values**: 9
- **Total**: 53 selectable items

### Regions
- **Individual Regions**: 12 (R100, R200, R300, R400, R450, R500, R600, R612, R800, R850, R870, R9500)
- **Tag Values**: 0
- **Total**: 12 selectable items

### Subsidiaries/Departments
- **Individual Subsidiaries**: 7 (Yona entities)
- **Tag Values**: 0
- **Total**: 7 selectable items

---

## Adding New Hierarchy Types

To add a new hierarchy type:

1. **Add configuration file** to GCP Storage bucket
2. **Create service method** in `StorageService`:
   ```javascript
   async getNewHierarchy() {
     const configData = await this.getFileAsJson('new_config.json');
     // Parse and filter logic
     return items;
   }
   ```
3. **Add API endpoint** in `src/routes/api.js`:
   ```javascript
   router.get('/storage/new-hierarchy', async (req, res) => {
     const items = await storageService.getNewHierarchy();
     res.json(items);
   });
   ```
4. **Add tab** in `public/pl-view.html`:
   ```html
   <button class="tab">New Hierarchy</button>
   ```
5. **Update endpoint map** in `loadHierarchyOptions()`:
   ```javascript
   const endpointMap = {
     'district': '/api/storage/districts',
     'region': '/api/storage/regions',
     'subsidiary': '/api/storage/departments',
     'new hierarchy': '/api/storage/new-hierarchy'
   };
   ```

---

## Troubleshooting

### Issue: Dropdown shows no items

**Check:**
1. API endpoint returns 200 status
2. Response is valid JSON array
3. Items have required fields (id, label, type)
4. Browser console for errors

**Test API directly:**
```bash
curl http://localhost:3000/api/storage/districts | jq
```

### Issue: Wrong items in dropdown

**Check:**
1. Correct hierarchy tab is selected
2. `currentHierarchy` variable matches expected value
3. Endpoint mapping in `loadHierarchyOptions()`

### Issue: Tags not appearing

**Check:**
1. Configuration file has `tags` field with values
2. Tag extraction loop is iterating all entries
3. Tags have unique values (Set deduplication)

---

## Performance Considerations

### Caching

Currently, data is fetched fresh on each tab switch. For better performance:

```javascript
// Cache hierarchy data
const hierarchyCache = {};

async function loadHierarchyOptions(hierarchyType) {
  // Check cache first
  if (hierarchyCache[hierarchyType]) {
    districtSelect.setOptions(hierarchyCache[hierarchyType]);
    return;
  }
  
  // Fetch and cache
  const items = await fetchHierarchyData(hierarchyType);
  hierarchyCache[hierarchyType] = items;
  districtSelect.setOptions(items);
}
```

### Large Datasets

If hierarchy counts exceed 1000+ items, consider:
- Server-side pagination
- Virtual scrolling in dropdown
- Lazy loading
- Search-based filtering (only load matching results)

---

## Multi-Level P&L Rendering

The application generates hierarchical P&L reports with different structures based on the selected hierarchy type.

### District View Structure

```
District Summary (aggregate)
├── Facility 1 P&L
├── Facility 2 P&L
├── Facility 3 P&L
└── ...
```

**Data Flow:**
1. User selects a district from dropdown
2. System looks up district in `customer_config.json`
3. Finds all customers where `parent = districtId`
4. Extracts `customer_internal_id` from each customer
5. Queries BigQuery with `customer_internal_id IN UNNEST(@customerIds)`
6. Generates:
   - District aggregate P&L (all customers combined)
   - Individual facility P&Ls (only facilities with revenue)

**Implementation:** `getCustomersForDistrict()` in `storageService.js`

---

### Region View Structure

```
Region Summary (aggregate)
├── District A Summary (aggregate)
│   ├── Facility 1 P&L
│   ├── Facility 2 P&L
│   └── ...
├── District B Summary (aggregate)
│   ├── Facility 3 P&L
│   ├── Facility 4 P&L
│   └── ...
└── ...
```

**Data Flow:**
1. User selects a region from dropdown
2. System looks up `region_internal_id` in `region_config.json`
3. Queries BigQuery `dim_customers` table: `WHERE region_internal_id = @regionId`
4. For each customer, looks up parent district in `customer_config.json`
5. Groups customers by district (ordered by config file order)
6. Generates:
   - Region aggregate P&L (all customers in region)
   - District aggregate P&Ls (customers grouped by district)
   - Individual facility P&Ls (only facilities with revenue)

**Key Difference from District View:**
- **District → Customer mapping**: Stored in `customer_config.json` via `parent` field
- **Region → Customer mapping**: Stored in BigQuery `dim_customers.region_internal_id` column

**Implementation:**
- `getCustomersInRegion()` in `bigQueryService.js` - queries dim_customers
- `groupCustomersByDistrict()` in `storageService.js` - groups customers by parent district

---

### Subsidiary View Structure

```
Subsidiary Summary (aggregate only)
```

**Data Flow:**
1. User selects a subsidiary from dropdown
2. System looks up `subsidiary_internal_id` in `department_config.json`
3. Queries BigQuery with `subsidiary_internal_id = @subsidiaryId`
4. Generates single aggregate P&L

**Note:** Currently single-level only. Could be enhanced to show region/district breakdowns.

---

### BigQuery Tables Used

#### `fct_transactions_summary`
- Transaction-level data with account, scenario, value
- Columns: `customer_internal_id`, `region_internal_id`, `subsidiary_internal_id`, `account_internal_id`, `scenario`, `value`, `time_date`
- Used for P&L data aggregation

#### `dim_customers`
- Customer dimension table
- Columns: `customer_id`, `customer_code`, `display_name`, `region_internal_id`, `subsidiary_internal_id`, `start_date_est`
- Used to find customers in a region

---

### Revenue Filtering

**Facilities are only included if they have revenue (`Income > 0`):**

```javascript
if (Math.abs(incomeTotals.act) < 0.0001) {
  return { noRevenue: true, html: '' };
}
```

This prevents empty P&L reports from cluttering the output. Districts and regions always show their aggregate even if individual facilities are excluded.

---

## Security Notes

1. **GCP Credentials**: Service account key stored as environment variable
2. **Read-Only Access**: Service only reads from Storage, no writes
3. **Input Validation**: No user input in file paths (all hardcoded)
4. **CORS**: Not configured (same-origin only)

---

## Future Enhancements

### Potential Improvements:

1. **Multi-select**: Allow selecting multiple districts/regions
2. **Hierarchy Breadcrumbs**: Show parent-child relationships
3. **Favorites**: Save frequently used selections
4. **Recent Selections**: Auto-suggest recent choices
5. **Advanced Filtering**: Filter by tags, regions, etc.
6. **Bulk Operations**: Apply actions to multiple selections
7. **Export Options**: Download hierarchy data as CSV/JSON

---

## Related Documentation

- [Architecture Overview](./ARCHITECTURE.md)
- [API Documentation](../README.md#api-endpoints)
- [Local Development](../LOCAL_DEVELOPMENT.md)

