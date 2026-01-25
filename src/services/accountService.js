/**
 * Account Service
 * 
 * Handles account configuration and hierarchy logic from account_config.json.
 * Provides methods for building account trees, computing rollups, and managing
 * account relationships for P&L rendering.
 */

/**
 * Section configuration defines how accounts are grouped in P&L reports
 */
const SECTION_CONFIG = {
  'REVENUE': {
    header: 'REVENUE',
    accounts: ['Income']
  },
  'COST OF GOODS SOLD': {
    header: 'COST OF GOODS SOLD',
    accounts: ['Cost of Sales', 'Gross Profit']
  },
  'EXPENSES': {
    header: 'EXPENSES',
    accounts: ['Expense', 'Net Ordinary Income', 'Net Income', 'Other Income and Expenses']
  }
};

/**
 * Builds a map of parent account LABELS to their children LABELS
 * Children are sorted by their order field from the configuration
 * 
 * @param {Object} accountConfig - The account configuration object
 * @returns {Object} Map of parentLabel -> [childLabel, childLabel, ...] (sorted by order)
 */
function buildChildrenMap(accountConfig) {
  const childrenMap = {};
  
  // Build a label -> config map for quick lookups
  const labelToConfig = {};
  for (const configId in accountConfig) {
    const config = accountConfig[configId];
    if (config.label) {
      labelToConfig[config.label] = config;
    }
  }
  
  for (const configId in accountConfig) {
    const config = accountConfig[configId];
    const parentConfigId = config?.parent;
    
    if (parentConfigId) {
      // Get parent's label
      const parentLabel = accountConfig[parentConfigId]?.label;
      // Get this account's label
      const childLabel = config.label;
      
      if (parentLabel && childLabel) {
        if (!childrenMap[parentLabel]) {
          childrenMap[parentLabel] = [];
        }
        childrenMap[parentLabel].push(childLabel);
      }
    }
  }
  
  // Sort all children arrays by the order field
  for (const parentLabel in childrenMap) {
    childrenMap[parentLabel].sort((a, b) => {
      const orderA = labelToConfig[a]?.order ?? 0;
      const orderB = labelToConfig[b]?.order ?? 0;
      return orderA - orderB;
    });
  }
  
  return childrenMap;
}

/**
 * Gets the section configuration for P&L rendering
 * 
 * @returns {Object} Section configuration object
 */
function getSectionConfig() {
  return SECTION_CONFIG;
}

/**
 * Builds account totals from raw BigQuery data
 * Groups by account label and scenario (Actuals vs Budget)
 * 
 * @param {Object} data - BigQuery result data with Account, Scenario, Value arrays
 * @param {string} scenario - 'Actuals' or 'Budget'
 * @returns {Object} Map of account label -> total value
 */
function buildAccountTotals(data, scenario) {
  const totals = {};
  
  if (!data?.Account || !data?.Value || !data?.Scenario) {
    return totals;
  }
  
  for (let i = 0; i < data.Account.length; i++) {
    if (data.Scenario[i] === scenario) {
      const acct = data.Account[i];
      const val = Number(data.Value[i]) || 0;
      totals[acct] = (totals[acct] || 0) + val;
    }
  }
  
  return totals;
}

/**
 * Filters BigQuery data by specific customer IDs
 * Returns a subset of the data containing only rows for the specified customers
 * 
 * @param {Object} data - BigQuery result data with Account, Scenario, Value, customer_internal_id arrays
 * @param {Array<number>} customerIds - Array of customer internal IDs to include
 * @returns {Object} Filtered data in the same array format
 */
function filterDataByCustomers(data, customerIds) {
  if (!data?.Account || !data?.customer_internal_id) {
    return {
      Account: [],
      Scenario: [],
      Value: [],
      customer_internal_id: [],
      region_internal_id: [],
      subsidiary_internal_id: []
    };
  }
  
  // Convert customerIds to Set for faster lookup
  const customerIdSet = new Set(customerIds.map(id => Number(id)));
  
  const filtered = {
    Account: [],
    Scenario: [],
    Value: [],
    customer_internal_id: [],
    region_internal_id: [],
    subsidiary_internal_id: []
  };
  
  for (let i = 0; i < data.Account.length; i++) {
    const customerId = Number(data.customer_internal_id[i]);
    if (customerIdSet.has(customerId)) {
      filtered.Account.push(data.Account[i]);
      filtered.Scenario.push(data.Scenario[i]);
      filtered.Value.push(data.Value[i]);
      filtered.customer_internal_id.push(data.customer_internal_id[i]);
      filtered.region_internal_id.push(data.region_internal_id[i]);
      filtered.subsidiary_internal_id.push(data.subsidiary_internal_id[i]);
    }
  }
  
  return filtered;
}

