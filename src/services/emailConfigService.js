/**
 * Email Configuration Service
 * 
 * Handles database operations for email groups and report schedules.
 * Uses PostgreSQL with connection pooling for optimal performance.
 */

const { Pool } = require('pg');

class EmailConfigService {
  constructor() {
    this.pool = null;
    this.isInitialized = false;
  }

  /**
   * Initialize database connection pool
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      const connectionConfig = {
        connectionString: process.env.DATABASE_URL,
        // SSL required for Render PostgreSQL in production
        ssl: process.env.NODE_ENV === 'production' 
          ? { rejectUnauthorized: false } 
          : false,
        // Connection pool settings
        max: 20, // Maximum number of clients
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      };

      this.pool = new Pool(connectionConfig);

      // Test connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();

      this.isInitialized = true;
      console.log('✅ Email Config Database initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Email Config Database:', error);
      throw error;
    }
  }

  /**
   * Check if service is available
   */
  isAvailable() {
    return this.isInitialized && this.pool !== null;
  }

  /**
   * Close database connection pool
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      this.isInitialized = false;
      console.log('🔌 Email Config Database connection closed');
    }
  }

  // ============================================
  // Email Groups
  // ============================================

  /**
   * Get all email groups with contact count
   */
  async getEmailGroups() {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = `
      SELECT 
        eg.*,
        COUNT(egc.id) as email_count
      FROM email_groups eg
      LEFT JOIN email_group_contacts egc ON eg.id = egc.email_group_id
      GROUP BY eg.id
      ORDER BY eg.created_at DESC
    `;

    const result = await this.pool.query(query);
    return result.rows;
  }

  /**
   * Get a single email group by ID
   */
  async getEmailGroup(id) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = `
      SELECT 
        eg.*,
        COUNT(egc.id) as email_count
      FROM email_groups eg
      LEFT JOIN email_group_contacts egc ON eg.id = egc.email_group_id
      WHERE eg.id = $1
      GROUP BY eg.id
    `;

