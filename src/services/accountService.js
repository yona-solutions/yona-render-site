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
 * Builds a map of parent account IDs to their children
 * 
 * @param {Object} accountConfig - The account configuration object
 * @returns {Object} Map of parentId -> [childId, childId, ...]
 */
function buildChildrenMap(accountConfig) {
  const childrenMap = {};
  
  for (const acctId in accountConfig) {
    const parent = accountConfig[acctId]?.parent;
    if (parent) {
      if (!childrenMap[parent]) {
        childrenMap[parent] = [];
      }
      childrenMap[parent].push(acctId);
    }
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
 * Computes account rollups by aggregating child account values into parents
 * Respects displayExcluded and operationalExcluded flags
 * 
 * @param {Object} rawTotals - Raw account totals (no rollups yet)
 * @param {Object} accountConfig - Account configuration
 * @param {Object} childrenMap - Map of parent -> children
 * @param {boolean} isOperational - Whether this is an operational P&L (affects exclusions)
 * @returns {Object} Map of account label -> rolled up total value
 */
function computeRollups(rawTotals, accountConfig, childrenMap, isOperational = false) {
  const totals = {};
  
  function compute(acctLabel) {
    // Already computed
    if (totals[acctLabel] != null) {
      return totals[acctLabel];
    }
    
    // Start with this account's direct value
    let total = rawTotals[acctLabel] || 0;
    
    // Add children's rolled-up values
    const children = childrenMap[acctLabel] || [];
    for (const childLabel of children) {
      const childConfig = accountConfig[childLabel] || {};
      
      // Determine if we should exclude this child from rollup
      const shouldExclude = isOperational 
        ? (childConfig.operationalExcluded || childConfig.displayExcluded)
        : childConfig.displayExcluded;
      
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
  
  // Compute all accounts
  Object.keys(accountConfig).forEach(compute);
  
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
  getDisplayableAccounts
};

