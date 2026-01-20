console.log("🔵 TRANSFORMER STARTED");

// =======================================================
// RAW INPUTS
// =======================================================
const rawMonth = {{ currentMonthQuery_district2.data }};
const rawYtd   = {{ ytdQuery_district2.data }};

// SIMPLE DEBUG: Show all rows for account 319, customer 11176
const DEBUG_ACCOUNT_ID = 319;
const DEBUG_CUSTOMER_ID = "11176";
const matchingRows = [];
if (rawMonth?.account_internal_id) {
  for (let i = 0; i < rawMonth.account_internal_id.length; i++) {
    if (rawMonth.account_internal_id[i] === DEBUG_ACCOUNT_ID && 
        String(rawMonth.customer_internal_id?.[i] || "") === DEBUG_CUSTOMER_ID) {
      matchingRows.push({
        index: i,
        account_internal_id: rawMonth.account_internal_id[i],
        customer_internal_id: rawMonth.customer_internal_id?.[i],
        scenario: rawMonth.scenario?.[i],
        time_date: rawMonth.time_date?.[i],
        value: rawMonth.value?.[i],
        region_internal_id: rawMonth.region_internal_id?.[i],
        subsidiary_internal_id: rawMonth.subsidiary_internal_id?.[i]
      });
    }
  }
}
console.log("🔍 ALL ROWS - Account 319, Customer 11176", {
  totalMatchingRows: matchingRows.length,
  rows: matchingRows
});
const hierarchy = {{ Heiarchy.value }};
const regionConfigRaw = {{ getRegionConfig_gcs.data || {} }};
const departmentConfigRaw = {{ getDepartmentConfig_gcs.data || {} }};
const accountConfigRaw  = {{ retreiveAccountConfig2.data || {} }};
const customerConfigRaw = {{ retreiveCustomerConfig.data || {} }};
const customerCodeMapping = {{ customerCodeMapping.data || [] }};
const censusMonthly = {{ getCensusMonthly.data || [] }};
const isoMonth = {{ timeDropdown4.value }};
const selectedDistrictLabel = {{ districtDropdown2.value }};
const plType = {{ PLType_district2.value }};

const monthRowCount = rawMonth?.account_internal_id?.length || 0;
const ytdRowCount = rawYtd?.account_internal_id?.length || 0;

console.log("🔵 RAW INPUT CHECK", {
  rawMonthKeys: Object.keys(rawMonth || {}),
  rowCounts: {
    month: {
      account: monthRowCount,
      customer: rawMonth?.customer_internal_id?.length || 0,
      region: rawMonth?.region_internal_id?.length || 0,
      subsidiary: rawMonth?.subsidiary_internal_id?.length || 0,
      scenario: rawMonth?.scenario?.length || 0,
      value: rawMonth?.value?.length || 0
    },
    ytd: {
      account: ytdRowCount,
      customer: rawYtd?.customer_internal_id?.length || 0,
      region: rawYtd?.region_internal_id?.length || 0,
      subsidiary: rawYtd?.subsidiary_internal_id?.length || 0,
      scenario: rawYtd?.scenario?.length || 0,
      value: rawYtd?.value?.length || 0
    }
  },
  sampleMonthRow: {
    account: rawMonth?.account_internal_id?.[0],
    customer: rawMonth?.customer_internal_id?.[0],
    region: rawMonth?.region_internal_id?.[0],
    subsidiary: rawMonth?.subsidiary_internal_id?.[0],
    scenario: rawMonth?.scenario?.[0],
    value: rawMonth?.value?.[0]
  },
  sampleYtdRow: {
    account: rawYtd?.account_internal_id?.[0],
    customer: rawYtd?.customer_internal_id?.[0],
    region: rawYtd?.region_internal_id?.[0],
    subsidiary: rawYtd?.subsidiary_internal_id?.[0],
    scenario: rawYtd?.scenario?.[0],
    value: rawYtd?.value?.[0]
  },
  hierarchy,
  selectedDistrictLabel,
  plType
});

// Warn about large datasets
if (monthRowCount > 50000 || ytdRowCount > 100000) {
  console.warn("⚠️ LARGE DATASET WARNING:", {
    monthRows: monthRowCount,
    ytdRows: ytdRowCount,
    message: "Very large datasets may cause performance issues or Retool timeout (30s limit)"
  });
}

// =======================================================
// ACCOUNT ID → LABEL MAPPING
// =======================================================
const idToLabel = {};
const nodeIdToLabel = {};
const accountConfig = {};

for (const nodeId in accountConfigRaw) {
  const node = accountConfigRaw[nodeId];
  if (!node) continue;

  if (node.account_internal_id != null && node.label) {
    idToLabel[String(node.account_internal_id)] = node.label;
  }

  if (node.label) {
    nodeIdToLabel[nodeId] = node.label;
  }
}

for (const nodeId in accountConfigRaw) {
  const node = accountConfigRaw[nodeId];
  if (!node || !node.label) continue;

  const parentLabel =
    node.parent && nodeIdToLabel[node.parent]
      ? nodeIdToLabel[node.parent]
      : null;

  accountConfig[node.label] = {
    ...node,
    parent: parentLabel,
    displayExcluded: node.displayExcluded || false,
    doubleLines: node.doubleLines || false,
    operationalExcluded: node.operationalExcluded || false
  };
}

console.log("🔵 ACCOUNT CONFIG BUILT", {
  mappedAccounts: Object.keys(accountConfig).length,
  sampleMappings: Object.entries(idToLabel).slice(0, 5)
});

// =======================================================
// CONVERT MONTH DATA
// =======================================================
const monthData = {
  Account: (rawMonth.account_internal_id || []).map(id =>
    id == null ? null : idToLabel[String(id)] || null
  ),
  Scenario: rawMonth.scenario || [],
  Value: rawMonth.value || []
};

// Count scenarios in raw data
const rawScenarioCounts = {};
const rawScenarioArray = rawMonth?.scenario || [];
rawScenarioArray.forEach(s => {
  rawScenarioCounts[s] = (rawScenarioCounts[s] || 0) + 1;
});

// Check for scenario variations (case sensitivity, whitespace, etc.)
const uniqueScenarioValues = [...new Set(rawScenarioArray.map(s => String(s).trim()))];
const sampleScenarios = rawScenarioArray.slice(0, 20);

console.log("🔵 MONTH DATA CONVERTED", {
  rows: monthData.Account.length,
  nullAccounts: monthData.Account.filter(a => !a).length,
  sampleAccounts: monthData.Account.filter(Boolean).slice(0, 10),
  sampleRaw: {
    account: rawMonth?.account_internal_id?.[0],
    customer: rawMonth?.customer_internal_id?.[0],
    region: rawMonth?.region_internal_id?.[0],
    scenario: rawMonth?.scenario?.[0],
    scenarioType: typeof rawMonth?.scenario?.[0],
    value: rawMonth?.value?.[0]
  },
  rawScenarioArrayLength: rawScenarioArray.length,
  uniqueScenarios: uniqueScenarioValues,
  uniqueScenarioCount: uniqueScenarioValues.length,
  scenarioCounts: rawScenarioCounts,
  scenarioBreakdown: Object.entries(rawScenarioCounts).map(([scenario, count]) => ({ 
    scenario, 
    count,
    scenarioType: typeof scenario,
    scenarioLength: String(scenario).length
  })),
  sampleScenarios: sampleScenarios,
  totalScenarioRows: Object.values(rawScenarioCounts).reduce((a, b) => a + b, 0),
  // Check if there are any scenario values that might be different
  allScenarioValues: uniqueScenarioValues.map(s => ({
    value: s,
    type: typeof s,
    trimmed: String(s).trim(),
    lowerCase: String(s).toLowerCase(),
    upperCase: String(s).toUpperCase()
  }))
});

// =======================================================
// ACCOUNT 417 TRACKING (RAW DATA)
// =======================================================
const account417Raw = {
  accountId: 417,
  totalRows: 0,
  totalValue: 0,
  breakdown: {
    byScenario: {},
    byCustomer: {},
    sampleRows: []
  }
};

const rawAccountIds = rawMonth.account_internal_id || [];
const rawValues = rawMonth.value || [];
const rawScenarios = rawMonth.scenario || [];
const rawCustomers = rawMonth.customer_internal_id || [];
const rawRegions = rawMonth.region_internal_id || [];
const rawSubsidiaries = rawMonth.subsidiary_internal_id || [];

for (let i = 0; i < rawAccountIds.length; i++) {
  if (rawAccountIds[i] === 417) {
    account417Raw.totalRows++;
    const value = Number(rawValues[i]) || 0;
    account417Raw.totalValue += value;
    
    const scenario = rawScenarios[i];
    const customer = rawCustomers[i];
    const region = rawRegions[i];
    const subsidiary = rawSubsidiaries[i];
    
    if (!account417Raw.breakdown.byScenario[scenario]) {
      account417Raw.breakdown.byScenario[scenario] = 0;
    }
    account417Raw.breakdown.byScenario[scenario] += value;
    
    if (customer != null) {
      const custKey = String(customer);
      if (!account417Raw.breakdown.byCustomer[custKey]) {
        account417Raw.breakdown.byCustomer[custKey] = 0;
      }
      account417Raw.breakdown.byCustomer[custKey] += value;
    }
    
    // Store all rows (not just sample)
    account417Raw.breakdown.sampleRows.push({
      index: i,
      account: rawAccountIds[i],
      customer,
      region,
      subsidiary,
      scenario,
      value
    });
  }
}

console.log("🔵 ACCOUNT 417 RAW DATA (before filters)", {
  accountId: 417,
  totalRows: account417Raw.totalRows,
  totalValue: account417Raw.totalValue,
  breakdown: {
    byScenario: account417Raw.breakdown.byScenario,
    customerCount: Object.keys(account417Raw.breakdown.byCustomer).length,
    allCustomers: Object.entries(account417Raw.breakdown.byCustomer),
    allRows: account417Raw.breakdown.sampleRows
  }
});

// =======================================================
// CONVERT YTD DATA
// =======================================================
const ytdData = {
  Account: (rawYtd.account_internal_id || []).map(id =>
    id == null ? null : idToLabel[String(id)] || null
  ),
  Scenario: rawYtd.scenario || [],
  Value: rawYtd.value || []
};

console.log("🔵 YTD DATA CHECK", {
  rows: ytdData.Account.length,
  nullAccounts: ytdData.Account.filter(a => !a).length,
  uniqueScenarios: [...new Set(rawYtd?.scenario || [])].slice(0, 10),
  sampleRaw: {
    account: rawYtd?.account_internal_id?.[0],
    customer: rawYtd?.customer_internal_id?.[0],
    region: rawYtd?.region_internal_id?.[0],
    scenario: rawYtd?.scenario?.[0],
    value: rawYtd?.value?.[0]
  }
});

