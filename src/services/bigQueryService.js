/**
 * BigQuery Service
 * 
 * Provides business logic for interacting with Google BigQuery.
 * Handles querying transaction data, P&L reports, and date filters.
 * 
 * @module services/bigQueryService
 */

/**
 * BigQuery Service Class
 * 
 * Encapsulates all BigQuery operations for the application.
 */
class BigQueryService {
  /**
   * @param {BigQuery} bigquery - GCP BigQuery client instance
   */
  constructor(bigquery) {
    this.bigquery = bigquery;
    this.dataset = 'dbt_production';
  }

  /**
   * Check if BigQuery is initialized
   * 
   * @returns {boolean} True if BigQuery is available
   */
  isAvailable() {
    return this.bigquery !== null && this.bigquery !== undefined;
  }

  /**
   * Get available dates for the date filter
   * 
   * Fetches distinct month dates from the transactions summary table
   * that are before the current month, ordered by date descending.
   * 
   * @returns {Promise<Array<{time: string, formatted: string}>>} Array of available dates
   * @throws {Error} If BigQuery is not initialized or query fails
   */
  async getAvailableDates() {
    if (!this.isAvailable()) {
      throw new Error('BigQuery not initialized');
    }

    const query = `
      SELECT DISTINCT TIME_DATE AS TIME
      FROM \`${this.dataset}.fct_transactions_summary\`
      WHERE TIME_DATE < DATE_TRUNC(CURRENT_DATE(), MONTH)
      ORDER BY TIME_DATE DESC
    `;

    try {
      const [rows] = await this.bigquery.query({
        query: query,
        location: 'US', // Adjust if your dataset is in a different location
      });

      // Transform the results to include formatted date strings
      return rows.map(row => ({
        time: row.TIME.value, // BigQuery returns DATE as object with value property
        formatted: this.formatDate(row.TIME.value)
      }));
    } catch (error) {
      console.error('Error fetching available dates:', error);
      throw new Error(`Failed to fetch dates from BigQuery: ${error.message}`);
    }
  }

  /**
   * Format a date string for display
   * 
   * @param {string} dateString - Date string from BigQuery (YYYY-MM-DD)
   * @returns {string} Formatted date (YYYY-MM-DD)
   * @private
   */
  formatDate(dateString) {
    // BigQuery returns dates as strings in YYYY-MM-DD format
    // Keep the same format for consistency with the UI
    return dateString;
  }