    const result = await this.pool.query(query, [id]);
    return result.rows[0] || null;
  }

  /**
   * Get contacts for an email group
   */
  async getEmailGroupContacts(groupId) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = `
      SELECT id, email, name, created_at
      FROM email_group_contacts
      WHERE email_group_id = $1
      ORDER BY created_at ASC
    `;

    const result = await this.pool.query(query, [groupId]);
    return result.rows;
  }

  /**
   * Create a new email group with contacts
   */
  async createEmailGroup(data) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const { name, description, emails } = data;
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Insert email group
      const groupQuery = `
        INSERT INTO email_groups (name, description)
        VALUES ($1, $2)
        RETURNING *
      `;
      const groupResult = await client.query(groupQuery, [name, description || null]);
      const group = groupResult.rows[0];

      // Insert contacts
      if (emails && emails.length > 0) {
        const contactQuery = `
          INSERT INTO email_group_contacts (email_group_id, email)
          VALUES ($1, $2)
        `;

        for (const email of emails) {
          await client.query(contactQuery, [group.id, email]);
        }
      }

      await client.query('COMMIT');
      return group;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update an email group and its contacts
   */
  async updateEmailGroup(id, data) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const { name, description, emails } = data;
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Update email group
      const groupQuery = `
        UPDATE email_groups
        SET name = $1, description = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING *
      `;
      const groupResult = await client.query(groupQuery, [name, description || null, id]);
      
      if (groupResult.rows.length === 0) {
        throw new Error('Email group not found');
      }

      const group = groupResult.rows[0];

      // Update contacts if provided
      if (emails) {
        // Delete existing contacts
        await client.query('DELETE FROM email_group_contacts WHERE email_group_id = $1', [id]);

        // Insert new contacts
        if (emails.length > 0) {
          const contactQuery = `
            INSERT INTO email_group_contacts (email_group_id, email)
            VALUES ($1, $2)
          `;

          for (const email of emails) {
            await client.query(contactQuery, [id, email]);
          }
        }
      }

      await client.query('COMMIT');
      return group;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete an email group
   * Note: Contacts are automatically deleted via CASCADE
   */
  async deleteEmailGroup(id) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = 'DELETE FROM email_groups WHERE id = $1 RETURNING *';
    const result = await this.pool.query(query, [id]);

    if (result.rows.length === 0) {
      throw new Error('Email group not found');
    }

    return result.rows[0];
  }

  // ============================================
  // Report Schedules
  // ============================================

  /**
   * Get all report schedules with email group info
   */
  async getReportSchedules() {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = `
      SELECT 
        rs.*,
        eg.name as email_group_name
      FROM report_schedules rs
      LEFT JOIN email_groups eg ON rs.email_group_id = eg.id
      ORDER BY rs.created_at DESC
    `;

    const result = await this.pool.query(query);
    return result.rows;
  }

  /**
   * Get a single report schedule by ID
   */
  async getReportSchedule(id) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = `
      SELECT 
        rs.*,
        eg.name as email_group_name
      FROM report_schedules rs
      LEFT JOIN email_groups eg ON rs.email_group_id = eg.id
      WHERE rs.id = $1
    `;

    const result = await this.pool.query(query, [id]);
    return result.rows[0] || null;
  }

  /**
   * Get active schedules that need to be sent
   */
  async getSchedulesDueForSend() {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = `
      SELECT 
        rs.*,
        eg.name as email_group_name
      FROM report_schedules rs
      LEFT JOIN email_groups eg ON rs.email_group_id = eg.id
      WHERE rs.status = 'active'
        AND (rs.next_send_at IS NULL OR rs.next_send_at <= CURRENT_TIMESTAMP)
      ORDER BY rs.next_send_at ASC NULLS FIRST
    `;

    const result = await this.pool.query(query);
    return result.rows;
  }

  /**
   * Create a new report schedule
   */
  async createReportSchedule(data) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const {
      report_type,
      hierarchy,
      entity_id,
      entity_name,
      email_group_id,
      frequency,
      status = 'active'
    } = data;

    const query = `
      INSERT INTO report_schedules (
        report_type, hierarchy, entity_id, entity_name,
        email_group_id, frequency, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const result = await this.pool.query(query, [
      report_type,
      hierarchy,
      entity_id,
      entity_name || null,
      email_group_id,
      frequency,
      status
    ]);

    return result.rows[0];
  }

  /**
   * Update a report schedule
   */
  async updateReportSchedule(id, data) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const {
      report_type,
      hierarchy,
      entity_id,
      entity_name,
      email_group_id,
      frequency,
      status
    } = data;

    const query = `
      UPDATE report_schedules
      SET 
        report_type = $1,
        hierarchy = $2,
        entity_id = $3,
        entity_name = $4,
        email_group_id = $5,
        frequency = $6,
        status = $7,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $8
      RETURNING *
    `;

    const result = await this.pool.query(query, [
      report_type,
      hierarchy,
      entity_id,
      entity_name || null,
      email_group_id,
      frequency,
      status,
      id
    ]);

    if (result.rows.length === 0) {
      throw new Error('Report schedule not found');
    }

    return result.rows[0];
  }

  /**
   * Update schedule send timestamps
   */
  async updateScheduleSendTimestamps(id, lastSentAt, nextSendAt) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = `
      UPDATE report_schedules
      SET 
        last_sent_at = $1,
        next_send_at = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `;

    const result = await this.pool.query(query, [lastSentAt, nextSendAt, id]);
    return result.rows[0];
  }

  /**
   * Delete a report schedule
   */
  async deleteReportSchedule(id) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = 'DELETE FROM report_schedules WHERE id = $1 RETURNING *';
    const result = await this.pool.query(query, [id]);

    if (result.rows.length === 0) {
      throw new Error('Report schedule not found');
    }

    return result.rows[0];
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Run a health check query
   */
  async healthCheck() {
    if (!this.isAvailable()) {
      return { healthy: false, error: 'Database not initialized' };
    }

    try {
      const result = await this.pool.query('SELECT NOW() as timestamp');
      return {
        healthy: true,
        timestamp: result.rows[0].timestamp,
        poolSize: this.pool.totalCount,
        idleConnections: this.pool.idleCount,
        waitingRequests: this.pool.waitingCount
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message
      };
    }
  }
}

// Export singleton instance
module.exports = new EmailConfigService();