// =======================================================
// META
// =======================================================
const meta = {
  typeLabel: hierarchy === "Region" ? "Region" : "District",
  entityName: selectedDistrictLabel,
  monthLabel: isoMonth,
  facilityCount: null,
  plType
};

// =======================================================
// SECTION CONFIG
// =======================================================
const sectionConfigRaw = {{ sectionConfig.value || {} }};
const sectionConfig = {};

for (const key in sectionConfigRaw) {
  const s = sectionConfigRaw[key];
  sectionConfig[s.header || key] = s.accounts || [];
}

// =======================================================
// CUSTOMER HIERARCHY MAPS
// =======================================================


const districtNodes = [];
const districtToCustomers = {};
const customerIdToDistrictLabel = {};

for (const nodeId in customerConfigRaw) {
  const node = customerConfigRaw[nodeId];
  if (node?.isDistrict) {
    districtNodes.push({ nodeId, label: node.label });
    districtToCustomers[node.label] = [];
  }
}

// Maps for districtTags and districtReportingExcluded
const customerIdToDistrictTags = {}; // customerId -> array of districtTags
const districtLabelToReportingExcluded = {}; // districtLabel -> boolean
const customerIdToDistrictReportingExcluded = {}; // customerId -> boolean (from parent district)

for (const nodeId in customerConfigRaw) {
  const node = customerConfigRaw[nodeId];
  if (node?.isDistrict) {
    // Track which districts are excluded from reporting
    districtLabelToReportingExcluded[node.label] = node.districtReportingExcluded === true;
  }
  if (node?.parent && node.customer_internal_id != null) {
    const parentNode = customerConfigRaw[node.parent];
    if (parentNode?.isDistrict) {
      const districtLabel = parentNode.label;
      const customerId = String(node.customer_internal_id);
      
      districtToCustomers[districtLabel]?.push({
        label: node.label,
        customerId: customerId
      });
      customerIdToDistrictLabel[customerId] = districtLabel;
      
      // Store districtTags for this customer
      // districtTags come from the PARENT DISTRICT node, not the customer node
      // Multiple districts can have the same districtTags, and all their customers will be grouped together
      let tags = [];
      const parentDistrictTags = parentNode.districtTags;
      
      if (Array.isArray(parentDistrictTags) && parentDistrictTags.length > 0) {
        // Use parent district's tags - customers from different districts with same tags will be grouped together
        tags = [...parentDistrictTags];
      } else {
        // Fallback: use parent district label as a tag for grouping
        // This ensures customers are still grouped by their parent district when tags aren't set
        tags = [districtLabel];
      }
      customerIdToDistrictTags[customerId] = tags.sort(); // Sort for consistent grouping
      
      // Store districtReportingExcluded status from parent district
      customerIdToDistrictReportingExcluded[customerId] = parentNode.districtReportingExcluded === true;
    }
  }
}

// Log district configuration details
const excludedDistricts = Object.entries(districtLabelToReportingExcluded)
  .filter(([label, excluded]) => excluded === true)
  .map(([label]) => label);

const includedDistricts = Object.entries(districtLabelToReportingExcluded)
  .filter(([label, excluded]) => excluded !== true)
  .map(([label]) => label);

// Build map of district labels to their districtTags
const districtLabelToTags = {};
for (const nodeId in customerConfigRaw) {
  const node = customerConfigRaw[nodeId];
  if (node?.isDistrict && node.label) {
    const tags = Array.isArray(node.districtTags) && node.districtTags.length > 0
      ? [...node.districtTags].sort()
      : [];
    districtLabelToTags[node.label] = tags;
  }
}

// Group districts by their districtTags to show which districts will be combined
const tagsToDistricts = {};
for (const [districtLabel, tags] of Object.entries(districtLabelToTags)) {
  const tagsKey = tags.length > 0 ? tags.sort().join(",") : "NO_TAGS";
  if (!tagsToDistricts[tagsKey]) {
    tagsToDistricts[tagsKey] = [];
  }
  tagsToDistricts[tagsKey].push(districtLabel);
}

console.log("🔵 DISTRICT CONFIG SUMMARY", {
  totalDistricts: districtNodes.length,
  excludedDistrictsCount: excludedDistricts.length,
  excludedDistricts: excludedDistricts,
  includedDistrictsCount: includedDistricts.length,
  includedDistricts: includedDistricts.slice(0, 20), // First 20
  districtNodes: districtNodes.slice(0, 10).map(d => ({
    nodeId: d.nodeId,
    label: d.label,
    reportingExcluded: districtLabelToReportingExcluded[d.label] === true,
    customerCount: districtToCustomers[d.label]?.length || 0,
    districtTags: districtLabelToTags[d.label] || []
  }))
});

// Show all tag groups, highlighting which ones combine multiple districts
const allTagGroups = Object.entries(tagsToDistricts).map(([tagsKey, districts]) => ({
  tags: tagsKey === "NO_TAGS" ? [] : tagsKey.split(","),
  districts: districts,
  districtCount: districts.length,
  totalCustomers: districts.reduce((sum, d) => sum + (districtToCustomers[d]?.length || 0), 0),
  willBeCombined: districts.length > 1 // Multiple districts with same tags will be combined
}));

const combinedGroups = allTagGroups.filter(g => g.willBeCombined);
const singleGroups = allTagGroups.filter(g => !g.willBeCombined);

console.log("🔵 DISTRICT TAGS GROUPING (which districts share tags)", {
  totalTagGroups: allTagGroups.length,
  groupsWithMultipleDistricts: combinedGroups.length,
  groupsWithSingleDistrict: singleGroups.length,
  combinedGroups: combinedGroups.map(g => ({
    tags: g.tags,
    districts: g.districts,
    districtCount: g.districtCount,
    totalCustomers: g.totalCustomers,
    note: `These ${g.districtCount} districts will be combined into one P&L`
  })),
  sampleSingleGroups: singleGroups.slice(0, 10).map(g => ({
    tags: g.tags,
    districts: g.districts,
    districtCount: g.districtCount,
    totalCustomers: g.totalCustomers
  }))
});


// REGION MAP
const regionLabelToId = {};
for (const nodeId in regionConfigRaw) {
  const node = regionConfigRaw[nodeId];
  if (node?.region_internal_id != null && node.label) {
    regionLabelToId[node.label] = String(node.region_internal_id);
  }
}

// SUBSIDIARY MAP
const subsidiaryLabelToId = {};
for (const nodeId in departmentConfigRaw) {
  const node = departmentConfigRaw[nodeId];
  if (node?.subsidiary_internal_id != null && node.label) {
    subsidiaryLabelToId[node.label] = String(node.subsidiary_internal_id);
  }
}

const isRegionMode = hierarchy === "Region";
const isSubsidiaryMode = hierarchy === "Subsidiary";
const selectedRegionId = isRegionMode ? regionLabelToId[selectedDistrictLabel] : null;
const selectedSubsidiaryId = isSubsidiaryMode ? subsidiaryLabelToId[selectedDistrictLabel] : null;

if (isRegionMode) {
  console.log("🟡 REGION LOOKUP DEBUG", {
    selectedRegionLabel: selectedDistrictLabel,
    selectedRegionId,
    regionLabels: Object.keys(regionLabelToId).slice(0, 10)
  });
}

if (isSubsidiaryMode) {
  console.log("🟡 SUBSIDIARY LOOKUP DEBUG", {
    selectedSubsidiaryLabel: selectedDistrictLabel,
    selectedSubsidiaryId,
    subsidiaryLabels: Object.keys(subsidiaryLabelToId).slice(0, 10),
    departmentConfigKeys: Object.keys(departmentConfigRaw).slice(0, 10),
    sampleDepartmentNodes: Object.entries(departmentConfigRaw).slice(0, 3).map(([id, node]) => ({
      id,
      label: node?.label,
      subsidiary_internal_id: node?.subsidiary_internal_id,
      parent: node?.parent
    }))
  });
}

// DISTRICT MODE: identify selected district node
let selectedDistrictNodeId = null;
if (!isRegionMode && !isSubsidiaryMode) {
for (const nodeId in customerConfigRaw) {
  const node = customerConfigRaw[nodeId];
  if (node?.isDistrict && node.label === selectedDistrictLabel) {
    selectedDistrictNodeId = nodeId;
    break;
  }
}


if (!selectedDistrictNodeId) {
  console.warn("❌ DISTRICT NOT FOUND — NOTHING WILL FILTER");
  }
}

// =======================================================
// RAW MONTH CUSTOMER IDS
// =======================================================
const rawCustomerIds = (rawMonth.customer_internal_id || [])
  .filter(v => v != null)
  .map(v => String(v));


// =======================================================
// HELPER: Group customers by districtTags (for Region/Subsidiary district rollups)
// =======================================================
function groupCustomersByDistrictTags(customers) {
  // Group customers by their districtTags (treating each unique set as a district)
  const tagsToCustomers = {}; // "tag1,tag2" -> [customers]
  
  customers.forEach(customer => {
    const tags = customerIdToDistrictTags[customer.customerId] || [];
    const tagsKey = tags.sort().join(","); // Create a unique key from sorted tags
    
    if (!tagsToCustomers[tagsKey]) {
      tagsToCustomers[tagsKey] = [];
    }
    tagsToCustomers[tagsKey].push(customer);
  });
  
  // Convert to array format: [{ districtLabel, customers }]
  // Use the tag name(s) as the district label
  const result = Object.entries(tagsToCustomers).map(([tagsKey, customerList]) => {
    const tags = tagsKey ? tagsKey.split(",") : [];
    let districtLabel;
    
    if (tags.length === 0) {
      // Fallback: use "Other" if no tags
      districtLabel = "Other";
    } else if (tags.length === 1) {
      // Single tag: use the tag name directly (e.g., "District 121")
      districtLabel = tags[0];
    } else {
      // Multiple tags: join them (e.g., "District 121 - District 122")
      districtLabel = tags.join(" - ");
    }
    
    return {
      districtLabel,
      customers: customerList,
      districtTags: tags
    };
  });
  
  return result;
}

// =======================================================
// DISTRICT / REGION / SUBSIDIARY CUSTOMER SELECTION
// =======================================================
let districtCustomers = [];
let districtCustomerIds = [];

// For Subsidiary mode, we need to track regions within the subsidiary
let subsidiaryRegions = []; // Array of { regionId, regionLabel, districts: [...] }