  /**
   * Get P&L data for a specific hierarchy and period
   * 
   * Queries fct_transactions_summary based on hierarchy type:
   * - District: Filters by customer_internal_id (includes all customers under district/tag)
   * - Region: Filters by region_internal_id
   * - Subsidiary: Filters by subsidiary_internal_id
   * 
   * Returns data in array format suitable for P&L rendering:
   * { Account: [...], Scenario: [...], Value: [...], customer_internal_id: [...], ... }
   * 
   * @param {Object} params - Query parameters
   * @param {string} params.hierarchy - Hierarchy level (district, region, subsidiary)
   * @param {Array<number>} params.customerIds - Customer IDs (for district hierarchy)
   * @param {number} params.regionId - Region internal ID (for region hierarchy)
   * @param {number} params.subsidiaryId - Subsidiary internal ID (for subsidiary hierarchy)
   * @param {string} params.date - Date in YYYY-MM-DD format
   * @param {Object} params.accountConfig - Account configuration for label mapping
   * @param {boolean} params.ytd - If true, query YTD (from start of year to date), otherwise just the month
   * @returns {Promise<Object>} P&L data in array format
   * @throws {Error} If BigQuery is not initialized or query fails
   */
  async getPLData(params) {
    if (!this.isAvailable()) {
      throw new Error('BigQuery not initialized');
    }

    const { hierarchy, customerIds, regionId, subsidiaryId, date, accountConfig, ytd = false } = params;

    // Build the WHERE clause based on hierarchy type
    let whereClause = '';
    let queryParams = {};

    if (hierarchy === 'district' && customerIds && customerIds.length > 0) {
      whereClause = 'customer_internal_id IN UNNEST(@customerIds)';
      queryParams.customerIds = customerIds;
    } else if (hierarchy === 'region' && regionId) {
      // Region filtering - can optionally include subsidiary filter
      whereClause = 'region_internal_id = @regionId';
      queryParams.regionId = regionId;
      
      // Add subsidiary filter if provided (region + subsidiary combination)
      if (subsidiaryId) {
        whereClause += ' AND subsidiary_internal_id = @subsidiaryId';
        queryParams.subsidiaryId = subsidiaryId;
      }
    } else if (hierarchy === 'subsidiary' && subsidiaryId) {
      whereClause = 'subsidiary_internal_id = @subsidiaryId';
      queryParams.subsidiaryId = subsidiaryId;
    } else {
      throw new Error(`Invalid hierarchy parameters: ${hierarchy}`);
    }

    // Build date filter based on YTD flag
    // YTD (Year-to-Date): Sum all transactions from Jan 1 through the selected month
    // Month: Only transactions for the selected month
    const dateFilter = ytd 
      ? 'time_date <= @date AND time_date >= DATE_TRUNC(@date, YEAR)'  // e.g., 2025-01-01 through 2025-08-01
      : 'time_date = @date';  // e.g., only 2025-08-01

    const query = `
      SELECT
        account_internal_id,
        customer_internal_id,
        region_internal_id,
        subsidiary_internal_id,
        scenario,
        SUM(value) AS value
      FROM \`${this.dataset}.fct_transactions_summary\`
      WHERE ${dateFilter}
        AND ${whereClause}
      GROUP BY
        account_internal_id,
        customer_internal_id,
        region_internal_id,
        subsidiary_internal_id,
        scenario
      ORDER BY
        account_internal_id,
        scenario
    `;

    // Log the query and parameters
    console.log(`\n📊 BigQuery P&L Query (${ytd ? 'YTD' : 'Month'}):`);
    console.log('Query:', query);
    console.log('Parameters:', {
      ...queryParams,
      date: date,
      ytd: ytd
    });

    try {
      const [rows] = await this.bigquery.query({
        query: query,
        location: 'US',
        params: {
          ...queryParams,
          date: date
        }
      });

      console.log(`✅ Retrieved ${rows.length} rows from BigQuery for ${hierarchy} (${ytd ? 'YTD' : 'Month'})`);
      
      // Transform to array format with account labels
      const result = this.transformToArrayFormat(rows, accountConfig);
      
      console.log(`✅ Transformed to array format (${ytd ? 'YTD' : 'Month'}): ${result.Account.length} entries`);
      if (result.Account.length > 0) {
        console.log('Sample entry:', {
          Account: result.Account[0],
          Scenario: result.Scenario[0],
          Value: result.Value[0]
        });
      }
      
      return result;
    } catch (error) {
      console.error('Error fetching P&L data:', error);
      throw new Error(`Failed to fetch P&L data from BigQuery: ${error.message}`);
    }
  }

  /**
   * Transform BigQuery rows to array format for P&L rendering
   * 
   * Converts from array of objects to object of arrays, and maps
   * account_internal_id to account labels using accountConfig
   * 
   * @param {Array} rows - BigQuery result rows
   * @param {Object} accountConfig - Account configuration for label mapping
   * @returns {Object} Data in array format
   * @private
   */
  transformToArrayFormat(rows, accountConfig) {
    // Build reverse mapping: account_internal_id -> label
    const accountIdToLabel = {};
    for (const configId in accountConfig) {
      const config = accountConfig[configId];
      const id = config?.account_internal_id;
      if (id != null) {
        accountIdToLabel[id] = config.label;  // Map to the actual label, not config ID
      }
    }

    const result = {
      Account: [],
      Scenario: [],
      Value: [],
      customer_internal_id: [],
      region_internal_id: [],
      subsidiary_internal_id: []
    };

    for (const row of rows) {
      const accountLabel = accountIdToLabel[row.account_internal_id] || `Unknown Account ${row.account_internal_id}`;
      
      result.Account.push(accountLabel);
      result.Scenario.push(row.scenario);
      result.Value.push(row.value);
      result.customer_internal_id.push(row.customer_internal_id);
      result.region_internal_id.push(row.region_internal_id);
      result.subsidiary_internal_id.push(row.subsidiary_internal_id);
    }

    return result;
  }

