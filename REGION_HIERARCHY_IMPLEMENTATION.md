# Region Multi-Level P&L Implementation

**Date:** January 24, 2026  
**Summary:** Added multi-level hierarchical P&L rendering for Region view, matching the structure of District view but with an additional district aggregation level.

---

## What Changed

### Before
**Region View:** Single aggregate P&L report only
```
Region Summary (aggregate)
```

### After
**Region View:** Multi-level hierarchical reports
```
Region Summary (aggregate)
├── District A Summary (aggregate)
│   ├── Facility 1 P&L
│   ├── Facility 2 P&L
│   └── ...
├── District B Summary (aggregate)
│   ├── Facility 3 P&L
│   └── ...
└── ...
```

---

## Implementation Details

### 1. New BigQuery Method: `getCustomersInRegion()`

**File:** `src/services/bigQueryService.js`

**Purpose:** Query the `dim_customers` table to find all customers belonging to a region.

**Key Query:**
```sql
SELECT
  customer_id,
  customer_code,
  display_name,
  start_date_est,
  region_internal_id,
  subsidiary_internal_id
FROM `yona-solutions-poc.dbt_production.dim_customers`
WHERE region_internal_id = @regionInternalId
ORDER BY customer_id
```

**Why This Approach:**
- Unlike districts (which use parent-child relationships in `customer_config.json`), regions store their customer relationships in the transaction data itself
- Each customer has a `region_internal_id` that links them to their region
- The `dim_customers` table provides this mapping efficiently

---

### 2. New Storage Method: `groupCustomersByDistrict()`

**File:** `src/services/storageService.js`

**Purpose:** Take a list of customers and group them by their parent district from `customer_config.json`.

**Algorithm:**
1. Build reverse lookup: `customer_internal_id` → config entry
2. Collect all districts from config (with order)
3. For each customer, find their parent district via `parent` field
4. Group customers under their parent districts
5. Sort districts by config file order
6. Filter out districts with no customers

**Returns:**
```javascript
[
  {
    districtId: "1971",
    districtLabel: "District 101 - John Miller",
    customers: [
      { customer_internal_id: 39, label: "Facility ABC", ... },
      { customer_internal_id: 42, label: "Facility XYZ", ... }
    ],
    order: 0
  },
  ...
]
```

---

### 3. Updated API Route: Region P&L Generation

**File:** `src/routes/api.js`

**Changes:**

#### Region ID Lookup (Lines ~311-337)
```javascript
} else if (hierarchy === 'region') {
  const regionId = await storageService.getRegionInternalId(actualId);
  
  // NEW: Query dim_customers to get all customers in region
  const customersInRegion = await bigQueryService.getCustomersInRegion(regionId);
  
  // NEW: Group customers by their parent district
  const districtGroups = await storageService.groupCustomersByDistrict(customersInRegion);
  
  queryParams.regionId = regionId;
  queryParams.customersInRegion = customersInRegion;
  queryParams.districtGroups = districtGroups;
}
```

#### Multi-Level P&L Generation (Lines ~440-560)
```javascript
} else if (hierarchy === 'region') {
  // 1. Generate region summary P&L (aggregate of all customers)
  const regionData = await bigQueryService.getPLData({ ...queryParams, ytd: false });
  const regionYtdData = await bigQueryService.getPLData({ ...queryParams, ytd: true });
  
  const regionResult = await pnlRenderService.generatePNLReport(
    regionData, regionYtdData, regionMeta, accountConfig, childrenMap, sectionConfig
  );
  
  htmlParts.push(regionResult.html);
  
  // 2. For each district in the region...
  for (const districtGroup of queryParams.districtGroups) {
    // 2a. Generate district summary P&L
    const districtData = await bigQueryService.getPLData({ 
      hierarchy: 'district',
      customerIds: districtGroup.customers.map(c => c.customer_internal_id),
      date, accountConfig, ytd: false
    });
    
    const districtResult = await pnlRenderService.generatePNLReport(...);
    
    if (!districtResult.noRevenue) {
      htmlParts.push(districtResult.html);
      
      // 2b. Generate facility P&Ls for each customer in district
      for (const customer of districtGroup.customers) {
        const facilityData = await bigQueryService.getPLData({
          hierarchy: 'district',
          customerIds: [customer.customer_internal_id],
          date, accountConfig, ytd: false
        });
        
        const facilityResult = await pnlRenderService.generatePNLReport(...);
        
        if (!facilityResult.noRevenue) {
          htmlParts.push(facilityResult.html);
        }
      }
    }
  }
}
```

---

## Key Design Decisions

### 1. Why Query dim_customers?
**Problem:** How do we know which customers belong to a region?