if (isSubsidiaryMode) {
  // Build subsidiary customer set using rawMonth.subsidiary_internal_id
  const subsidiaryCustomerSet = new Set();
  const rawSubsidiaryIds = rawMonth.subsidiary_internal_id || [];
  const rawRegionIds = rawMonth.region_internal_id || [];
  
  // Map: customerId -> regionId
  const customerIdToRegionId = {};
  
  for (let i = 0; i < rawCustomerIds.length; i++) {
    const cid = rawCustomerIds[i];
    const sid = rawSubsidiaryIds?.[i];
    const rid = rawRegionIds?.[i];
    
    if (selectedSubsidiaryId && String(sid) === String(selectedSubsidiaryId)) {
      subsidiaryCustomerSet.add(cid);
      if (rid != null) {
        customerIdToRegionId[cid] = String(rid);
      }
    }
  }
  
  districtCustomerIds = Array.from(subsidiaryCustomerSet);
  
  // Group customers by region, then by districtTags (not districtLabel)
  // Build: regionId -> { regionLabel, customers[] }
  const regionMap = {}; // regionId -> { regionLabel, customers: [] }
  
  for (const cid of districtCustomerIds) {
    const regionId = customerIdToRegionId[cid];
    
    if (!regionId) continue;
    
    // NOTE: districtReportingExcluded only excludes the individual district P&L report,
    // but customers from excluded districts should still be included in grouped P&Ls based on tags
    // So we don't filter them out here - they'll be grouped by their districtTags
    
    if (!regionMap[regionId]) {
      // Find region label from regionConfigRaw
      let regionLabel = regionId;
      for (const nodeId in regionConfigRaw) {
        const node = regionConfigRaw[nodeId];
        if (node?.region_internal_id != null && String(node.region_internal_id) === regionId) {
          regionLabel = node.label;
          break;
        }
      }
      regionMap[regionId] = { regionLabel, customers: [] };
    }
    
    // Find customer info
    const customerInfo = Object.values(districtToCustomers)
      .flat()
      .find(c => c.customerId === cid);
    
    if (customerInfo) {
      regionMap[regionId].customers.push(customerInfo);
    }
  }
  
  // Convert to array structure, grouping customers by districtTags within each region
  subsidiaryRegions = Object.entries(regionMap).map(([regionId, data]) => ({
    regionId,
    regionLabel: data.regionLabel,
    districts: groupCustomersByDistrictTags(data.customers)
  }));
  
  // Also build districtCustomers for backward compatibility (flat list of districts with customers)
  districtCustomers = subsidiaryRegions.flatMap(r => r.districts);
  
  // NOTE: districtReportingExcluded no longer filters out customers from grouped P&Ls
  // Customers from excluded districts are still included in grouped P&Ls based on their tags
  // The exclusion only affects whether we show the individual district P&L report
} else if (isRegionMode) {
  // Build region customer set using rawMonth.region_internal_id
  const regionCustomerSet = new Set();
  const rawRegionIds = rawMonth.region_internal_id || [];
  for (let i = 0; i < rawCustomerIds.length; i++) {
    const cid = rawCustomerIds[i];
    const rid = rawRegionIds?.[i];
    if (selectedRegionId && String(rid) === String(selectedRegionId)) {
      regionCustomerSet.add(cid);
    }
  }

  // Collect all customers in the region
  // NOTE: districtReportingExcluded only excludes the individual district P&L report,
  // but customers from excluded districts should still be included in grouped P&Ls based on tags
  const regionCustomers = [];
  const regionCustomersWithDetails = []; // For logging
  for (const [districtLabel, customers] of Object.entries(districtToCustomers)) {
    // Include ALL customers from the region, even if their district is excluded
    // The exclusion only affects whether we show the individual district P&L, not the grouped one
    const filtered = customers.filter(c => regionCustomerSet.has(c.customerId));
    regionCustomers.push(...filtered);
    
    // Collect details for logging
    filtered.forEach(c => {
      const tags = customerIdToDistrictTags[c.customerId] || [];
      regionCustomersWithDetails.push({
        customerId: c.customerId,
        label: c.label,
        districtLabel: districtLabel,
        districtTags: tags,
        hasTags: tags.length > 0
      });
    });
  }


  // Group customers by districtTags
  districtCustomers = groupCustomersByDistrictTags(regionCustomers);

  districtCustomerIds = Array.from(regionCustomerSet);
  
  // For each district group, show which original districts the customers came from
  const districtGroupsWithSourceDistricts = districtCustomers.map(d => {
    // Get unique parent districts for customers in this group
    const sourceDistricts = new Set();
    d.customers.forEach(c => {
      const parentDistrict = customerIdToDistrictLabel[c.customerId];
      if (parentDistrict) {
        sourceDistricts.add(parentDistrict);
      }
    });
    
    return {
      districtLabel: d.districtLabel,
      customerCount: d.customers.length,
      tags: d.districtTags,
      sourceDistricts: Array.from(sourceDistricts),
      sourceDistrictCount: sourceDistricts.size,
      customerLabels: d.customers.slice(0, 5).map(c => c.label),
      note: sourceDistricts.size > 1 
        ? `⚠️ COMBINED: ${sourceDistricts.size} districts combined into one P&L`
        : `Single district group`
    };
  });
  
  // Detailed logging of all districts under the region
  // NOTE: districtReportingExcluded no longer filters out customers from grouped P&Ls
  // Customers from excluded districts are still included in grouped P&Ls based on their tags
  // The exclusion only affects whether we show the individual district P&L report
} else {
  // DISTRICT MODE: Check if selectedDistrictLabel is a district label or a districtTag
  if (selectedDistrictNodeId) {
    // It's a district label - use existing behavior
    const facilities = districtToCustomers[selectedDistrictLabel] || [];
    districtCustomers = facilities;
    districtCustomerIds = facilities.map(c => c.customerId);
    
  } else {
    // Check if it's a districtTag - collect all customers from districts with this tag
    const customersWithTag = [];
    
    for (const [districtLabel, customers] of Object.entries(districtToCustomers)) {
      // Get the district node to check its districtTags
      let districtNode = null;
      for (const nodeId in customerConfigRaw) {
        const node = customerConfigRaw[nodeId];
        if (node?.isDistrict && node.label === districtLabel) {
          districtNode = node;
          break;
        }
      }
      
      // Check if this district has the selected tag
      const districtTags = districtNode?.districtTags || [];
      if (Array.isArray(districtTags) && districtTags.includes(selectedDistrictLabel)) {
        customersWithTag.push(...customers);
      }
    }
    
    if (customersWithTag.length > 0) {
      // Group customers by their districtTags (should be one group since they all have the same tag)
      const grouped = groupCustomersByDistrictTags(customersWithTag);
      
      // Should only be one group, but handle multiple just in case
      districtCustomers = grouped.length > 0 ? grouped[0].customers : [];
      districtCustomerIds = customersWithTag.map(c => c.customerId);
      
    } else {
      console.warn("⚠️ DISTRICT MODE - NO CUSTOMERS FOUND", {
        selectedLabel: selectedDistrictLabel,
        note: "Neither a district label nor a districtTag matched"
      });
    }
  }
}

// =======================================================
// CUSTOMER ID OVERLAP CHECK (MOST IMPORTANT LOG)
// =======================================================
const overlap = districtCustomerIds.filter(id => rawCustomerIds.includes(id));


// =======================================================
// CUSTOMER CODE MAPPING & CENSUS DATA
// =======================================================
// Build map: customer_internal_id → customer_code
const customerIdToCode = {};

// Option 1: Use customerCodeMapping query if available
if (Array.isArray(customerCodeMapping) && customerCodeMapping.length > 0) {
  customerCodeMapping.forEach(row => {
    if (row.customer_internal_id != null && row.customer_code) {
      customerIdToCode[String(row.customer_internal_id)] = row.customer_code;
    }
  });
}

// Option 2: Extract customer codes from customerConfig labels (fallback)
if (Object.keys(customerIdToCode).length === 0) {
  console.log("⚠️ customerCodeMapping empty, extracting from customerConfig labels");
  for (const nodeId in customerConfigRaw) {
    const node = customerConfigRaw[nodeId];
    if (node && node.customer_internal_id != null && node.label) {
      // Extract customer code from label (e.g., "ARM51 - Wellstone..." → "ARM51")
      const match = node.label.match(/^([A-Z0-9]+)\s*[-–]/);
      if (match) {
        customerIdToCode[String(node.customer_internal_id)] = match[1];
      }
    }
  }
}

// Build map: customer_code → census data
const customerCodeToCensus = {};
let censusMatchCount = 0;
let censusSkipReasons = { noCustomerCode: 0, wrongMonth: 0, matched: 0, invalidMonth: 0 };
const dateComparisonLog = [];

// Helper function to normalize dates to YYYY-MM-DD format
function normalizeDate(dateValue) {
  if (!dateValue) return null;
  
  // If already in YYYY-MM-DD format, return as-is
  if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateValue)) {
    return dateValue.slice(0, 10);
  }
  
  // Try to parse and convert to YYYY-MM-DD
  try {
    const date = new Date(dateValue);
    if (isNaN(date.getTime())) return null;
    
    // Get year, month, day in local timezone
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (e) {
    return null;
  }
}

const normalizedIsoMonth = normalizeDate(isoMonth);

if (Array.isArray(censusMonthly)) {
  censusMonthly.forEach((row, index) => {
    if (!row.customer_code) {
      censusSkipReasons.noCustomerCode++;
      return;
    }
    
    const normalizedRowMonth = normalizeDate(row.month);
    
    if (!normalizedRowMonth) {
      censusSkipReasons.invalidMonth++;
      return;
    }
    
    if (normalizedRowMonth !== normalizedIsoMonth) {
      censusSkipReasons.wrongMonth++;
      // Log first few mismatches for debugging
      if (dateComparisonLog.length < 3) {
        dateComparisonLog.push({
          customerCode: row.customer_code,
          rawMonth: row.month,
          normalizedMonth: normalizedRowMonth,
          expected: normalizedIsoMonth
        });
      }
      return;
    }
    
    // Match found!
    censusSkipReasons.matched++;
    
    // Initialize the customer code entry if it doesn't exist
    if (!customerCodeToCensus[row.customer_code]) {
      customerCodeToCensus[row.customer_code] = {
        actualCensus: null,
        budgetCensus: null
      };
    }
    
    // Set the appropriate value based on type
    if (row.type === 'Actuals') {
      customerCodeToCensus[row.customer_code].actualCensus = row.value != null ? row.value : null;
    } else if (row.type === 'Budget') {
      customerCodeToCensus[row.customer_code].budgetCensus = row.value != null ? row.value : null;
    }
  });
}

// Build map: customer_internal_id → start_date_est
const customerIdToStartDate = {};
for (const nodeId in customerConfigRaw) {
  const node = customerConfigRaw[nodeId];
  if (node && node.customer_internal_id != null && node.start_date_est != null && node.start_date_est !== '') {
    customerIdToStartDate[String(node.customer_internal_id)] = node.start_date_est;
  }
}

