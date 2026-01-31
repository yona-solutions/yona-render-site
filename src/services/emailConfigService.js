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
      WHERE rs.enabled = true
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

    console.log('📝 Updating schedule with data:', JSON.stringify(data, null, 2));
    console.log('   day_of_month in data:', data.day_of_month, '| hasOwnProperty:', data.hasOwnProperty('day_of_month'));

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
    // Only set enabled if explicitly provided, otherwise keep existing value (via COALESCE in SQL)
    const finalEnabled = enabled !== undefined ? enabled : (status !== undefined ? (status === 'active') : undefined);

    // Build dynamic query - only update fields that were explicitly provided
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    if (template_name !== undefined) {
      setClauses.push(`template_name = $${paramIndex++}`);
      values.push(template_name);
    }
    if (finalTemplateType !== undefined) {
      setClauses.push(`template_type = $${paramIndex++}`);
      values.push(finalTemplateType);
    }
    if (finalProcess !== undefined) {
      setClauses.push(`process = $${paramIndex++}`);
      values.push(finalProcess);
    }
    // Entity fields - only update if explicitly provided
    if (district_id !== undefined || (finalTemplateType === 'district' && entity_id !== undefined)) {
      setClauses.push(`district_id = $${paramIndex++}`);
      values.push(district_id !== undefined ? district_id : entity_id);
    }
    if (district_name !== undefined || (finalTemplateType === 'district' && entity_name !== undefined)) {
      setClauses.push(`district_name = $${paramIndex++}`);
      values.push(district_name !== undefined ? district_name : entity_name);
    }
    if (region_id !== undefined || (finalTemplateType === 'region' && entity_id !== undefined)) {
      setClauses.push(`region_id = $${paramIndex++}`);
      values.push(region_id !== undefined ? region_id : entity_id);
    }
    if (region_name !== undefined || (finalTemplateType === 'region' && entity_name !== undefined)) {
      setClauses.push(`region_name = $${paramIndex++}`);
      values.push(region_name !== undefined ? region_name : entity_name);
    }
    if (subsidiary_id !== undefined || (finalTemplateType === 'subsidiary' && entity_id !== undefined)) {
      setClauses.push(`subsidiary_id = $${paramIndex++}`);
      values.push(subsidiary_id !== undefined ? subsidiary_id : entity_id);
    }
    if (subsidiary_name !== undefined || (finalTemplateType === 'subsidiary' && entity_name !== undefined)) {
      setClauses.push(`subsidiary_name = $${paramIndex++}`);
      values.push(subsidiary_name !== undefined ? subsidiary_name : entity_name);
    }
    if (email_group_id !== undefined) {
      setClauses.push(`email_group_id = $${paramIndex++}`);
      values.push(email_group_id);
    }
    if (email_group_ids !== undefined) {
      setClauses.push(`email_group_ids = $${paramIndex++}`);
      values.push(email_group_ids);
    }
    if (frequency !== undefined) {
      setClauses.push(`frequency = $${paramIndex++}`);
      values.push(frequency);
    }
    if (day_of_week !== undefined) {
      setClauses.push(`day_of_week = $${paramIndex++}`);
      values.push(day_of_week);
    }
    if (day_of_month !== undefined) {
      setClauses.push(`day_of_month = $${paramIndex++}`);
      values.push(day_of_month);
    }
    if (time_of_day !== undefined) {
      setClauses.push(`time_of_day = $${paramIndex++}`);
      values.push(time_of_day);
    }
    if (finalEnabled !== undefined) {
      setClauses.push(`enabled = $${paramIndex++}`);
      values.push(finalEnabled);
    }

    // Always update updated_at
    setClauses.push('updated_at = CURRENT_TIMESTAMP');

    // Add the id as the last parameter
    values.push(id);

    const query = `
      UPDATE report_schedules
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await this.pool.query(query, values);

    if (result.rows.length === 0) {
      throw new Error('Report schedule not found');
    }

    return result.rows[0];
  }

  /**
   * Update schedule send timestamps
   * @param {number} id - Schedule ID
   * @param {Date} lastSentAt - When the schedule was last sent
   * @param {Date} nextSendAt - When the schedule should next be sent (null to keep existing)
   * @param {string} triggerType - 'manual' or 'scheduled' to update the appropriate last_run column
   */
  async updateScheduleSendTimestamps(id, lastSentAt, nextSendAt, triggerType = 'scheduled') {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    // Determine which column to update based on trigger type
    const lastRunColumn = triggerType === 'manual' ? 'last_run_manual' : 'last_run_automated';

    const query = `
      UPDATE report_schedules
      SET
        last_sent_at = $1,
        next_send_at = COALESCE($2, next_send_at),
        ${lastRunColumn} = $1,
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
  // Run Logs
  // ============================================

  /**
   * Create a new run log entry
   */
  async createRunLog(data) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const {
      schedule_id,
      template_name,
      template_type,
      process,
      entity_id,
      entity_name,
      report_date,
      status = 'pending',
      error_message,
      emails_sent = 0,
      emails_failed = 0,
      recipient_emails = [],
      trigger_type = 'scheduled',
      pdf_size_bytes
    } = data;

    const query = `
      INSERT INTO run_logs (
        schedule_id, template_name, template_type, process,
        entity_id, entity_name, report_date, status, error_message,
        emails_sent, emails_failed, recipient_emails, trigger_type, pdf_size_bytes,
        run_started_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)
      RETURNING *
    `;

    const result = await this.pool.query(query, [
      schedule_id || null,
      template_name,
      template_type,
      process,
      entity_id || null,
      entity_name || null,
      report_date || null,
      status,
      error_message || null,
      emails_sent,
      emails_failed,
      recipient_emails,
      trigger_type,
      pdf_size_bytes || null
    ]);

    return result.rows[0];
  }

  /**
   * Update a run log entry (e.g., when run completes)
   */
  async updateRunLog(id, data) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const {
      status,
      error_message,
      emails_sent,
      emails_failed,
      recipient_emails,
      pdf_size_bytes,
      run_completed_at
    } = data;

    const query = `
      UPDATE run_logs
      SET
        status = COALESCE($1, status),
        error_message = COALESCE($2, error_message),
        emails_sent = COALESCE($3, emails_sent),
        emails_failed = COALESCE($4, emails_failed),
        recipient_emails = COALESCE($5, recipient_emails),
        pdf_size_bytes = COALESCE($6, pdf_size_bytes),
        run_completed_at = COALESCE($7, CURRENT_TIMESTAMP)
      WHERE id = $8
      RETURNING *
    `;

    const result = await this.pool.query(query, [
      status,
      error_message,
      emails_sent,
      emails_failed,
      recipient_emails,
      pdf_size_bytes,
      run_completed_at,
      id
    ]);

    return result.rows[0];
  }

  /**
   * Get all run logs with pagination
   */
  async getRunLogs(options = {}) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const { limit = 100, offset = 0, schedule_id, status, template_name } = options;

    let query = `
      SELECT
        rl.*,
        rs.template_name as current_schedule_name
      FROM run_logs rl
      LEFT JOIN report_schedules rs ON rl.schedule_id = rs.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (schedule_id) {
      query += ` AND rl.schedule_id = $${paramIndex++}`;
      params.push(schedule_id);
    }

    if (status) {
      query += ` AND rl.status = $${paramIndex++}`;
      params.push(status);
    }

    if (template_name) {
      query += ` AND rl.template_name ILIKE $${paramIndex++}`;
      params.push(`%${template_name}%`);
    }

    query += ` ORDER BY rl.run_started_at DESC`;
    query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const result = await this.pool.query(query, params);
    return result.rows;
  }

  /**
   * Get a single run log by ID
   */
  async getRunLog(id) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = `
      SELECT
        rl.*,
        rs.template_name as current_schedule_name
      FROM run_logs rl
      LEFT JOIN report_schedules rs ON rl.schedule_id = rs.id
      WHERE rl.id = $1
    `;

    const result = await this.pool.query(query, [id]);
    return result.rows[0] || null;
  }

  /**
   * Get run log statistics
   */
  async getRunLogStats() {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = `
      SELECT
        COUNT(*) as total_runs,
        COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_runs,
        COUNT(CASE WHEN status = 'partial' THEN 1 END) as partial_runs,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_runs,
        COUNT(CASE WHEN status = 'skipped' THEN 1 END) as skipped_runs,
        SUM(emails_sent) as total_emails_sent,
        SUM(emails_failed) as total_emails_failed,
        MAX(run_started_at) as last_run_at
      FROM run_logs
    `;

    const result = await this.pool.query(query);
    return result.rows[0];
  }

  /**
   * Delete old run logs (cleanup)
   */
  async deleteOldRunLogs(daysToKeep = 90) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = `
      DELETE FROM run_logs
      WHERE run_started_at < CURRENT_TIMESTAMP - INTERVAL '1 day' * $1
      RETURNING id
    `;

    const result = await this.pool.query(query, [daysToKeep]);
    return result.rows.length;
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

