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
   * TODO: Implement full P&L query
   * 
   * @param {Object} params - Query parameters
   * @param {string} params.hierarchy - Hierarchy level (district, region, subsidiary)
   * @param {string} params.id - ID of the entity
   * @param {string} params.month - Month in YYYY-MM-DD format
   * @param {string} params.type - P&L type (standard, operational)
   * @returns {Promise<Object>} P&L data
   * @throws {Error} If BigQuery is not initialized or query fails
   */
  async getPLData(params) {
    if (!this.isAvailable()) {
      throw new Error('BigQuery not initialized');
    }

    // TODO: Implement the actual P&L query
    throw new Error('P&L data query not yet implemented');
  }
}

module.exports = BigQueryService;