  /**
   * Get customers in a region from dim_customers table
   * 
   * Queries the dimension table to find all customers that belong to a specific region.
   * Optionally filters by subsidiary as well.
   * Returns customer details including customer_id (internal ID), display_name, and other metadata.
   * 
   * @param {number} regionInternalId - Region internal ID
   * @param {number} subsidiaryInternalId - Optional subsidiary internal ID to filter by
   * @returns {Promise<Array<Object>>} Array of customer objects with {customer_id, display_name, customer_code, start_date_est}
   * @throws {Error} If BigQuery is not initialized or query fails
   */
  async getCustomersInRegion(regionInternalId, subsidiaryInternalId = null) {
    if (!this.isAvailable()) {
      throw new Error('BigQuery not initialized');
    }

    // Build WHERE clause based on whether subsidiary filter is provided
    let whereClause = 'region_internal_id = @regionInternalId';
    const params = { regionInternalId: regionInternalId };
    
    if (subsidiaryInternalId) {
      whereClause += ' AND subsidiary_internal_id = @subsidiaryInternalId';
      params.subsidiaryInternalId = subsidiaryInternalId;
    }

    const query = `
      SELECT
        customer_id,
        customer_code,
        display_name,
        start_date_est,
        region_internal_id,
        subsidiary_internal_id
      FROM \`yona-solutions-poc.${this.dataset}.dim_customers\`
      WHERE ${whereClause}
      ORDER BY customer_id
    `;

    const filterDesc = subsidiaryInternalId 
      ? `region_internal_id=${regionInternalId} AND subsidiary_internal_id=${subsidiaryInternalId}`
      : `region_internal_id=${regionInternalId}`;
    console.log(`\n🔍 Querying dim_customers for ${filterDesc}`);

    try {
      const [rows] = await this.bigquery.query({
        query: query,
        location: 'US',
        params: params
      });

      console.log(`✅ Found ${rows.length} customers matching filter`);
      
      return rows.map(row => ({
        customer_internal_id: row.customer_id,
        customer_code: row.customer_code,
        label: row.display_name,
        start_date_est: row.start_date_est ? row.start_date_est.value : null,
        region_internal_id: row.region_internal_id,
        subsidiary_internal_id: row.subsidiary_internal_id
      }));
    } catch (error) {
      console.error('Error fetching customers from dim_customers:', error);
      throw new Error(`Failed to fetch customers from BigQuery: ${error.message}`);
    }
  }

  /**
   * Get all customers in a subsidiary (with optional region filter)
   * @param {number} subsidiaryInternalId - The subsidiary_internal_id to filter by
   * @param {number|null} regionInternalId - Optional region_internal_id to further filter
   * @returns {Promise<Array>} Array of customer objects
   */
  async getCustomersInSubsidiary(subsidiaryInternalId, regionInternalId = null) {
    if (!this.isAvailable()) {
      throw new Error('BigQuery not initialized');
    }

    // Build WHERE clause based on whether region filter is provided
    let whereClause = 'subsidiary_internal_id = @subsidiaryInternalId';
    const params = { subsidiaryInternalId: subsidiaryInternalId };
    
    if (regionInternalId) {
      whereClause += ' AND region_internal_id = @regionInternalId';
      params.regionInternalId = regionInternalId;
    }

    const query = `
      SELECT
        customer_id,
        customer_code,
        display_name,
        start_date_est,
        region_internal_id,
        subsidiary_internal_id
      FROM \`yona-solutions-poc.${this.dataset}.dim_customers\`
      WHERE ${whereClause}
      ORDER BY customer_id
    `;

    const filterDesc = regionInternalId 
      ? `subsidiary_internal_id=${subsidiaryInternalId} AND region_internal_id=${regionInternalId}`
      : `subsidiary_internal_id=${subsidiaryInternalId}`;
    console.log(`\n🔍 Querying dim_customers for ${filterDesc}`);

    try {
      const [rows] = await this.bigquery.query({
        query: query,
        location: 'US',
        params: params
      });

      console.log(`✅ Found ${rows.length} customers matching filter`);
      
      return rows.map(row => ({
        customer_internal_id: row.customer_id,
        customer_code: row.customer_code,
        label: row.display_name,
        start_date_est: row.start_date_est ? row.start_date_est.value : null,
        region_internal_id: row.region_internal_id,
        subsidiary_internal_id: row.subsidiary_internal_id
      }));
    } catch (error) {
      console.error('Error fetching customers from dim_customers:', error);
      throw new Error(`Failed to fetch customers from BigQuery: ${error.message}`);
    }
  }
  /**
   * Get all accounts from dim_accounts table
   * 
   * Fetches all accounts with their IDs and display names
   * for populating account mapping dropdowns.
   * 
   * @returns {Promise<Array<{account_id: number, display_name: string, display_name_with_id: string}>>} Array of accounts
   * @throws {Error} If BigQuery is not initialized or query fails
   */
  async getAccounts() {
    if (!this.isAvailable()) {
      throw new Error('BigQuery not initialized');
    }

    const query = `
      SELECT
        account_id,
        display_name,
        display_name_with_id
      FROM \`${this.dataset}.dim_accounts\`
      ORDER BY display_name
    `;

    try {
      const [rows] = await this.bigquery.query({
        query: query,
        location: 'US'
      });
      
      return rows.map(row => ({
        account_id: row.account_id,
        display_name: row.display_name,
        display_name_with_id: row.display_name_with_id
      }));
    } catch (error) {
      console.error('Error fetching accounts from BigQuery:', error);
      throw new Error(`Failed to fetch accounts: ${error.message}`);
    }
  }
}

module.exports = BigQueryService;