// Helper function to get census for a customer_internal_id
function getCensusForCustomer(customerId) {
  const customerCode = customerIdToCode[String(customerId)];
  if (customerCode && customerCodeToCensus[customerCode]) {
    return customerCodeToCensus[customerCode];
  }
  return { actualCensus: null, budgetCensus: null };
}

// Helper function to get start_date_est for a customer_internal_id
function getStartDateForCustomer(customerId) {
  return customerIdToStartDate[String(customerId)] || null;
}


// Helper to filter mapped data by customer ids
function filterDataByCustomers(mappedData, rawSource, allowedCustomerIds) {
  const result = { Account: [], Scenario: [], Value: [] };
  let matched = 0;
  
  // DEBUG: Track specific account 319, customer 11176, scenario Actuals
  const DEBUG_ACCOUNT_ID = 319;
  const DEBUG_CUSTOMER_ID = "11176";
  const DEBUG_SCENARIO = "Actuals";
  const debugRows = [];
  const debugAccountRows = [];
  // Initialize account319Label to avoid reference errors
  let account319Label = null;
  
  for (let i = 0; i < mappedData.Account.length; i++) {
    const rowCustomerId = String(rawSource.customer_internal_id?.[i] || "");
    const rowAccountId = rawSource.account_internal_id?.[i];
    const rowScenario = rawSource.scenario?.[i];
    const rowValue = rawSource.value?.[i];
    
    // Track debug rows
    if (rowAccountId === DEBUG_ACCOUNT_ID && rowCustomerId === DEBUG_CUSTOMER_ID && rowScenario === DEBUG_SCENARIO) {
      debugRows.push({
        index: i,
        accountId: rowAccountId,
        accountLabel: mappedData.Account[i],
        customerId: rowCustomerId,
        scenario: rowScenario,
        value: rowValue,
        inAllowedList: allowedCustomerIds.includes(rowCustomerId),
        timeDate: rawSource.time_date?.[i] || "N/A"
      });
    }
    
    // Track all account 319 rows for this customer
    if (rowAccountId === DEBUG_ACCOUNT_ID && rowCustomerId === DEBUG_CUSTOMER_ID) {
      debugAccountRows.push({
        index: i,
        accountId: rowAccountId,
        accountLabel: mappedData.Account[i],
        customerId: rowCustomerId,
        scenario: rowScenario,
        value: rowValue,
        inAllowedList: allowedCustomerIds.includes(rowCustomerId),
        timeDate: rawSource.time_date?.[i] || "N/A"
      });
    }
    
    if (allowedCustomerIds.includes(rowCustomerId)) {
      matched++;
      result.Account.push(mappedData.Account[i]);
      result.Scenario.push(mappedData.Scenario[i]);
      result.Value.push(mappedData.Value[i]);
    }
  }
  
    // Log debug info if we found relevant rows
  if (debugRows.length > 0 || debugAccountRows.length > 0) {
    try {
      // Find account 319 label using idToLabel mapping (defined at top level)
      // Use try-catch to handle case where idToLabel might not be accessible
      try {
        if (typeof idToLabel !== 'undefined' && idToLabel) {
          account319Label = idToLabel[String(DEBUG_ACCOUNT_ID)] || null;
        }
      } catch (e) {
        // idToLabel not accessible in this scope, use null
        account319Label = null;
      }
      
      // Calculate sum of account 319, customer 11176, Actuals in filtered result
      let sumInResult = 0;
      const resultRows = [];
      for (let i = 0; i < result.Account.length; i++) {
        const accountLabel = result.Account[i];
        const scenario = result.Scenario[i];
        const value = Number(result.Value[i]) || 0;
        
        // Find the original row index by matching account, scenario, and value
        // This is approximate but should work for most cases
        for (let origIdx = 0; origIdx < mappedData.Account.length; origIdx++) {
          const origAccountLabel = mappedData.Account[origIdx];
          const origScenario = mappedData.Scenario[origIdx];
          const origValue = mappedData.Value[origIdx];
          const origCustomerId = String(rawSource.customer_internal_id?.[origIdx] || "");
          
          if (origAccountLabel === accountLabel && 
              origScenario === scenario && 
              Math.abs(Number(origValue) - value) < 0.01 &&
              allowedCustomerIds.includes(origCustomerId)) {
            const origAccountId = rawSource.account_internal_id?.[origIdx];
            if (origAccountId === DEBUG_ACCOUNT_ID && origCustomerId === DEBUG_CUSTOMER_ID && origScenario === DEBUG_SCENARIO) {
              sumInResult += value;
              resultRows.push({
                resultIndex: i,
                originalIndex: origIdx,
                accountLabel: accountLabel,
                accountId: origAccountId,
                customerId: origCustomerId,
                scenario: scenario,
                value: value
              });
              break; // Found match, move to next result row
            }
          }
        }
      }
      
      // Also check directly in raw source for rows that match
      let sumInRawSource = 0;
      const rawSourceRows = [];
      for (let i = 0; i < rawSource.account_internal_id?.length || 0; i++) {
        const accId = rawSource.account_internal_id?.[i];
        const custId = String(rawSource.customer_internal_id?.[i] || "");
        const scen = rawSource.scenario?.[i];
        if (accId === DEBUG_ACCOUNT_ID && custId === DEBUG_CUSTOMER_ID && scen === DEBUG_SCENARIO) {
          const val = Number(rawSource.value?.[i]) || 0;
          sumInRawSource += val;
          rawSourceRows.push({
            index: i,
            accountId: accId,
            customerId: custId,
            scenario: scen,
            value: val,
            timeDate: rawSource.time_date?.[i] || "N/A",
            inAllowedList: allowedCustomerIds.includes(custId)
          });
        }
      }
      
      console.log("🔍 FILTER DEBUG - Account 319, Customer 11176", {
        function: "filterDataByCustomers",
        allowedCustomerIds: allowedCustomerIds,
        customerInList: allowedCustomerIds.includes(DEBUG_CUSTOMER_ID),
        account319Label: account319Label || null,
        account319Id: DEBUG_ACCOUNT_ID,
        debugRowsForActuals: debugRows,
        allDebugAccountRows: debugAccountRows,
        totalRowsMatched: matched,
        totalRowsInResult: result.Account.length,
        rawSourceRows: rawSourceRows,
        resultRows: resultRows,
        sumInRawSource: sumInRawSource,
        sumInFilteredResult: sumInResult,
        difference: sumInRawSource - sumInResult,
        note: sumInRawSource !== sumInResult ? "⚠️ MISMATCH: Sums don't match!" : "✅ Sums match"
      });
    } catch (debugError) {
      // Don't let debug logging break the function
      console.warn("⚠️ Debug logging error (non-fatal):", debugError);
    }
  }
  
  return { data: result, matched };
}

// Filter data by hierarchy ID (subsidiary or region) - includes ALL rows including null customer IDs
function filterDataByHierarchyId(mappedData, rawSource, hierarchyId, hierarchyType) {
  const result = { Account: [], Scenario: [], Value: [] };
  let matched = 0;
  const hierarchyField = hierarchyType === "subsidiary" 
    ? rawSource.subsidiary_internal_id 
    : rawSource.region_internal_id;
  
  // Track scenarios for debugging
  const scenarioCounts = {};
  
  for (let i = 0; i < mappedData.Account.length; i++) {
    const rowHierarchyId = hierarchyField?.[i];
    // Match if hierarchy ID matches (includes rows with null customer IDs)
    if (hierarchyId != null && rowHierarchyId != null && String(rowHierarchyId) === String(hierarchyId)) {
      matched++;
      result.Account.push(mappedData.Account[i]);
      result.Scenario.push(mappedData.Scenario[i]);
      result.Value.push(mappedData.Value[i]);
      
      // Count scenarios
      const scenario = mappedData.Scenario[i];
      scenarioCounts[scenario] = (scenarioCounts[scenario] || 0) + 1;
    }
  }
  
  // Log scenario breakdown for debugging
  if (Object.keys(scenarioCounts).length > 0) {
    console.log(`🔵 FILTER BY HIERARCHY (${hierarchyType}):`, {
      hierarchyId,
      matchedRows: matched,
      scenarios: scenarioCounts,
      uniqueScenarios: Object.keys(scenarioCounts),
      scenarioBreakdown: Object.entries(scenarioCounts).map(([scenario, count]) => ({ scenario, count }))
    });
  } else {
    console.warn(`⚠️ FILTER BY HIERARCHY (${hierarchyType}): NO SCENARIOS FOUND`, {
      hierarchyId,
      matchedRows: matched,
      totalRows: mappedData.Account.length
    });
  }
  
  return { data: result, matched };
}

// Helper to calculate account 417 totals from filtered raw data
function calculateAccount417Total(rawSource, allowedCustomerIds) {
  const accountId = 417;
  let totalValue = 0;
  let rowCount = 0;
  const byScenario = {};
  const byCustomer = {};
  const filteredRows = [];
  const excludedRows = [];
  
  const rawAccountIds = rawSource.account_internal_id || [];
  const rawValues = rawSource.value || [];
  const rawScenarios = rawSource.scenario || [];
  const rawCustomers = rawSource.customer_internal_id || [];
  const rawRegions = rawSource.region_internal_id || [];
  const rawSubsidiaries = rawSource.subsidiary_internal_id || [];
  
  for (let i = 0; i < rawAccountIds.length; i++) {
    if (rawAccountIds[i] === accountId) {
      const rowCustomerId = String(rawCustomers[i] || "");
      const value = Number(rawValues[i]) || 0;
      const scenario = rawScenarios[i];
      const customer = rawCustomers[i];
      const region = rawRegions[i];
      const subsidiary = rawSubsidiaries[i];
      
      const rowInfo = {
        index: i,
        customer,
        customerId: rowCustomerId,
        region,
        subsidiary,
        scenario,
        value
      };
      
      if (allowedCustomerIds.includes(rowCustomerId)) {
        rowCount++;
        totalValue += value;
        
        if (!byScenario[scenario]) {
          byScenario[scenario] = 0;
        }
        byScenario[scenario] += value;
        
        if (customer != null) {
          const custKey = String(customer);
          if (!byCustomer[custKey]) {
            byCustomer[custKey] = 0;
          }
          byCustomer[custKey] += value;
        }
        
        filteredRows.push(rowInfo);
      } else {
        excludedRows.push(rowInfo);
      }
    }
  }
  
  return {
    accountId: 417,
    totalValue,
    rowCount,
    byScenario,
    customerCount: Object.keys(byCustomer).length,
    sampleCustomers: Object.entries(byCustomer).slice(0, 5),
    filteredRows,
    excludedRows,
    excludedValue: excludedRows.reduce((sum, r) => sum + r.value, 0)
  };
}

