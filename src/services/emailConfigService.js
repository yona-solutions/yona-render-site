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
        // SSL required for Render PostgreSQL (both production and development)
        // Render databases always require SSL connections
        ssl: { rejectUnauthorized: false },
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
      template_name,
      template_type,
      process,
      district_id,
      district_name,
      region_id,
      region_name,
      subsidiary_id,
      subsidiary_name,
      email_group_id,
      email_group_ids,
      frequency,
      day_of_week,
      day_of_month,
      time_of_day,
      enabled = true,
      // Legacy support
      report_type,
      hierarchy,
      entity_id,
      entity_name,
      status
    } = data;

    // Map legacy fields to new fields if provided
    const finalTemplateName = template_name || `${hierarchy || template_type} ${report_type || process} Report`;
    const finalTemplateType = template_type || hierarchy;
    const finalProcess = process || report_type;
    const finalEnabled = enabled !== undefined ? enabled : (status === 'active');

    const query = `
      INSERT INTO report_schedules (
        template_name, template_type, process,
        district_id, district_name, region_id, region_name,
        subsidiary_id, subsidiary_name,
        email_group_id, email_group_ids, frequency,
        day_of_week, day_of_month, time_of_day, enabled
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `;

    const result = await this.pool.query(query, [
      finalTemplateName,
      finalTemplateType,
      finalProcess,
      district_id || (finalTemplateType === 'district' ? entity_id : null),
      district_name || (finalTemplateType === 'district' ? entity_name : null),
      region_id || (finalTemplateType === 'region' ? entity_id : null),
      region_name || (finalTemplateType === 'region' ? entity_name : null),
      subsidiary_id || (finalTemplateType === 'subsidiary' ? entity_id : null),
      subsidiary_name || (finalTemplateType === 'subsidiary' ? entity_name : null),
      email_group_id || null,
      email_group_ids || null,
      frequency,
      day_of_week || null,
      day_of_month || null,
      time_of_day || '08:00:00',
      finalEnabled
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
      template_name,
      template_type,
      process,
      district_id,
      district_name,
      region_id,
      region_name,
      subsidiary_id,
      subsidiary_name,
      email_group_id,
      email_group_ids,
      frequency,
      day_of_week,
      day_of_month,
      time_of_day,
      enabled,
      // Legacy support
      report_type,
      hierarchy,
      entity_id,
      entity_name,
      status
    } = data;

    // Map legacy fields to new fields if provided
    const finalTemplateType = template_type || hierarchy;
    const finalProcess = process || report_type;
    const finalEnabled = enabled !== undefined ? enabled : (status === 'active');

    const query = `
      UPDATE report_schedules
      SET 
        template_name = COALESCE($1, template_name),
        template_type = COALESCE($2, template_type),
        process = COALESCE($3, process),
        district_id = $4,
        district_name = $5,
        region_id = $6,
        region_name = $7,
        subsidiary_id = $8,
        subsidiary_name = $9,
        email_group_id = $10,
        email_group_ids = $11,
        frequency = COALESCE($12, frequency),
        day_of_week = $13,
        day_of_month = $14,
        time_of_day = COALESCE($15, time_of_day),
        enabled = COALESCE($16, enabled),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $17
      RETURNING *
    `;

    const result = await this.pool.query(query, [
      template_name,
      finalTemplateType,
      finalProcess,
      district_id !== undefined ? district_id : (finalTemplateType === 'district' ? entity_id : null),
      district_name !== undefined ? district_name : (finalTemplateType === 'district' ? entity_name : null),
      region_id !== undefined ? region_id : (finalTemplateType === 'region' ? entity_id : null),
      region_name !== undefined ? region_name : (finalTemplateType === 'region' ? entity_name : null),
      subsidiary_id !== undefined ? subsidiary_id : (finalTemplateType === 'subsidiary' ? entity_id : null),
      subsidiary_name !== undefined ? subsidiary_name : (finalTemplateType === 'subsidiary' ? entity_name : null),
      email_group_id,
      email_group_ids,
      frequency,
      day_of_week,
      day_of_month,
      time_of_day,
      finalEnabled,
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