**Solution:** The `region_internal_id` is stored in the transaction data (BigQuery), not in configuration files. The `dim_customers` dimension table provides the authoritative mapping.

**Alternative Considered:** Scan transaction data directly from `fct_transactions_summary`
- **Why Not:** Would be slower and less efficient; dim_customers is specifically designed for this

---

### 2. Why Group by District?
**Problem:** Region view could just show a flat list of facilities.

**Solution:** Grouping by district provides better organization and matches the hierarchical nature of the business.

**Benefits:**
- Users can see which district each facility belongs to
- District aggregates provide intermediate rollup values
- Matches user mental model of organization structure

---

### 3. Why Respect Config File Order?
**Problem:** Districts could be ordered alphabetically.

**Solution:** Use the order they appear in `customer_config.json`.

**Rationale:**
- Config file order likely has business significance
- Consistent with other parts of the application
- Users may have specific ordering preferences

---

## Data Flow Comparison

### District View
```
User selects District
    ↓
customer_config.json (parent field)
    ↓
Extract customer_internal_ids
    ↓
BigQuery: customer_internal_id IN (...)
    ↓
Generate: District Summary + Facility P&Ls
```

### Region View (NEW)
```
User selects Region
    ↓
region_config.json (region_internal_id)
    ↓
BigQuery dim_customers: region_internal_id = X
    ↓
customer_config.json (parent field for grouping)
    ↓
Group customers by district
    ↓
BigQuery: customer_internal_id IN (...)
    ↓
Generate: Region Summary + District Summaries + Facility P&Ls
```

---

## Testing Checklist

- [ ] Test Region view with multiple districts
- [ ] Test Region view with single district
- [ ] Test Region with no customers (edge case)
- [ ] Test Region with all zero-revenue customers
- [ ] Verify district order matches config file
- [ ] Verify customer grouping is correct
- [ ] Compare totals: Region sum = Sum of all District sums
- [ ] Check that Month and YTD columns both work
- [ ] Test with different date selections
- [ ] Verify no performance issues with large regions

---

## Files Modified

1. **src/services/bigQueryService.js**
   - Added `getCustomersInRegion()` method

2. **src/services/storageService.js**
   - Added `groupCustomersByDistrict()` method

3. **src/routes/api.js**
   - Enhanced region handling in `/api/pl/data` endpoint
   - Added multi-level P&L generation for regions
   - Separated region and subsidiary logic

4. **docs/HIERARCHY_SYSTEM.md**
   - Added "Multi-Level P&L Rendering" section
   - Documented Region view structure and data flow
   - Explained difference between District and Region mappings

---

## Performance Considerations

### Query Count Per Region Request
- 1 query: dim_customers (get customers in region)
- 1 query: Region aggregate (Month)
- 1 query: Region aggregate (YTD)
- N queries: District aggregates (Month + YTD each) where N = number of districts
- M queries: Facility P&Ls (Month + YTD each) where M = number of facilities with revenue

**Example:** Region with 3 districts and 15 facilities:
- Total queries: 1 + 2 + (3 × 2) + (15 × 2) = **39 queries**

### Optimization Opportunities (Future)
1. **Batch queries**: Query all district data in one go, group in memory
2. **Parallel queries**: Use Promise.all() to run district queries concurrently
3. **Caching**: Cache dim_customers results since they rarely change
4. **Lazy loading**: Only load facility P&Ls on user request

---

## Related Documentation

- [Hierarchy System](./docs/HIERARCHY_SYSTEM.md) - Updated with multi-level rendering docs
- [Architecture](./docs/ARCHITECTURE.md) - System architecture overview
- [Critical Concepts](./docs/CRITICAL_CONCEPTS.md) - Core business logic

---

## Questions & Answers

**Q: Why not use the same approach for districts?**  
A: Districts already store their customer relationships in `customer_config.json` via the `parent` field. No need to query BigQuery for that mapping.

**Q: Could subsidiaries use the same multi-level approach?**  
A: Yes! Subsidiaries could show Region → District → Facility hierarchy. The infrastructure is now in place to support this.

**Q: What if a customer doesn't have a parent district in config?**  
A: The system logs a warning and skips that customer. This is defensive - ideally all customers should have a parent district.

**Q: What if dim_customers and customer_config.json disagree?**  
A: `dim_customers` is the source of truth for region membership. `customer_config.json` is the source of truth for district membership. Both should be kept in sync.

---

## Next Steps

1. **Test thoroughly** with production data
2. **Monitor performance** - watch query times
3. **Consider optimization** if query count becomes an issue
4. **Extend to subsidiaries** if needed
5. **Add UI indicators** to show hierarchy levels clearly


