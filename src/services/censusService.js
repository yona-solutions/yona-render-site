/**
 * Census Service Module
 * 
 * Handles fetching and caching census data from Google Sheets
 * Census data is joined with customer codes to display in P&L reports
 */

const googleSheetsService = require('./googleSheetsService');

class CensusService {
  constructor() {
    this.censusData = null;
    this.lastFetch = null;
    this.cacheExpiry = 0; // No caching - always fetch fresh data
    this.spreadsheetId = '1P4uAVda140WUwGf6L5-oJqklhqHhWGUJ3XPawYa4GpE';
    this.sheetRange = 'census_flattened_safe!A:F';
  }

  /**
   * Fetch census data from Google Sheets
   * Always fetches fresh data (no caching) for immediate updates
   * 
   * @param {boolean} forceRefresh - Force refresh even if cache is valid (unused, kept for compatibility)
   * @returns {Promise<Array<Object>>} Array of census records
   */
  async fetchCensusData(forceRefresh = false) {
    // No caching - always fetch fresh data from Google Sheets

    try {
      console.log('📊 Fetching census data from Google Sheets...');
      
      if (!googleSheetsService.isAvailable()) {
        console.warn('⚠️  Google Sheets service not available');
        return [];
      }

      const rows = await googleSheetsService.readRange(this.spreadsheetId, this.sheetRange);
      
      if (rows.length === 0) {
        console.warn('⚠️  No census data found in sheet');
        return [];
      }

      // Convert to objects using first row as headers
      const censusRecords = googleSheetsService.rowsToObjects(rows);
      
      // Parse and normalize the data
      this.censusData = censusRecords.map(record => ({
        type: record.type?.trim(), // 'Actuals' or 'Budget'
        customerCode: record.customer_code?.trim(),
        month: this.parseMonth(record.month),
        value: parseFloat(record.value) || 0,
        customerName: record.customer_name?.trim(),
        displayMonth: record.display_month?.trim()
      })).filter(r => r.customerCode && r.month); // Filter out invalid rows

      this.lastFetch = Date.now();
      
      console.log(`✅ Loaded ${this.censusData.length} census records`);
      console.log(`   Types: ${[...new Set(this.censusData.map(r => r.type))].join(', ')}`);
      console.log(`   Customers: ${new Set(this.censusData.map(r => r.customerCode)).size}`);
      
      return this.censusData;
    } catch (error) {
      console.error('❌ Error fetching census data:', error.message);
      
      if (error.code === 403) {
        console.error('   Make sure the sheet is shared with: yona-render-service@yona-solutions-poc.iam.gserviceaccount.com');
      }
      
      // Return empty array on error, don't break the P&L generation
      return [];
    }
  }

  /**
   * Parse month string to YYYY-MM-DD format
   * Handles formats like "1/1/2025" or "2025-01-01"
   * 
   * @param {string} monthStr - Month string from sheet
   * @returns {string} Formatted as YYYY-MM-DD (first day of month)
   */
  parseMonth(monthStr) {
    if (!monthStr) return null;

    try {
      const date = new Date(monthStr);
      if (isNaN(date.getTime())) return null;

      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      return `${year}-${month}-01`;
    } catch (error) {
      console.warn(`Warning: Could not parse month: ${monthStr}`);
      return null;
    }
  }

  /**
   * Get census data for a specific customer code and month
   * 
   * @param {string} customerCode - Customer code from dim_customers
   * @param {string} month - Month in YYYY-MM-DD format
   * @returns {Promise<Object>} { actual: number, budget: number }
   */
  async getCensusForCustomer(customerCode, month) {
    const censusData = await this.fetchCensusData();

    // Normalize month to YYYY-MM-01 format
    const normalizedMonth = month.substring(0, 7) + '-01';

    const actual = censusData.find(r => 
      r.customerCode === customerCode && 
      r.month === normalizedMonth && 
      r.type === 'Actuals'
    );

    const budget = censusData.find(r => 
      r.customerCode === customerCode && 
      r.month === normalizedMonth && 
      r.type === 'Budget'
    );

    return {
      actual: actual?.value || null,
      budget: budget?.value || null
    };
  }

  /**
   * Get census data for multiple customers (for rollup/summary reports)
   * 
   * @param {Array<string>} customerCodes - Array of customer codes
   * @param {string} month - Month in YYYY-MM-DD format
   * @returns {Promise<Object>} { actual: number, budget: number } - Aggregated totals
   */
  async getCensusForCustomers(customerCodes, month) {
    const censusData = await this.fetchCensusData();

    // Normalize month to YYYY-MM-01 format
    const normalizedMonth = month.substring(0, 7) + '-01';

    let actualTotal = 0;
    let budgetTotal = 0;
    let actualCount = 0;
    let budgetCount = 0;

    for (const customerCode of customerCodes) {
      const actual = censusData.find(r => 
        r.customerCode === customerCode && 
        r.month === normalizedMonth && 
        r.type === 'Actuals'
      );

      const budget = censusData.find(r => 
        r.customerCode === customerCode && 
        r.month === normalizedMonth && 
        r.type === 'Budget'
      );

      if (actual?.value) {
        actualTotal += actual.value;
        actualCount++;
      }

      if (budget?.value) {
        budgetTotal += budget.value;
        budgetCount++;
      }
    }

    return {
      actual: actualCount > 0 ? actualTotal : null,
      budget: budgetCount > 0 ? budgetTotal : null,
      actualCount,
      budgetCount
    };
  }

  /**
   * Clear the cache to force fresh data on next request
   */
  clearCache() {
    this.censusData = null;
    this.lastFetch = null;
    console.log('🗑️  Census cache cleared');
  }

  /**
   * Check if service is available
   */
  isAvailable() {
    return googleSheetsService.isAvailable();
  }
}

// Create singleton instance
const censusService = new CensusService();

module.exports = censusService;
