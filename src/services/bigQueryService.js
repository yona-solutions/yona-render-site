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
   * @param {Object} params - Query parameters
   * @param {string} params.hierarchy - Hierarchy level (district, region, subsidiary)
   * @param {Array<number>} params.customerIds - Customer IDs (for district hierarchy)
   * @param {number} params.regionId - Region internal ID (for region hierarchy)
   * @param {number} params.subsidiaryId - Subsidiary internal ID (for subsidiary hierarchy)
   * @param {string} params.date - Date in YYYY-MM-DD format
   * @returns {Promise<Array>} P&L data rows
   * @throws {Error} If BigQuery is not initialized or query fails
   */
  async getPLData(params) {
    if (!this.isAvailable()) {
      throw new Error('BigQuery not initialized');
    }

    const { hierarchy, customerIds, regionId, subsidiaryId, date } = params;

    // Build the WHERE clause based on hierarchy type
    let whereClause = '';
    let queryParams = {};

    if (hierarchy === 'district' && customerIds && customerIds.length > 0) {
      whereClause = 'customer_internal_id IN UNNEST(@customerIds)';
      queryParams.customerIds = customerIds;
    } else if (hierarchy === 'region' && regionId) {
      whereClause = 'region_internal_id = @regionId';
      queryParams.regionId = regionId;
    } else if (hierarchy === 'subsidiary' && subsidiaryId) {
      whereClause = 'subsidiary_internal_id = @subsidiaryId';
      queryParams.subsidiaryId = subsidiaryId;
    } else {
      throw new Error(`Invalid hierarchy parameters: ${hierarchy}`);
    }

    const query = `
      WITH base AS (
        SELECT
          account_internal_id,
          customer_internal_id,
          region_internal_id,
          subsidiary_internal_id,
          scenario,
          value
        FROM \`${this.dataset}.fct_transactions_summary\`
        WHERE time_date = @date
          AND ${whereClause}
      )
      SELECT
        account_internal_id,
        customer_internal_id,
        region_internal_id,
        subsidiary_internal_id,
        scenario,
        SUM(value) AS value
      FROM base
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

    try {
      const [rows] = await this.bigquery.query({
        query: query,
        location: 'US',
        params: {
          ...queryParams,
          date: date
        }
      });

      console.log(`✅ Retrieved ${rows.length} rows from BigQuery for ${hierarchy}`);
      return rows;
    } catch (error) {
      console.error('Error fetching P&L data:', error);
      throw new Error(`Failed to fetch P&L data from BigQuery: ${error.message}`);
    }
  }
}

module.exports = BigQueryService;

