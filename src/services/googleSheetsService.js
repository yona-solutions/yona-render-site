/**
 * Google Sheets Service Module
 * 
 * Handles reading data from Google Sheets using the service account
 */

const { google } = require('googleapis');

class GoogleSheetsService {
  constructor() {
    this.sheets = null;
    this.auth = null;
    this.initialized = false;
  }

  /**
   * Initialize Google Sheets API with service account credentials
   */
  initialize() {
    try {
      const serviceAccountKey = process.env.GCP_SERVICE_ACCOUNT_KEY;
      
      if (!serviceAccountKey) {
        console.warn('⚠️  Google Sheets not configured (missing GCP_SERVICE_ACCOUNT_KEY)');
        return false;
      }

      // Parse the service account key
      const credentials = JSON.parse(serviceAccountKey);

      // Create auth client
      this.auth = new google.auth.GoogleAuth({
        credentials: credentials,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets.readonly',
          'https://www.googleapis.com/auth/drive.readonly'
        ]
      });

      // Initialize Sheets API
      this.sheets = google.sheets({ version: 'v4', auth: this.auth });
      this.initialized = true;

      console.log('✅ Google Sheets API initialized');
      console.log('   Service Account:', credentials.client_email);

      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Google Sheets API:', error.message);
      return false;
    }
  }

  /**
   * Check if the service is available
   */
  isAvailable() {
    return this.initialized;
  }

  /**
   * Read data from a specific range in a Google Sheet
   * 
   * @param {string} spreadsheetId - The ID of the spreadsheet
   * @param {string} range - The A1 notation range (e.g., 'Sheet1!A1:D10')
   * @returns {Promise<Array<Array>>} 2D array of cell values
   */
  async readRange(spreadsheetId, range) {
    if (!this.isAvailable()) {
      throw new Error('Google Sheets service not initialized');
    }

    try {
      console.log(`📊 Reading from Google Sheet: ${spreadsheetId}`);
      console.log(`   Range: ${range}`);

      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId,
        range
      });

      const rows = response.data.values || [];
      console.log(`✅ Retrieved ${rows.length} rows`);

      return rows;
    } catch (error) {
      console.error('❌ Error reading from Google Sheet:', error.message);
      
      if (error.code === 403) {
        console.error('   Permission denied. Make sure the sheet is shared with:');
        console.error('   yona-render-service@yona-solutions-poc.iam.gserviceaccount.com');
      }
      
      throw error;
    }
  }

  /**
   * Read multiple ranges from a Google Sheet
   * 
   * @param {string} spreadsheetId - The ID of the spreadsheet
   * @param {Array<string>} ranges - Array of A1 notation ranges
   * @returns {Promise<Array<Array<Array>>>} Array of 2D arrays
   */
  async readRanges(spreadsheetId, ranges) {
    if (!this.isAvailable()) {
      throw new Error('Google Sheets service not initialized');
    }

    try {
      console.log(`📊 Reading ${ranges.length} ranges from Google Sheet: ${spreadsheetId}`);

      const response = await this.sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges
      });

      const valueRanges = response.data.valueRanges || [];
      const results = valueRanges.map(vr => vr.values || []);

      console.log(`✅ Retrieved data from ${results.length} ranges`);

      return results;
    } catch (error) {
      console.error('❌ Error reading from Google Sheet:', error.message);
      
      if (error.code === 403) {
        console.error('   Permission denied. Make sure the sheet is shared with:');
        console.error('   yona-render-service@yona-solutions-poc.iam.gserviceaccount.com');
      }
      
      throw error;
    }
  }

  /**
   * Get spreadsheet metadata
   * 
   * @param {string} spreadsheetId - The ID of the spreadsheet
   * @returns {Promise<Object>} Spreadsheet metadata
   */
  async getSpreadsheetInfo(spreadsheetId) {
    if (!this.isAvailable()) {
      throw new Error('Google Sheets service not initialized');
    }

    try {
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId
      });

      return {
        title: response.data.properties.title,
        sheets: response.data.sheets.map(sheet => ({
          title: sheet.properties.title,
          sheetId: sheet.properties.sheetId,
          index: sheet.properties.index,
          rowCount: sheet.properties.gridProperties.rowCount,
          columnCount: sheet.properties.gridProperties.columnCount
        }))
      };
    } catch (error) {
      console.error('❌ Error getting spreadsheet info:', error.message);
      throw error;
    }
  }

  /**
   * Helper: Extract spreadsheet ID from a Google Sheets URL
   * 
   * @param {string} url - Full Google Sheets URL
   * @returns {string} Spreadsheet ID
   */
  extractSpreadsheetId(url) {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
  }

  /**
   * Helper: Convert 2D array to array of objects (using first row as headers)
   * 
   * @param {Array<Array>} rows - 2D array from sheet
   * @returns {Array<Object>} Array of objects
   */
  rowsToObjects(rows) {
    if (rows.length === 0) return [];
    
    const headers = rows[0];
    return rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] || '';
      });
      return obj;
    });
  }
}

// Create singleton instance
const googleSheetsService = new GoogleSheetsService();

module.exports = googleSheetsService;
