/**
 * Fivetran Service Module
 *
 * Handles interactions with the Fivetran API for connector management and sync operations.
 *
 * @module services/fivetranService
 */

const FIVETRAN_API_BASE = 'https://api.fivetran.com/v1';

// Connector and transformation IDs
const CONNECTORS = [
  { id: 'plaster_bang', schema: 'netsuite_accounts' },
  { id: 'conventional_industrious', schema: 'netsuite_connector_main' }
];
const TRANSFORMATION_ID = 'justness_luminous';

class FivetranService {
  constructor() {
    this.apiKey = process.env.FIVETRAN_API_KEY;
    this.apiSecret = process.env.FIVETRAN_API_SECRET;
  }

  isConfigured() {
    return !!(this.apiKey && this.apiSecret);
  }

  getAuthHeader() {
    const credentials = Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64');
    return `Basic ${credentials}`;
  }

  async apiRequest(endpoint, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('Fivetran API credentials not configured');
    }

    const url = `${FIVETRAN_API_BASE}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': this.getAuthHeader(),
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMessage = data.message || data.error || `API error: ${response.status}`;
      throw new Error(errorMessage);
    }

    return data;
  }

  async getConnector(connectorId) {
    const response = await this.apiRequest(`/connectors/${connectorId}`);
    return response.data;
  }

  async getConnectorState(connectorId) {
    const connector = await this.getConnector(connectorId);
    return {
      id: connector.id,
      name: connector.schema,
      service: connector.service,
      status: connector.status,
      succeeded_at: connector.succeeded_at,
      failed_at: connector.failed_at,
      sync_state: connector.sync_state,
      paused: connector.paused,
      schedule_type: connector.schedule_type
    };
  }

  async triggerSync(connectorId) {
    const response = await this.apiRequest(`/connectors/${connectorId}/sync`, {
      method: 'POST',
      body: JSON.stringify({ force: true })
    });
    return response.data;
  }

  /**
   * Trigger sync for all configured connectors
   * @returns {Promise<object[]>}
   */
  async triggerSyncAll() {
    const results = await Promise.all(
      CONNECTORS.map(async ({ id, schema }) => {
        try {
          await this.triggerSync(id);
          return { id, schema, success: true };
        } catch (error) {
          return { id, schema, success: false, error: error.message };
        }
      })
    );
    return results;
  }

  /**
   * Get transformation status
   * @returns {Promise<object>}
   */
  async getTransformationStatus() {
    const response = await this.apiRequest(`/transformations/${TRANSFORMATION_ID}`);
    return response.data;
  }

  /**
   * Get full pipeline status: connectors + transformation
   * @returns {Promise<object>}
   */
  async getPipelineStatus() {
    const [connectorResults, transformation] = await Promise.all([
      Promise.all(
        CONNECTORS.map(async ({ id }) => {
          try {
            return await this.getConnectorState(id);
          } catch (error) {
            return { id, error: error.message };
          }
        })
      ),
      this.getTransformationStatus().catch(error => ({ error: error.message }))
    ]);

    return {
      connectors: connectorResults,
      transformation
    };
  }

  getConnectorIds() {
    return CONNECTORS;
  }
}

module.exports = new FivetranService();