/**
 * Computes account rollups by aggregating child account values into parents
 * Respects displayExcluded and operationalExcluded flags
 * 
 * @param {Object} rawTotals - Raw account totals (no rollups yet)
 * @param {Object} accountConfig - Account configuration (keyed by config ID)
 * @param {Object} childrenMap - Map of parent label -> children labels
 * @param {boolean} isOperational - Whether this is an operational P&L (affects exclusions)
 * @returns {Object} Map of account label -> rolled up total value
 */
function computeRollups(rawTotals, accountConfig, childrenMap, isOperational = false) {
  const totals = {};
  
  // Build a reverse map: label -> config
  const labelToConfig = {};
  for (const configId in accountConfig) {
    const config = accountConfig[configId];
    if (config.label) {
      labelToConfig[config.label] = config;
    }
  }
  
  /**
   * Recursively compute rollup totals for an account and its descendants
   * 
   * CRITICAL: This function computes the ACTUAL VALUE that should appear in reports.
   * It includes ALL children in the rollup, even if displayExcluded = true.
   * 
   * Reasoning:
   * - displayExcluded means "don't show this account as its own row"
   * - It does NOT mean "don't include this account's value in parent totals"
   * - Example: "40000 Revenue" has displayExcluded=true, but its value MUST
   *   roll up into "Income" for accurate reporting
   * 
   * @param {string} acctLabel - Account label to compute
   * @returns {number} Rolled-up total for this account
   */
  function compute(acctLabel) {
    // Already computed (memoization for performance)
    if (totals[acctLabel] != null) {
      return totals[acctLabel];
    }
    
    // Start with this account's direct value from raw data
    let total = rawTotals[acctLabel] || 0;
    
    // Add children's rolled-up values
    // NOTE: We ALWAYS include children in parent rollups, regardless of displayExcluded
    // displayExcluded only affects whether the account is RENDERED, not whether it's included in parent totals
    const children = childrenMap[acctLabel] || [];
    for (const childLabel of children) {
      const childConfig = labelToConfig[childLabel] || {};
      
      // Only exclude from rollup if operationalExcluded (in Operational mode)
      // operationalExcluded is different from displayExcluded:
      // - operationalExcluded: completely exclude from operational P&L calculations
      // - displayExcluded: hide from display but include in calculations
      const shouldExclude = isOperational && childConfig.operationalExcluded;
      
      if (!shouldExclude) {
        total += compute(childLabel);
      } else {
        // Still compute the child (for its own children), but don't add to parent
        compute(childLabel);
      }
    }
    
    totals[acctLabel] = total;
    return total;
  }
  
  // Compute all account labels
  Object.keys(labelToConfig).forEach(compute);
  
  return totals;
}

/**
 * Gets all accounts that should be rendered (not excluded)
 * 
 * @param {Object} accountConfig - Account configuration
 * @param {boolean} isOperational - Whether this is an operational P&L
 * @returns {Set<string>} Set of account labels that should be displayed
 */
function getDisplayableAccounts(accountConfig, isOperational = false) {
  const displayable = new Set();
  
  for (const acctLabel in accountConfig) {
    const cfg = accountConfig[acctLabel] || {};
    const excluded = isOperational 
      ? (cfg.operationalExcluded || cfg.displayExcluded)
      : cfg.displayExcluded;
    
    if (!excluded) {
      displayable.add(acctLabel);
    }
  }
  
  return displayable;
}

module.exports = {
  buildChildrenMap,
  getSectionConfig,
  buildAccountTotals,
  computeRollups,
  getDisplayableAccounts,
  filterDataByCustomers
};