// =======================================================
// RENDER P&LS
// =======================================================
let htmlParts = [];

try {
  if (typeof window.generatePNLHTML !== "function") {
    throw new Error("generatePNLHTML not loaded");
  }

  if (isSubsidiaryMode) {
    // SUBSIDIARY MODE: Subsidiary -> Region -> District -> Customer
    // For summary P&L, use ALL data from query (including null customer IDs and unmapped customers)
    const subsidiaryMonth = filterDataByHierarchyId(monthData, rawMonth, selectedSubsidiaryId, "subsidiary");
    const subsidiaryYtd = filterDataByHierarchyId(ytdData, rawYtd, selectedSubsidiaryId, "subsidiary");

    console.log("🟣 SUBSIDIARY FILTER RESULT", {
      monthMatchedRows: subsidiaryMonth.matched,
      ytdMatchedRows: subsidiaryYtd.matched,
      totalMonth: monthData.Account.length,
      totalYtd: ytdData.Account.length
    });
    
    // Account 417 tracking after subsidiary filter
    const account417AfterFilter = calculateAccount417Total(rawMonth, districtCustomerIds);
    
    // Prominent summary log
    console.log("📊 ACCOUNT 417 FILTER SUMMARY", {
      accountId: 417,
      rawTotal: account417Raw.totalValue,
      rawRows: account417Raw.totalRows,
      filteredTotal: account417AfterFilter.totalValue,
      filteredRows: account417AfterFilter.rowCount,
      excludedTotal: account417AfterFilter.excludedValue,
      excludedRows: account417AfterFilter.excludedRows.length,
      difference: account417Raw.totalValue - account417AfterFilter.totalValue
    });
    
    if (account417AfterFilter.filteredRows.length > 0) {
      console.log("✅ ACCOUNT 417 INCLUDED ROWS", {
        count: account417AfterFilter.filteredRows.length,
        totalValue: account417AfterFilter.totalValue,
        rows: account417AfterFilter.filteredRows.map(r => ({
          customerId: r.customer,
          value: r.value,
          scenario: r.scenario,
          region: r.region,
          subsidiary: r.subsidiary
        }))
      });
    }
    
    if (account417AfterFilter.excludedRows.length > 0) {
      account417AfterFilter.excludedRows.forEach(r => {
        console.error(`❌ ACCOUNT 417 EXCLUDED: Customer ID ${r.customer} (string: "${r.customerId}") - Value: ${r.value} - Reason: ${districtCustomerIds.includes(r.customerId) ? "UNKNOWN" : "Customer ID not in allowed subsidiary list"}`);
      });
      
      console.warn("❌ ACCOUNT 417 EXCLUDED ROWS", {
        count: account417AfterFilter.excludedRows.length,
        excludedValue: account417AfterFilter.excludedValue,
        rows: account417AfterFilter.excludedRows.map(r => ({
          customerId: r.customer,
          customerIdString: r.customerId,
          value: r.value,
          scenario: r.scenario,
          region: r.region,
          subsidiary: r.subsidiary,
          inAllowedList: districtCustomerIds.includes(r.customerId),
          reason: districtCustomerIds.includes(r.customerId) ? "UNKNOWN" : "Customer ID not in allowed list"
        }))
      });
    }
    
    console.log("🔵 ACCOUNT 417 AFTER SUBSIDIARY FILTER", {
      accountId: 417,
      rawTotal: account417Raw.totalValue,
      rawRows: account417Raw.totalRows,
      filteredTotal: account417AfterFilter.totalValue,
      filteredRows: account417AfterFilter.rowCount,
      excludedTotal: account417AfterFilter.excludedValue,
      excludedRows: account417AfterFilter.excludedRows.length,
      difference: account417Raw.totalValue - account417AfterFilter.totalValue,
      byScenario: account417AfterFilter.byScenario,
      filteredRowsDetail: account417AfterFilter.filteredRows,
      excludedRowsDetail: account417AfterFilter.excludedRows,
      filtersApplied: {
        hierarchy: "Subsidiary",
        subsidiaryLabel: selectedDistrictLabel,
        subsidiaryId: selectedSubsidiaryId,
        customerCount: districtCustomerIds.length,
        allowedCustomerIds: districtCustomerIds.slice(0, 10)
      }
    });

    // Count totals for subsidiary header
    let totalRegions = subsidiaryRegions.length;
    let totalDistricts = subsidiaryRegions.reduce((sum, r) => sum + r.districts.length, 0);
    let totalFacilities = districtCustomerIds.length;

    const subsidiaryMeta = {
      ...meta,
      typeLabel: "Subsidiary",
      entityName: selectedDistrictLabel,
      actualCensus: null,
      budgetCensus: null,
      regionCount: totalRegions,
      districtCount: totalDistricts,
      facilityCount: totalFacilities
    };

    const subsidiaryResult = window.generatePNLHTML(
      subsidiaryMonth.data,
      subsidiaryYtd.data,
      selectedDistrictLabel,
      subsidiaryMeta,
      accountConfig,
      sectionConfig
    );

    htmlParts.push(subsidiaryResult.html);

    // Track facilities with revenue for expected parts calculation
    let totalFacilitiesWithRevenue = 0;

    // Render each region within the subsidiary
    subsidiaryRegions.forEach(region => {
      // Get all customer IDs in this region (for facility counts)
      const regionCustomerIds = region.districts.flatMap(d => d.customers.map(c => c.customerId));
      // For region summary P&L, use ALL data from query filtered by region_internal_id (including null customer IDs)
      const regionMonth = filterDataByHierarchyId(monthData, rawMonth, region.regionId, "region");
      const regionYtd = filterDataByHierarchyId(ytdData, rawYtd, region.regionId, "region");

      const regionMeta = {
        ...meta,
        typeLabel: "Region",
        entityName: region.regionLabel,
        actualCensus: null,
        budgetCensus: null,
        regionCount: region.districts.length,
        facilityCount: regionCustomerIds.length
      };

      const regionResult = window.generatePNLHTML(
        regionMonth.data,
        regionYtd.data,
        region.regionLabel,
        regionMeta,
        accountConfig,
        sectionConfig
      );

      htmlParts.push(regionResult.html);

      // Render each district within the region
      region.districts.forEach(dc => {
        const customerIds = dc.customers.map(c => c.customerId);
        const districtMonth = filterDataByCustomers(monthData, rawMonth, customerIds);
        const districtYtd = filterDataByCustomers(ytdData, rawYtd, customerIds);

        let facilitiesWithRevenue = 0;
        const facilityReports = [];

        dc.customers.forEach(customer => {
          const customerMonthData = filterDataByCustomers(monthData, rawMonth, [customer.customerId]).data;
          const customerYtdData = filterDataByCustomers(ytdData, rawYtd, [customer.customerId]).data;
          const censusFacility = getCensusForCustomer(customer.customerId);
          const startDateEst = getStartDateForCustomer(customer.customerId);

          const customerMeta = {
            ...meta,
            typeLabel: "Facility",
            entityName: customer.label,
            parentDistrict: dc.districtLabel,
            actualCensus: censusFacility.actualCensus,
            budgetCensus: censusFacility.budgetCensus,
            startDateEst: startDateEst
          };

          const result = window.generatePNLHTML(
            customerMonthData,
            customerYtdData,
            customer.label,
            customerMeta,
            accountConfig,
            sectionConfig
          );

          if (!result?.noRevenue) {
            facilityReports.push(result.html);
            facilitiesWithRevenue++;
            totalFacilitiesWithRevenue++;
          }
        });

        const districtMeta = {
          ...meta,
          typeLabel: "District",
          entityName: dc.districtLabel,
          actualCensus: null,
          budgetCensus: null,
          facilityCount: facilitiesWithRevenue
        };

        const districtResult = window.generatePNLHTML(
          districtMonth.data,
          districtYtd.data,
          dc.districtLabel,
          districtMeta,
          accountConfig,
          sectionConfig
        );

        htmlParts.push(districtResult.html);
        htmlParts.push(...facilityReports);

        console.log("🟣 SUBSIDIARY RENDER DISTRICT SUMMARY", {
          region: region.regionLabel,
          district: dc.districtLabel,
          facilitiesWithRevenue,
          facilityReportsCount: facilityReports.length
        });
      });

      console.log("🟣 SUBSIDIARY RENDER REGION SUMMARY", {
        region: region.regionLabel,
        districtsInRegion: region.districts.length,
        customersInRegion: regionCustomerIds.length
      });
    });

    const finalHtml = htmlParts.join("\n");
    const htmlSizeBytes = new Blob([finalHtml]).size;
    const htmlSizeMB = (htmlSizeBytes / (1024 * 1024)).toFixed(2);
    const htmlCharCount = finalHtml.length;
    
    // Verify HTML integrity
    // Note: Only count facilities with revenue (those that actually get rendered)
    const expectedParts = 1 + totalRegions + totalDistricts + totalFacilitiesWithRevenue; // subsidiary + regions + districts + facilities with revenue
    const actualParts = htmlParts.length;
    const partsMatch = actualParts === expectedParts;
    
    result = { noRevenue: false, html: finalHtml };
    console.log("🟣 SUBSIDIARY RENDER COMPLETE", {
      htmlParts: htmlParts.length,
      expectedParts,
      partsMatch,
      regions: totalRegions,
      districts: totalDistricts,
      totalFacilities,
      facilitiesWithRevenue: totalFacilitiesWithRevenue,
      htmlSizeBytes,
      htmlSizeMB: `${htmlSizeMB} MB`,
      htmlCharCount
    });
    
    if (htmlSizeBytes > 5 * 1024 * 1024) { // 5MB
      console.warn("⚠️ LARGE HTML WARNING: HTML size exceeds 5MB. May cause performance issues or Retool limits.");
    }
    
    if (!partsMatch) {
      console.error("❌ HTML PARTS MISMATCH: Expected", expectedParts, "parts but got", actualParts);
    }
    
    // Check for potential truncation (Retool limit is typically ~10MB)
    if (htmlSizeBytes > 9 * 1024 * 1024) { // 9MB
      console.error("❌ CRITICAL: HTML size exceeds 9MB. Retool may truncate output. Consider pagination or filtering.");
    }
  } else if (isRegionMode) {
    // REGION MODE: build region summary + district + facility reports
    // For summary P&L, use ALL data from query (including null customer IDs and unmapped customers)
    const regionMonth = filterDataByHierarchyId(monthData, rawMonth, selectedRegionId, "region");
    const regionYtd = filterDataByHierarchyId(ytdData, rawYtd, selectedRegionId, "region");

    // Check scenarios in filtered region data
    const regionMonthScenarios = {};
    (regionMonth.data.Scenario || []).forEach(s => {
      regionMonthScenarios[s] = (regionMonthScenarios[s] || 0) + 1;
    });
    const regionYtdScenarios = {};
    (regionYtd.data.Scenario || []).forEach(s => {
      regionYtdScenarios[s] = (regionYtdScenarios[s] || 0) + 1;
    });
    
    console.log("🟣 REGION FILTER RESULT", {
      monthMatchedRows: regionMonth.matched,
      ytdMatchedRows: regionYtd.matched,
      totalMonth: monthData.Account.length,
      totalYtd: ytdData.Account.length,
      selectedRegionId,
      regionMonthScenarios,
      regionYtdScenarios,
      regionMonthScenarioKeys: Object.keys(regionMonthScenarios),
      regionYtdScenarioKeys: Object.keys(regionYtdScenarios)
    });
    
    // Account 417 tracking after region filter
    const account417AfterFilter = calculateAccount417Total(rawMonth, districtCustomerIds);
    
    // Prominent summary log
    console.log("📊 ACCOUNT 417 FILTER SUMMARY", {
      accountId: 417,
      rawTotal: account417Raw.totalValue,
      rawRows: account417Raw.totalRows,
      filteredTotal: account417AfterFilter.totalValue,
      filteredRows: account417AfterFilter.rowCount,
      excludedTotal: account417AfterFilter.excludedValue,
      excludedRows: account417AfterFilter.excludedRows.length,
      difference: account417Raw.totalValue - account417AfterFilter.totalValue
    });
    
    if (account417AfterFilter.filteredRows.length > 0) {
      console.log("✅ ACCOUNT 417 INCLUDED ROWS", {
        count: account417AfterFilter.filteredRows.length,
        totalValue: account417AfterFilter.totalValue,
        rows: account417AfterFilter.filteredRows.map(r => ({
          customerId: r.customer,
          value: r.value,
          scenario: r.scenario,
          region: r.region,
          subsidiary: r.subsidiary
        }))
      });
    }
    
    if (account417AfterFilter.excludedRows.length > 0) {
      account417AfterFilter.excludedRows.forEach(r => {
        console.error(`❌ ACCOUNT 417 EXCLUDED: Customer ID ${r.customer} (string: "${r.customerId}") - Value: ${r.value} - Reason: ${districtCustomerIds.includes(r.customerId) ? "UNKNOWN" : "Customer ID not in allowed region list"}`);
      });
      
      console.warn("❌ ACCOUNT 417 EXCLUDED ROWS", {
        count: account417AfterFilter.excludedRows.length,
        excludedValue: account417AfterFilter.excludedValue,
        rows: account417AfterFilter.excludedRows.map(r => ({
          customerId: r.customer,
          customerIdString: r.customerId,
          value: r.value,
          scenario: r.scenario,
          region: r.region,
          subsidiary: r.subsidiary,
          inAllowedList: districtCustomerIds.includes(r.customerId),
          reason: districtCustomerIds.includes(r.customerId) ? "UNKNOWN" : "Customer ID not in allowed list"
        }))
      });
    }
    
    console.log("🔵 ACCOUNT 417 AFTER REGION FILTER", {
      accountId: 417,
      rawTotal: account417Raw.totalValue,
      rawRows: account417Raw.totalRows,
      filteredTotal: account417AfterFilter.totalValue,
      filteredRows: account417AfterFilter.rowCount,
      excludedTotal: account417AfterFilter.excludedValue,
      excludedRows: account417AfterFilter.excludedRows.length,
      difference: account417Raw.totalValue - account417AfterFilter.totalValue,
      byScenario: account417AfterFilter.byScenario,
      filteredRowsDetail: account417AfterFilter.filteredRows,
      excludedRowsDetail: account417AfterFilter.excludedRows,
      filtersApplied: {
        hierarchy: "Region",
        regionLabel: selectedDistrictLabel,
        regionId: selectedRegionId,
        customerCount: districtCustomerIds.length,
        allowedCustomerIds: districtCustomerIds.slice(0, 10)
      }
    });

    // Region census (sum of facilities in region)
    let regionActualCensus = 0;
    let regionBudgetCensus = 0;
    let regionCensusCount = 0;

    districtCustomers.forEach(dc => {
      dc.customers.forEach(c => {
        const census = getCensusForCustomer(c.customerId);
        if (census.actualCensus != null) {
          regionActualCensus += Number(census.actualCensus);
          regionCensusCount++;
        }
        if (census.budgetCensus != null) {
          regionBudgetCensus += Number(census.budgetCensus);
        }
      });
    });

    const regionMeta = {
      ...meta,
      typeLabel: "Region",
      entityName: selectedDistrictLabel,
      actualCensus: null, // hide at region
      budgetCensus: null,
      facilityCount: districtCustomerIds.length,
      regionCount: districtCustomers.length
    };

    const regionResult = window.generatePNLHTML(
      regionMonth.data,
      regionYtd.data,
      selectedDistrictLabel,
      regionMeta,
      accountConfig,
      sectionConfig
    );

    htmlParts.push(regionResult.html);

    // Now per-district reports within region
    // Log district groups with full details
    const districtGroupsDetails = districtCustomers.map(dc => {
      // Show which original districts the customers came from
      const sourceDistricts = new Set();
      dc.customers.forEach(c => {
        const parentDistrict = customerIdToDistrictLabel[c.customerId];
        if (parentDistrict) sourceDistricts.add(parentDistrict);
      });
      
      return {
        districtLabel: dc.districtLabel,
        customerCount: dc.customers.length,
        tags: dc.districtTags,
        tagsString: JSON.stringify(dc.districtTags),
        sourceDistricts: Array.from(sourceDistricts),
        sourceDistrictCount: sourceDistricts.size,
        customerLabels: dc.customers.slice(0, 3).map(c => c.label),
        note: sourceDistricts.size > 1 
          ? `⚠️ COMBINED: ${sourceDistricts.size} districts combined`
          : `Single district`
      };
    });
    
    console.log("🟣 REGION RENDER - DISTRICT GROUPS TO RENDER", {
      totalGroups: districtCustomers.length,
      groups: districtGroupsDetails
    });
    
    // Also log a simple list of district labels that will be rendered
    console.log("🟣 DISTRICT LABELS TO RENDER (simple list):", 
      districtGroupsDetails.map(g => ({
        label: g.districtLabel,
        combined: g.sourceDistrictCount > 1,
        fromDistricts: g.sourceDistricts
      }))
    );
    
    districtCustomers.forEach(dc => {
      const customerIds = dc.customers.map(c => c.customerId);
      
      // DEBUG: Check if customer 11176 is in this district group
      const DEBUG_CUSTOMER_ID = "11176";
      const DEBUG_ACCOUNT_ID = 319;
      const DEBUG_SCENARIO = "Actuals";
      const DEBUG_TIME_DATE = "2025-08-01"; // Filter by specific time_date
      const hasDebugCustomer = customerIds.includes(DEBUG_CUSTOMER_ID);
      
      if (hasDebugCustomer) {
        console.log("🔍 REGION DISTRICT ROLLUP DEBUG - Starting", {
          districtLabel: dc.districtLabel,
          districtTags: dc.districtTags,
          customerIds: customerIds,
          customerCount: customerIds.length,
          debugCustomerIncluded: hasDebugCustomer,
          allCustomers: dc.customers.map(c => ({ id: c.customerId, label: c.label }))
        });
        
        // Check raw data for account 319, customer 11176, Actuals before filtering
        let rawSumBeforeFilter = 0;
        let rawRowsBeforeFilter = [];
        for (let i = 0; i < rawMonth.account_internal_id?.length || 0; i++) {
          const accId = rawMonth.account_internal_id?.[i];
          const custId = String(rawMonth.customer_internal_id?.[i] || "");
          const scen = rawMonth.scenario?.[i];
          const timeDate = rawMonth.time_date?.[i];
          const normalizedTimeDate = timeDate ? String(timeDate).slice(0, 10) : null; // Get YYYY-MM-DD part
          
          if (accId === DEBUG_ACCOUNT_ID && 
              custId === DEBUG_CUSTOMER_ID && 
              scen === DEBUG_SCENARIO &&
              normalizedTimeDate === DEBUG_TIME_DATE) {
            const val = Number(rawMonth.value?.[i]) || 0;
            rawSumBeforeFilter += val;
            rawRowsBeforeFilter.push({
              index: i,
              accountId: accId,
              customerId: custId,
              scenario: scen,
              value: val,
              timeDate: timeDate || "N/A",
              normalizedTimeDate: normalizedTimeDate
            });
          }
        }
        
        console.log("🔍 REGION DISTRICT ROLLUP DEBUG - Raw Data Before Filter", {
          districtLabel: dc.districtLabel,
          rawSumForCustomer11176: rawSumBeforeFilter,
          rawRowsCount: rawRowsBeforeFilter.length,
          rawRows: rawRowsBeforeFilter,
          timeDateFilter: DEBUG_TIME_DATE,
          note: `Filtered by account 319, customer 11176, scenario Actuals, time_date ${DEBUG_TIME_DATE}`
        });
      }
      
      const districtMonth = filterDataByCustomers(monthData, rawMonth, customerIds);
      const districtYtd = filterDataByCustomers(ytdData, rawYtd, customerIds);
      
      if (hasDebugCustomer) {
        console.log("🔍 REGION DISTRICT ROLLUP DEBUG - After Filter", {
          districtLabel: dc.districtLabel,
          districtMonthRows: districtMonth.data.Account.length,
          districtYtdRows: districtYtd.data.Account.length,
          districtMonthMatched: districtMonth.matched,
          districtYtdMatched: districtYtd.matched
        });
      }

      let facilitiesWithRevenue = 0;
      const facilityReports = [];

      dc.customers.forEach(customer => {
        const customerMonthData = filterDataByCustomers(monthData, rawMonth, [customer.customerId]).data;
        const customerYtdData = filterDataByCustomers(ytdData, rawYtd, [customer.customerId]).data;
        const censusFacility = getCensusForCustomer(customer.customerId);
        const startDateEst = getStartDateForCustomer(customer.customerId);
        
        // DEBUG: Track account 319 for customer 11176
        const DEBUG_CUSTOMER_ID = "11176";
        const DEBUG_ACCOUNT_ID = 319;
        const DEBUG_SCENARIO = "Actuals";
        const DEBUG_TIME_DATE = "2025-08-01"; // Filter by specific time_date
        const isDebugCustomer = customer.customerId === DEBUG_CUSTOMER_ID;
        // Find account 319 label using idToLabel mapping (define outside if blocks for scope)
        let account319Label = null;
        if (isDebugCustomer) {
          try {
            if (typeof idToLabel !== 'undefined' && idToLabel) {
              account319Label = idToLabel[String(DEBUG_ACCOUNT_ID)] || null;
            }
          } catch (e) {
            account319Label = null;
          }
        }
        
        if (isDebugCustomer) {
          try {
            // Calculate sum directly from rawMonth, filtering by account, scenario, customer, AND time_date
            let customerSum = 0;
            let customerRowCount = 0;
            const customerRows = [];
            for (let i = 0; i < rawMonth.account_internal_id?.length; i++) {
              const origAccountId = rawMonth.account_internal_id?.[i];
              const origCustomerId = String(rawMonth.customer_internal_id?.[i] || "");
              const origScenario = rawMonth.scenario?.[i];
              const origTimeDate = rawMonth.time_date?.[i];
              const normalizedTimeDate = origTimeDate ? String(origTimeDate).slice(0, 10) : null; // Get YYYY-MM-DD part
              const origValue = Number(rawMonth.value?.[i]) || 0;
              
              if (origAccountId === DEBUG_ACCOUNT_ID && 
                  origCustomerId === DEBUG_CUSTOMER_ID &&
                  origScenario === DEBUG_SCENARIO &&
                  normalizedTimeDate === DEBUG_TIME_DATE) {
                customerSum += origValue;
                customerRowCount++;
                customerRows.push({
                  value: origValue,
                  timeDate: origTimeDate || "N/A",
                  index: i
                });
              }
            }
            
            console.log("🔍 CUSTOMER P&L DEBUG - Customer 11176 Direct Value", {
              customerId: customer.customerId,
              customerLabel: customer.label,
              account319Label: account319Label || null,
              account319Id: DEBUG_ACCOUNT_ID,
              customerSumForAccount319: customerSum,
              customerRowCount: customerRowCount,
              customerRows: customerRows,
              timeDateFilter: DEBUG_TIME_DATE,
              note: `This is the direct customer value for account 319, scenario Actuals, time_date ${DEBUG_TIME_DATE}`
            });
          } catch (debugError) {
            console.warn("⚠️ Customer debug logging error (non-fatal):", debugError);
          }
        }

        const customerMeta = {
          ...meta,
          typeLabel: "Facility",
          entityName: customer.label,
          parentDistrict: dc.districtLabel,
          actualCensus: censusFacility.actualCensus,
          budgetCensus: censusFacility.budgetCensus,
          startDateEst: startDateEst
        };

        const result = window.generatePNLHTML(
          customerMonthData,
          customerYtdData,
          customer.label,
          customerMeta,
          accountConfig,
          sectionConfig
        );
        
        if (isDebugCustomer) {
          try {
            console.log("🔍 CUSTOMER P&L DEBUG - After P&L Generation", {
              customerId: customer.customerId,
              customerLabel: customer.label,
              account319Label: account319Label || null,
              note: "Check buildTotals and computeTotals logs for final computed value"
            });
          } catch (debugError) {
            console.warn("⚠️ Customer debug logging error (non-fatal):", debugError);
          }
        }

        if (!result?.noRevenue) {
          facilityReports.push(result.html);
          facilitiesWithRevenue++;
        }
      });

      const districtMeta = {
        ...meta,
        typeLabel: "District",
        entityName: dc.districtLabel,
        actualCensus: null,
        budgetCensus: null,
        facilityCount: facilitiesWithRevenue
      };

      // DEBUG: Before P&L generation, calculate account 319 sum from filtered district data
      if (hasDebugCustomer) {
        try {
          const account319Label = idToLabel[String(DEBUG_ACCOUNT_ID)] || null;
          
          // Calculate sum from districtMonth data (this is what will be rolled up)
          let districtSumForAccount319 = 0;
          let districtRowCount = 0;
          
          // Calculate customer breakdown directly from raw data (more reliable)
          const customerBreakdown = {};
          for (let i = 0; i < rawMonth.account_internal_id?.length; i++) {
            const origAccountId = rawMonth.account_internal_id?.[i];
            const origCustomerId = String(rawMonth.customer_internal_id?.[i] || "");
            const origScenario = rawMonth.scenario?.[i];
            const origValue = Number(rawMonth.value?.[i]) || 0;
            
            // Only count rows that match our criteria AND are in the district AND match the time_date
            const origTimeDate = rawMonth.time_date?.[i];
            const normalizedTimeDate = origTimeDate ? String(origTimeDate).slice(0, 10) : null; // Get YYYY-MM-DD part
            
            if (origAccountId === DEBUG_ACCOUNT_ID && 
                origScenario === DEBUG_SCENARIO &&
                normalizedTimeDate === DEBUG_TIME_DATE &&
                customerIds.includes(origCustomerId)) {
              
              if (!customerBreakdown[origCustomerId]) {
                customerBreakdown[origCustomerId] = { count: 0, sum: 0, rows: [] };
              }
              customerBreakdown[origCustomerId].count++;
              customerBreakdown[origCustomerId].sum += origValue;
              customerBreakdown[origCustomerId].rows.push({
                value: origValue,
                timeDate: origTimeDate || "N/A",
                index: i
              });
              
              districtSumForAccount319 += origValue;
              districtRowCount++;
            }
          }
          
          // Also verify the districtMonth filtered data matches
          let districtMonthSum = 0;
          let districtMonthCount = 0;
          for (let i = 0; i < districtMonth.data.Account.length; i++) {
            if (districtMonth.data.Account[i] === account319Label && 
                districtMonth.data.Scenario[i] === DEBUG_SCENARIO) {
              const val = Number(districtMonth.data.Value[i]) || 0;
              districtMonthSum += val;
              districtMonthCount++;
            }
          }
          
          console.log("🔍 REGION DISTRICT ROLLUP DEBUG - Account 319 Sum Before P&L", {
            districtLabel: dc.districtLabel,
            account319Label: account319Label,
            account319Id: DEBUG_ACCOUNT_ID,
            districtSumForAccount319: districtSumForAccount319,
            districtRowCount: districtRowCount,
            districtMonthSum: districtMonthSum,
            districtMonthCount: districtMonthCount,
            districtMonthTotalRows: districtMonth.data.Account.length,
            customerIdsInDistrict: customerIds,
            customerBreakdown: customerBreakdown,
            customer11176Value: customerBreakdown[DEBUG_CUSTOMER_ID]?.sum || 0,
            customer11176RowCount: customerBreakdown[DEBUG_CUSTOMER_ID]?.count || 0,
            customer11176Rows: customerBreakdown[DEBUG_CUSTOMER_ID]?.rows || [],
            sumMatches: Math.abs(districtSumForAccount319 - districtMonthSum) < 0.01,
            note: "customerBreakdown shows each customer's contribution. customer11176Value should match the direct customer value (369.77)."
          });
        } catch (debugError) {
          console.warn("⚠️ District rollup debug logging error (non-fatal):", debugError);
        }
      }

      const districtResult = window.generatePNLHTML(
        districtMonth.data,
        districtYtd.data,
        dc.districtLabel,
        districtMeta,
        accountConfig,
        sectionConfig
      );
      
        // DEBUG: After P&L generation, check if we can extract account 319 value
      if (hasDebugCustomer) {
        try {
          // Find account 319 label using idToLabel mapping
          let account319Label = null;
          try {
            if (typeof idToLabel !== 'undefined' && idToLabel) {
              account319Label = idToLabel[String(DEBUG_ACCOUNT_ID)] || null;
            }
          } catch (e) {
            account319Label = null;
          }
          
          // Get computed totals from global store (set by generatePNLHTML)
          let computedAccount319Value = null;
          let buildTotalsAccount319Value = null;
          let globalStoreInfo = null;
          if (typeof window !== 'undefined' && window._lastPNLComputedTotals) {
            const computed = window._lastPNLComputedTotals;
            globalStoreInfo = {
              entityName: computed.entityName,
              typeLabel: computed.typeLabel,
              matchesDistrict: computed.entityName === dc.districtLabel && computed.typeLabel === "District"
            };
            if (computed.entityName === dc.districtLabel && computed.typeLabel === "District") {
              computedAccount319Value = computed.monthActuals[account319Label] || null;
              buildTotalsAccount319Value = computed.monthActualsRaw[account319Label] || null;
            }
          }
          
          // Get the input sum from the previous log (we stored it in districtSumForAccount319)
          // We'll need to recalculate it here for comparison, filtering by time_date as well
          let inputSum = 0;
          for (let i = 0; i < rawMonth.account_internal_id?.length; i++) {
            const origAccountId = rawMonth.account_internal_id?.[i];
            const origCustomerId = String(rawMonth.customer_internal_id?.[i] || "");
            const origScenario = rawMonth.scenario?.[i];
            const origTimeDate = rawMonth.time_date?.[i];
            const normalizedTimeDate = origTimeDate ? String(origTimeDate).slice(0, 10) : null; // Get YYYY-MM-DD part
            const origValue = Number(rawMonth.value?.[i]) || 0;
            
            if (origAccountId === DEBUG_ACCOUNT_ID && 
                origScenario === DEBUG_SCENARIO &&
                normalizedTimeDate === DEBUG_TIME_DATE &&
                customerIds.includes(origCustomerId)) {
              inputSum += origValue;
            }
          }
          
          // Create a focused summary log for customer 11176 investigation
          // First, log a simple direct comparison that won't be truncated
          console.log("🔍🔍🔍 KEY COMPARISON - District 121 Account 319", {
            inputSum: inputSum,
            buildTotalsValue: buildTotalsAccount319Value,
            computedFinalValue: computedAccount319Value,
            difference: computedAccount319Value !== null ? computedAccount319Value - inputSum : null,
            issueFound: computedAccount319Value !== null && Math.abs(computedAccount319Value - inputSum) >= 0.01
          });
          
          const summary = {
            "🔍 CUSTOMER 11176 INVESTIGATION - District 121 Summary": {
              customerId: DEBUG_CUSTOMER_ID,
              customerDirectValue: 369.77, // Known from earlier logs
              districtInputSum: inputSum,
              buildTotalsValue: buildTotalsAccount319Value,
              computedFinalValue: computedAccount319Value,
              difference: computedAccount319Value !== null ? computedAccount319Value - inputSum : null,
              issueFound: computedAccount319Value !== null && Math.abs(computedAccount319Value - inputSum) >= 0.01,
              note: computedAccount319Value !== null && Math.abs(computedAccount319Value - inputSum) >= 0.01 
                ? `⚠️ ISSUE: Final value (${computedAccount319Value}) is ${computedAccount319Value - inputSum} higher than input (${inputSum})`
                : computedAccount319Value === null
                ? "⚠️ Could not retrieve computed value - check COMPUTE TOTALS logs for account319FinalTotal"
                : "✅ All values match"
            }
          };
          console.log("", summary); // Empty string first to make it stand out
          
          // Also log the detailed version
          console.log("🔍 REGION DISTRICT ROLLUP DEBUG - After P&L Generation (Detailed)", {
            districtLabel: dc.districtLabel,
            account319Label: account319Label || null,
            account319Id: DEBUG_ACCOUNT_ID,
            inputSum: inputSum,
            buildTotalsValue: buildTotalsAccount319Value,
            computedFinalValue: computedAccount319Value,
            difference: computedAccount319Value !== null ? computedAccount319Value - inputSum : null,
            valuesMatch: computedAccount319Value !== null && Math.abs(computedAccount319Value - inputSum) < 0.01,
            globalStoreInfo: globalStoreInfo,
            hasGlobalStore: typeof window !== 'undefined' && !!window._lastPNLComputedTotals
          });
        } catch (debugError) {
          console.warn("⚠️ District rollup debug logging error (non-fatal):", debugError);
        }
      }

      htmlParts.push(districtResult.html);
      htmlParts.push(...facilityReports);

      console.log("🟣 REGION RENDER DISTRICT SUMMARY", {
        district: dc.districtLabel,
        facilitiesWithRevenue,
        facilityReportsCount: facilityReports.length,
        districtMonthRows: districtMonth.data.Account.length,
        districtYtdRows: districtYtd.data.Account.length
      });
    });

    const finalHtml = htmlParts.join("\n");
    const htmlSizeBytes = new Blob([finalHtml]).size;
    const htmlSizeMB = (htmlSizeBytes / (1024 * 1024)).toFixed(2);
    const htmlCharCount = finalHtml.length;
    
    result = { noRevenue: false, html: finalHtml };
    console.log("🟣 REGION RENDER COMPLETE", {
      htmlParts: htmlParts.length,
      htmlSizeBytes,
      htmlSizeMB: `${htmlSizeMB} MB`,
      htmlCharCount
    });
    
    if (htmlSizeBytes > 5 * 1024 * 1024) { // 5MB
      console.warn("⚠️ LARGE HTML WARNING: HTML size exceeds 5MB. May cause performance issues or Retool limits.");
    }
    
    if (htmlSizeBytes > 9 * 1024 * 1024) { // 9MB
      console.error("❌ CRITICAL: HTML size exceeds 9MB. Retool may truncate output. Consider pagination or filtering.");
    }
  } else {
    // DISTRICT MODE: existing behavior
    const districtMonth = filterDataByCustomers(monthData, rawMonth, districtCustomerIds);
    const districtYtd = filterDataByCustomers(ytdData, rawYtd, districtCustomerIds);

    console.log("🟡 DISTRICT FILTER RESULT", {
      monthMatchedRows: districtMonth.matched,
      ytdMatchedRows: districtYtd.matched,
      totalMonth: monthData.Account.length,
      totalYtd: ytdData.Account.length
    });
    
    // Account 417 tracking after district filter
    const account417AfterFilter = calculateAccount417Total(rawMonth, districtCustomerIds);
    
    // Prominent summary log
    console.log("📊 ACCOUNT 417 FILTER SUMMARY", {
      accountId: 417,
      rawTotal: account417Raw.totalValue,
      rawRows: account417Raw.totalRows,
      filteredTotal: account417AfterFilter.totalValue,
      filteredRows: account417AfterFilter.rowCount,
      excludedTotal: account417AfterFilter.excludedValue,
      excludedRows: account417AfterFilter.excludedRows.length,
      difference: account417Raw.totalValue - account417AfterFilter.totalValue
    });
    
    if (account417AfterFilter.filteredRows.length > 0) {
      console.log("✅ ACCOUNT 417 INCLUDED ROWS", {
        count: account417AfterFilter.filteredRows.length,
        totalValue: account417AfterFilter.totalValue,
        rows: account417AfterFilter.filteredRows.map(r => ({
          customerId: r.customer,
          value: r.value,
          scenario: r.scenario,
          region: r.region,
          subsidiary: r.subsidiary
        }))
      });
    }
    
    if (account417AfterFilter.excludedRows.length > 0) {
      account417AfterFilter.excludedRows.forEach(r => {
        console.error(`❌ ACCOUNT 417 EXCLUDED: Customer ID ${r.customer} (string: "${r.customerId}") - Value: ${r.value} - Reason: ${districtCustomerIds.includes(r.customerId) ? "UNKNOWN" : "Customer ID not in allowed district list"}`);
      });
      
      console.warn("❌ ACCOUNT 417 EXCLUDED ROWS", {
        count: account417AfterFilter.excludedRows.length,
        excludedValue: account417AfterFilter.excludedValue,
        rows: account417AfterFilter.excludedRows.map(r => ({
          customerId: r.customer,
          customerIdString: r.customerId,
          value: r.value,
          scenario: r.scenario,
          region: r.region,
          subsidiary: r.subsidiary,
          inAllowedList: districtCustomerIds.includes(r.customerId),
          reason: districtCustomerIds.includes(r.customerId) ? "UNKNOWN" : "Customer ID not in allowed list"
        }))
      });
    }
    
    console.log("🔵 ACCOUNT 417 AFTER DISTRICT FILTER", {
      accountId: 417,
      rawTotal: account417Raw.totalValue,
      rawRows: account417Raw.totalRows,
      filteredTotal: account417AfterFilter.totalValue,
      filteredRows: account417AfterFilter.rowCount,
      excludedTotal: account417AfterFilter.excludedValue,
      excludedRows: account417AfterFilter.excludedRows.length,
      difference: account417Raw.totalValue - account417AfterFilter.totalValue,
      byScenario: account417AfterFilter.byScenario,
      filteredRowsDetail: account417AfterFilter.filteredRows,
      excludedRowsDetail: account417AfterFilter.excludedRows,
      filtersApplied: {
        hierarchy: "District",
        districtLabel: selectedDistrictLabel,
        customerCount: districtCustomerIds.length,
        allowedCustomerIds: districtCustomerIds.slice(0, 10)
      }
    });

    // Calculate district-level census (sum of all facilities)
    let districtActualCensus = 0;
    let districtBudgetCensus = 0;
    let censusCount = 0;
    const facilityCensusDebug = [];

  for (const customer of districtCustomers) {
      const censusFacility = getCensusForCustomer(customer.customerId);
      const customerCode = customerIdToCode[String(customer.customerId)];
      
      facilityCensusDebug.push({
        label: customer.label,
        customerId: customer.customerId,
        customerCode: customerCode,
        actualCensus: censusFacility.actualCensus,
        budgetCensus: censusFacility.budgetCensus
      });
      
      if (censusFacility.actualCensus != null) {
        districtActualCensus += Number(censusFacility.actualCensus);
        censusCount++;
      }
      if (censusFacility.budgetCensus != null) {
        districtBudgetCensus += Number(censusFacility.budgetCensus);
      }
    }


    // First, generate all facility reports and count ones with revenue
    const facilityReports = [];
    let facilitiesWithRevenue = 0;

    for (const customer of districtCustomers) {
      const customerMonthData = filterDataByCustomers(monthData, rawMonth, [customer.customerId]).data;
      const customerYtdData = filterDataByCustomers(ytdData, rawYtd, [customer.customerId]).data;

      // Get census data for this facility
      const censusFacility = getCensusForCustomer(customer.customerId);
      const startDateEst = getStartDateForCustomer(customer.customerId);

    const customerMeta = {
      ...meta,
      typeLabel: "Facility",
        entityName: customer.label,
        actualCensus: censusFacility.actualCensus,
        budgetCensus: censusFacility.budgetCensus,
        startDateEst: startDateEst
    };

    const result = window.generatePNLHTML(
      customerMonthData,
        customerYtdData,
      customer.label,
      customerMeta,
      accountConfig,
      sectionConfig
    );

    if (!result?.noRevenue) {
        facilityReports.push(result.html);
        facilitiesWithRevenue++;
      }
    }

    console.log("🟣 FACILITY COUNT:", {
      totalFacilities: districtCustomers.length,
      facilitiesWithRevenue: facilitiesWithRevenue
    });

    // Now generate district report with the facility count
    // Use selectedDistrictLabel as the entity name (will be tag name if tag is selected, district label otherwise)
    const districtMeta = {
      ...meta,
      typeLabel: "District",
      entityName: selectedDistrictLabel,
      actualCensus: null,  // Don't display census at district level
      budgetCensus: null,   // Don't display census at district level
      facilityCount: facilitiesWithRevenue
    };

    const districtResult = window.generatePNLHTML(
      districtMonth.data,
      districtYtd.data,
      selectedDistrictLabel,
      districtMeta,
      accountConfig,
      sectionConfig
    );

    // Add district report first, then facility reports
    htmlParts.push(districtResult.html);
    htmlParts.push(...facilityReports);

    const finalHtml = htmlParts.join("\n");
    const htmlSizeBytes = new Blob([finalHtml]).size;
    const htmlSizeMB = (htmlSizeBytes / (1024 * 1024)).toFixed(2);
    const htmlCharCount = finalHtml.length;

  result = {
    noRevenue: false,
      html: finalHtml
    };

    console.log("🟣 DISTRICT RENDER COMPLETE", {
      htmlParts: htmlParts.length,
      facilitiesWithRevenue,
      htmlSizeBytes,
      htmlSizeMB: `${htmlSizeMB} MB`,
      htmlCharCount
    });
    
    if (htmlSizeBytes > 5 * 1024 * 1024) { // 5MB
      console.warn("⚠️ LARGE HTML WARNING: HTML size exceeds 5MB. May cause performance issues or Retool limits.");
    }
    
    if (htmlSizeBytes > 9 * 1024 * 1024) { // 9MB
      console.error("❌ CRITICAL: HTML size exceeds 9MB. Retool may truncate output. Consider pagination or filtering.");
    }
  }

} catch (err) {
  console.error("❌ PNL ERROR", err);
  result = {
    noRevenue: false,
    html: `<div>Error generating P&L: ${err.message}</div>`
  };
}

// Final integrity check
if (result && result.html) {
  const finalSize = new Blob([result.html]).size;
  const finalSizeMB = (finalSize / (1024 * 1024)).toFixed(2);
  const endsProperly = result.html.trim().endsWith("</div>") || result.html.trim().endsWith("</table>");
  
  console.log("🔵 FINAL OUTPUT CHECK", {
    htmlSizeMB: `${finalSizeMB} MB`,
    htmlLength: result.html.length,
    endsProperly,
    firstChars: result.html.substring(0, 100),
    lastChars: result.html.substring(Math.max(0, result.html.length - 100))
  });
  
  if (!endsProperly && finalSize > 1000) {
    console.warn("⚠️ HTML may be truncated - doesn't end with expected closing tags");
  }
}

console.log("🔵 TRANSFORMER COMPLETE");
return result;
return result;