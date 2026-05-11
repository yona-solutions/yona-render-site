/**
 * Email Configuration Service
 * 
 * Handles database operations for email groups and report schedules.
 * Uses PostgreSQL with connection pooling for optimal performance.
 */

const { Pool } = require('pg');

function splitNameParts(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return {
    first_name: parts[0] || null,
    last_name: parts.length > 1 ? parts[parts.length - 1] : null
  };
}

function normalizeEmailGroupContacts(rawContacts = []) {
  const inputs = Array.isArray(rawContacts) ? rawContacts : [];
  const seenEmails = new Set();
  const normalized = [];

  inputs.forEach(contact => {
    if (!contact) return;

    const input = typeof contact === 'string' ? { email: contact } : contact;
    const email = String(input.email || '').trim();
    if (!email) {
      return;
    }

    const dedupeKey = email.toLowerCase();
    if (seenEmails.has(dedupeKey)) {
      return;
    }
    seenEmails.add(dedupeKey);

    const name = String(input.name || '').trim();
    const firstName = String(input.first_name || input.firstName || '').trim();
    const lastName = String(input.last_name || input.lastName || '').trim();
    const derivedNames = (!firstName || !lastName) && name ? splitNameParts(name) : { first_name: null, last_name: null };
    const resolvedFirstName = firstName || derivedNames.first_name;
    const resolvedLastName = lastName || derivedNames.last_name;
    const fullName = name || [resolvedFirstName, resolvedLastName].filter(Boolean).join(' ').trim() || null;

    normalized.push({
      email,
      name: fullName,
      first_name: resolvedFirstName || null,
      last_name: resolvedLastName || null
    });
  });

  return normalized;
}

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

  /**
   * Get a single global app setting value
   */
  async getGlobalSetting(key) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const result = await this.pool.query(
      'SELECT value FROM global_settings WHERE key = $1',
      [key]
    );

    return result.rows[0]?.value ?? null;
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
      SELECT id, email, name, first_name, last_name, created_at
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

    const { name, description } = data;
    const contacts = normalizeEmailGroupContacts(data.contacts || data.emails || []);
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
      if (contacts.length > 0) {
        const contactQuery = `
          INSERT INTO email_group_contacts (email_group_id, email, name, first_name, last_name)
          VALUES ($1, $2, $3, $4, $5)
        `;

        for (const contact of contacts) {
          await client.query(contactQuery, [
            group.id,
            contact.email,
            contact.name,
            contact.first_name,
            contact.last_name
          ]);
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

    const { name, description } = data;
    const contacts = data.contacts !== undefined || data.emails !== undefined
      ? normalizeEmailGroupContacts(data.contacts || data.emails || [])
      : undefined;
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
      if (contacts) {
        // Delete existing contacts
        await client.query('DELETE FROM email_group_contacts WHERE email_group_id = $1', [id]);

        // Insert new contacts
        if (contacts.length > 0) {
          const contactQuery = `
            INSERT INTO email_group_contacts (email_group_id, email, name, first_name, last_name)
            VALUES ($1, $2, $3, $4, $5)
          `;

          for (const contact of contacts) {
            await client.query(contactQuery, [
              id,
              contact.email,
              contact.name,
              contact.first_name,
              contact.last_name
            ]);
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

    const usageCheck = await this.pool.query(`
      SELECT id
      FROM report_schedules
      WHERE email_group_id = $1
         OR $1 = ANY(COALESCE(email_group_ids, ARRAY[]::INTEGER[]))
      LIMIT 1
    `, [id]);

    if (usageCheck.rows.length > 0) {
      const error = new Error('Email group is used by one or more report schedules');
      error.code = '23503';
      throw error;
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

  normalizeEmailGroupIds(emailGroupIds = [], fallbackId = null) {
    const rawIds = Array.isArray(emailGroupIds)
      ? emailGroupIds
      : [fallbackId].filter(Boolean);

    return [...new Set(
      rawIds
        .map(id => parseInt(id, 10))
        .filter(Number.isFinite)
    )];
  }

  getReportItemsFromPayload(data = {}) {
    if (Array.isArray(data.reports) && data.reports.length > 0) {
      return data.reports.filter(Boolean);
    }

    const templateType = data.template_type || data.hierarchy;
    const process = data.process || data.report_type;
    if (!templateType || !process) {
      return [];
    }

    return [{
      id: data.report_id || data.id || null,
      template_name: data.report_template_name || data.template_name || 'Untitled P&L',
      template_type: templateType,
      process,
      service_filter_id: data.service_filter_id || null,
      service_filter_name: data.service_filter_name || null,
      header_subsidiary_id: data.header_subsidiary_id || null,
      header_subsidiary_name: data.header_subsidiary_name || null,
      district_id: data.district_id || null,
      district_name: data.district_name || null,
      region_id: data.region_id || null,
      region_name: data.region_name || null,
      subsidiary_id: data.subsidiary_id || null,
      subsidiary_name: data.subsidiary_name || null,
      customer_tag_id: data.customer_tag_id || null,
      customer_tag_name: data.customer_tag_name || null
    }];
  }

  mapReportScheduleReportRow(row) {
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      template_name: row.template_name || '',
      template_type: row.template_type || '',
      process: row.process || '',
      service_filter_id: row.service_filter_id || null,
      service_filter_name: row.service_filter_name || null,
      header_subsidiary_id: row.header_subsidiary_id || null,
      header_subsidiary_name: row.header_subsidiary_name || null,
      district_id: row.district_id || null,
      district_name: row.district_name || null,
      region_id: row.region_id || null,
      region_name: row.region_name || null,
      subsidiary_id: row.subsidiary_id || null,
      subsidiary_name: row.subsidiary_name || null,
      customer_tag_id: row.customer_tag_id || null,
      customer_tag_name: row.customer_tag_name || null,
      sort_order: row.sort_order || 0,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  mapReportScheduleGroup(row, reportRows = []) {
    const fallbackReports = reportRows.length > 0
      ? reportRows
      : this.getReportItemsFromPayload(row);

    return {
      ...row,
      name: row.template_name || '',
      email_template_type: row.email_template_type || null,
      email_group_ids: this.normalizeEmailGroupIds(row.email_group_ids, row.email_group_id),
      reports: fallbackReports.map(report => this.mapReportScheduleReportRow(report) || report).filter(Boolean)
    };
  }

  buildReportScheduleMirrorFromGroup(data = {}) {
    const reports = this.getReportItemsFromPayload(data);
    const primaryReport = reports[0] || {};
    const emailGroupIds = this.normalizeEmailGroupIds(data.email_group_ids, data.email_group_id);

    return {
      template_name: String(data.name || data.template_name || '').trim() || 'Untitled Report Group',
      email_template_type: data.email_template_type || null,
      template_type: primaryReport.template_type || data.template_type || data.hierarchy || 'district',
      process: primaryReport.process || data.process || data.report_type || 'standard',
      tags: Array.isArray(data.tags) ? data.tags : [],
      service_filter_id: primaryReport.service_filter_id || data.service_filter_id || null,
      service_filter_name: primaryReport.service_filter_name || data.service_filter_name || null,
      header_subsidiary_id: primaryReport.header_subsidiary_id || data.header_subsidiary_id || null,
      header_subsidiary_name: primaryReport.header_subsidiary_name || data.header_subsidiary_name || null,
      district_id: primaryReport.district_id || data.district_id || null,
      district_name: primaryReport.district_name || data.district_name || null,
      region_id: primaryReport.region_id || data.region_id || null,
      region_name: primaryReport.region_name || data.region_name || null,
      subsidiary_id: primaryReport.subsidiary_id || data.subsidiary_id || null,
      subsidiary_name: primaryReport.subsidiary_name || data.subsidiary_name || null,
      customer_tag_id: primaryReport.customer_tag_id || data.customer_tag_id || null,
      customer_tag_name: primaryReport.customer_tag_name || data.customer_tag_name || null,
      email_group_id: emailGroupIds[0] || null,
      email_group_ids: emailGroupIds,
      frequency: data.frequency || 'monthly',
      day_of_week: data.day_of_week || null,
      day_of_month: data.day_of_month ?? null,
      time_of_day: data.time_of_day || '08:00:00',
      enabled: data.enabled !== undefined ? Boolean(data.enabled) : true
    };
  }

  async getReportScheduleReportsMap(scheduleIds, client = this.pool) {
    const normalizedIds = Array.isArray(scheduleIds)
      ? scheduleIds.map(id => parseInt(id, 10)).filter(Number.isFinite)
      : [parseInt(scheduleIds, 10)].filter(Number.isFinite);

    const reportsByScheduleId = new Map();
    normalizedIds.forEach(id => reportsByScheduleId.set(id, []));

    if (normalizedIds.length === 0) {
      return reportsByScheduleId;
    }

    const query = `
      SELECT *
      FROM report_schedule_reports
      WHERE report_schedule_id = ANY($1::INTEGER[])
      ORDER BY report_schedule_id ASC, sort_order ASC, id ASC
    `;

    const result = await client.query(query, [normalizedIds]);
    result.rows.forEach(row => {
      const report = this.mapReportScheduleReportRow(row);
      if (!reportsByScheduleId.has(row.report_schedule_id)) {
        reportsByScheduleId.set(row.report_schedule_id, []);
      }
      reportsByScheduleId.get(row.report_schedule_id).push(report);
    });

    return reportsByScheduleId;
  }

  async replaceReportScheduleReports(client, scheduleId, reports = []) {
    await client.query('DELETE FROM report_schedule_reports WHERE report_schedule_id = $1', [scheduleId]);

    const normalizedReports = this.getReportItemsFromPayload({ reports });
    if (!normalizedReports.length) {
      return;
    }

    const insertQuery = `
      INSERT INTO report_schedule_reports (
        report_schedule_id,
        sort_order,
        template_name,
        template_type,
        process,
        service_filter_id,
        service_filter_name,
        header_subsidiary_id,
        header_subsidiary_name,
        district_id,
        district_name,
        region_id,
        region_name,
        subsidiary_id,
        subsidiary_name,
        customer_tag_id,
        customer_tag_name
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, $17
      )
    `;

    for (const [index, report] of normalizedReports.entries()) {
      await client.query(insertQuery, [
        scheduleId,
        index,
        report.template_name || 'Untitled P&L',
        report.template_type || null,
        report.process || null,
        report.service_filter_id || null,
        report.service_filter_name || null,
        report.header_subsidiary_id || null,
        report.header_subsidiary_name || null,
        report.district_id || null,
        report.district_name || null,
        report.region_id || null,
        report.region_name || null,
        report.subsidiary_id || null,
        report.subsidiary_name || null,
        report.customer_tag_id || null,
        report.customer_tag_name || null
      ]);
    }
  }

  /**
   * Get all report schedules with email group info
   */
  async getReportSchedules() {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = `
      SELECT rs.*
      FROM report_schedules rs
      ORDER BY COALESCE(rs.updated_at, rs.created_at) DESC, rs.id DESC
    `;

    const result = await this.pool.query(query);
    const scheduleIds = result.rows.map(row => row.id);
    const reportsByScheduleId = await this.getReportScheduleReportsMap(scheduleIds);

    return result.rows.map(row => this.mapReportScheduleGroup(row, reportsByScheduleId.get(row.id) || []));
  }

  /**
   * Get a single report schedule by ID
   */
  async getReportSchedule(id) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = `
      SELECT rs.*
      FROM report_schedules rs
      WHERE rs.id = $1
    `;

    const result = await this.pool.query(query, [id]);
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const reportsByScheduleId = await this.getReportScheduleReportsMap([id]);
    return this.mapReportScheduleGroup(row, reportsByScheduleId.get(id) || []);
  }

  /**
   * Get active schedules that need to be sent
   */
  async getSchedulesDueForSend() {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = `
      SELECT rs.*
      FROM report_schedules rs
      WHERE rs.enabled = true
        AND rs.next_send_at IS NOT NULL
        AND rs.next_send_at <= CURRENT_TIMESTAMP
      ORDER BY rs.next_send_at ASC
    `;

    const result = await this.pool.query(query);
    const scheduleIds = result.rows.map(row => row.id);
    const reportsByScheduleId = await this.getReportScheduleReportsMap(scheduleIds);

    return result.rows.map(row => this.mapReportScheduleGroup(row, reportsByScheduleId.get(row.id) || []));
  }

  /**
   * Create a new report schedule
   */
  async createReportSchedule(data) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const scheduleRecord = this.buildReportScheduleMirrorFromGroup(data);
      const insertQuery = `
        INSERT INTO report_schedules (
          template_name, email_template_type, template_type, process,
          tags,
          service_filter_id, service_filter_name,
          header_subsidiary_id, header_subsidiary_name,
          district_id, district_name, region_id, region_name,
          subsidiary_id, subsidiary_name, customer_tag_id, customer_tag_name,
          email_group_id, email_group_ids, frequency,
          day_of_week, day_of_month, time_of_day, enabled
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
        )
        RETURNING id
      `;

      const result = await client.query(insertQuery, [
        scheduleRecord.template_name,
        scheduleRecord.email_template_type,
        scheduleRecord.template_type,
        scheduleRecord.process,
        scheduleRecord.tags,
        scheduleRecord.service_filter_id,
        scheduleRecord.service_filter_name,
        scheduleRecord.header_subsidiary_id,
        scheduleRecord.header_subsidiary_name,
        scheduleRecord.district_id,
        scheduleRecord.district_name,
        scheduleRecord.region_id,
        scheduleRecord.region_name,
        scheduleRecord.subsidiary_id,
        scheduleRecord.subsidiary_name,
        scheduleRecord.customer_tag_id,
        scheduleRecord.customer_tag_name,
        scheduleRecord.email_group_id,
        scheduleRecord.email_group_ids,
        scheduleRecord.frequency,
        scheduleRecord.day_of_week,
        scheduleRecord.day_of_month,
        scheduleRecord.time_of_day,
        scheduleRecord.enabled
      ]);

      const scheduleId = result.rows[0].id;
      await this.replaceReportScheduleReports(client, scheduleId, data.reports || []);

      await client.query('COMMIT');
      return this.getReportSchedule(scheduleId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update a report schedule
   */
  async updateReportSchedule(id, data) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const existingResult = await client.query(`
        SELECT *
        FROM report_schedules
        WHERE id = $1
      `, [id]);

      if (existingResult.rows.length === 0) {
        throw new Error('Report schedule not found');
      }

      const existingRow = existingResult.rows[0];
      const existingReportsMap = await this.getReportScheduleReportsMap([id], client);
      const existingReports = existingReportsMap.get(id)?.length
        ? existingReportsMap.get(id)
        : this.getReportItemsFromPayload(existingRow);

      const mergedData = {
        name: data.name !== undefined ? data.name : existingRow.template_name,
        email_template_type: data.email_template_type !== undefined ? data.email_template_type : existingRow.email_template_type,
        template_name: data.template_name !== undefined ? data.template_name : existingRow.template_name,
        tags: data.tags !== undefined ? data.tags : (existingRow.tags || []),
        email_group_ids: data.email_group_ids !== undefined
          ? data.email_group_ids
          : this.normalizeEmailGroupIds(existingRow.email_group_ids, existingRow.email_group_id),
        reports: data.reports !== undefined ? data.reports : existingReports,
        frequency: data.frequency !== undefined ? data.frequency : existingRow.frequency,
        day_of_week: data.day_of_week !== undefined ? data.day_of_week : existingRow.day_of_week,
        day_of_month: data.day_of_month !== undefined ? data.day_of_month : existingRow.day_of_month,
        time_of_day: data.time_of_day !== undefined ? data.time_of_day : existingRow.time_of_day,
        enabled: data.enabled !== undefined ? data.enabled : existingRow.enabled
      };

      const scheduleRecord = this.buildReportScheduleMirrorFromGroup(mergedData);
      const updateQuery = `
        UPDATE report_schedules
        SET
          template_name = $1,
          email_template_type = $2,
          template_type = $3,
          process = $4,
          tags = $5,
          service_filter_id = $6,
          service_filter_name = $7,
          header_subsidiary_id = $8,
          header_subsidiary_name = $9,
          district_id = $10,
          district_name = $11,
          region_id = $12,
          region_name = $13,
          subsidiary_id = $14,
          subsidiary_name = $15,
          customer_tag_id = $16,
          customer_tag_name = $17,
          email_group_id = $18,
          email_group_ids = $19,
          frequency = $20,
          day_of_week = $21,
          day_of_month = $22,
          time_of_day = $23,
          enabled = $24,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $25
      `;

      await client.query(updateQuery, [
        scheduleRecord.template_name,
        scheduleRecord.email_template_type,
        scheduleRecord.template_type,
        scheduleRecord.process,
        scheduleRecord.tags,
        scheduleRecord.service_filter_id,
        scheduleRecord.service_filter_name,
        scheduleRecord.header_subsidiary_id,
        scheduleRecord.header_subsidiary_name,
        scheduleRecord.district_id,
        scheduleRecord.district_name,
        scheduleRecord.region_id,
        scheduleRecord.region_name,
        scheduleRecord.subsidiary_id,
        scheduleRecord.subsidiary_name,
        scheduleRecord.customer_tag_id,
        scheduleRecord.customer_tag_name,
        scheduleRecord.email_group_id,
        scheduleRecord.email_group_ids,
        scheduleRecord.frequency,
        scheduleRecord.day_of_week,
        scheduleRecord.day_of_month,
        scheduleRecord.time_of_day,
        scheduleRecord.enabled,
        id
      ]);

      await this.replaceReportScheduleReports(client, id, mergedData.reports);

      await client.query('COMMIT');
      return this.getReportSchedule(id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update schedule run metadata
   * @param {number} id - Schedule ID
   * @param {Object} data - Timestamp data to persist
   * @param {Date} data.lastRunAt - When the schedule last ran
   * @param {Date|null} data.lastSentAt - When the schedule last successfully delivered email
   * @param {Date|undefined|null} data.nextSendAt - Next scheduled run timestamp (legacy scheduler support)
   */
  async updateScheduleRunTimestamps(id, { lastRunAt, lastSentAt = null, nextSendAt = undefined } = {}) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = `
      UPDATE report_schedules
      SET
        last_run_at = COALESCE($1, last_run_at),
        last_sent_at = COALESCE($2, last_sent_at),
        next_send_at = COALESCE($3, next_send_at),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *
    `;

    const result = await this.pool.query(query, [
      lastRunAt || null,
      lastSentAt,
      nextSendAt === undefined ? null : nextSendAt,
      id
    ]);
    return result.rows[0];
  }

  /**
   * Backwards-compatible wrapper for older send timestamp callers.
   */
  async updateScheduleSendTimestamps(id, lastSentAt, nextSendAt) {
    return this.updateScheduleRunTimestamps(id, {
      lastRunAt: lastSentAt,
      lastSentAt,
      nextSendAt
    });
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
  // Report Batch Runs
  // ============================================

  async getEnabledReportSchedulesByTag(tag) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = `
      SELECT
        rs.*
      FROM report_schedules rs
      WHERE rs.enabled = true
        AND EXISTS (
          SELECT 1
          FROM unnest(COALESCE(rs.tags, ARRAY[]::TEXT[])) AS tag_value
          WHERE LOWER(tag_value) = LOWER($1)
        )
      ORDER BY rs.created_at DESC
    `;

    const result = await this.pool.query(query, [tag]);
    const scheduleIds = result.rows.map(row => row.id);
    const reportsByScheduleId = await this.getReportScheduleReportsMap(scheduleIds);

    return result.rows.map(row => this.mapReportScheduleGroup(row, reportsByScheduleId.get(row.id) || []));
  }

  async getDistinctScheduleTags() {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = `
      SELECT DISTINCT tag_value AS tag
      FROM report_schedules rs,
      LATERAL unnest(COALESCE(rs.tags, ARRAY[]::TEXT[])) AS tag_value
      WHERE NULLIF(TRIM(tag_value), '') IS NOT NULL
      ORDER BY tag_value ASC
    `;

    const result = await this.pool.query(query);
    return result.rows.map(row => row.tag);
  }

  async findActiveReportBatchRun({ tag, report_date, run_mode }) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = `
      SELECT *
      FROM report_batch_runs
      WHERE LOWER(tag) = LOWER($1)
        AND report_date = $2
        AND run_mode = $3
        AND status IN ('queued', 'running')
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await this.pool.query(query, [tag, report_date, run_mode]);
    return result.rows[0] || null;
  }

  async createReportBatchRun(data) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const {
      tag,
      report_date,
      run_mode = 'send',
      requested_by_email = null,
      total_schedules = 0,
      status = 'queued'
    } = data;

    const query = `
      INSERT INTO report_batch_runs (
        tag,
        report_date,
        run_mode,
        requested_by_email,
        total_schedules,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const result = await this.pool.query(query, [
      tag,
      report_date,
      run_mode,
      requested_by_email,
      total_schedules,
      status
    ]);

    return result.rows[0];
  }

  async createReportBatchRunItems(batchRunId, schedules, { report_date, run_mode }) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const createdItems = [];
      const query = `
        INSERT INTO report_batch_run_items (
          batch_run_id,
          schedule_id,
          schedule_name,
          report_date,
          run_mode,
          status
        )
        VALUES ($1, $2, $3, $4, $5, 'queued')
        RETURNING *
      `;

      for (const schedule of schedules) {
        const result = await client.query(query, [
          batchRunId,
          schedule.id,
          schedule.template_name,
          report_date,
          run_mode
        ]);
        createdItems.push(result.rows[0]);
      }

      await client.query('COMMIT');
      return createdItems;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getReportBatchRun(id) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = `
      SELECT *
      FROM report_batch_runs
      WHERE id = $1
    `;

    const result = await this.pool.query(query, [id]);
    return result.rows[0] || null;
  }

  async getLatestReportBatchRun() {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = `
      SELECT *
      FROM report_batch_runs
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await this.pool.query(query);
    return result.rows[0] || null;
  }

  async getLatestActiveReportBatchRun() {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = `
      SELECT *
      FROM report_batch_runs
      WHERE status IN ('queued', 'running')
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await this.pool.query(query);
    return result.rows[0] || null;
  }

  async getReportBatchRunItems(batchRunId) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = `
      SELECT *
      FROM report_batch_run_items
      WHERE batch_run_id = $1
      ORDER BY id ASC
    `;

    const result = await this.pool.query(query, [batchRunId]);
    return result.rows;
  }

  async getReportBatchRunWithItems(id) {
    const batchRun = await this.getReportBatchRun(id);
    if (!batchRun) {
      return null;
    }

    const items = await this.getReportBatchRunItems(id);
    return {
      ...batchRun,
      items
    };
  }

  async getReportBatchRunItem(id) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = `
      SELECT
        item.*,
        batch.tag AS batch_tag,
        batch.report_date AS batch_report_date,
        batch.run_mode AS batch_run_mode,
        batch.status AS batch_status,
        batch.requested_by_email,
        rs.enabled AS schedule_enabled
      FROM report_batch_run_items item
      INNER JOIN report_batch_runs batch ON batch.id = item.batch_run_id
      LEFT JOIN report_schedules rs ON rs.id = item.schedule_id
      WHERE item.id = $1
    `;

    const result = await this.pool.query(query, [id]);
    return result.rows[0] || null;
  }

  async updateReportBatchRun(id, data) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const allowedFields = [
      'status',
      'requested_by_email',
      'total_schedules',
      'processed_schedules',
      'successful_schedules',
      'partial_schedules',
      'failed_schedules',
      'skipped_schedules',
      'emails_sent',
      'emails_failed',
      'error_message',
      'started_at',
      'completed_at'
    ];

    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    allowedFields.forEach(field => {
      if (data[field] !== undefined) {
        setClauses.push(`${field} = $${paramIndex++}`);
        values.push(data[field]);
      }
    });

    if (setClauses.length === 0) {
      return this.getReportBatchRun(id);
    }

    setClauses.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const query = `
      UPDATE report_batch_runs
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await this.pool.query(query, values);
    return result.rows[0] || null;
  }

  async markReportBatchRunStarted(id) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = `
      UPDATE report_batch_runs
      SET
        status = 'running',
        started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `;

    const result = await this.pool.query(query, [id]);
    return result.rows[0] || null;
  }

  async updateReportBatchRunItem(id, data) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const allowedFields = [
      'status',
      'attempt_count',
      'last_attempt_at',
      'completed_at',
      'emails_sent',
      'emails_failed',
      'pdf_size_bytes',
      'error_message',
      'task_name',
      'result_payload'
    ];

    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    allowedFields.forEach(field => {
      if (data[field] !== undefined) {
        setClauses.push(`${field} = $${paramIndex++}`);
        values.push(data[field]);
      }
    });

    if (setClauses.length === 0) {
      return this.getReportBatchRunItem(id);
    }

    setClauses.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const query = `
      UPDATE report_batch_run_items
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await this.pool.query(query, values);
    return result.rows[0] || null;
  }

  async recalculateReportBatchRun(id) {
    if (!this.isAvailable()) {
      throw new Error('Database not initialized');
    }

    const query = `
      WITH summary AS (
        SELECT
          COUNT(*) AS total_schedules,
          COUNT(*) FILTER (WHERE status IN ('success', 'partial', 'failed', 'skipped')) AS processed_schedules,
          COUNT(*) FILTER (WHERE status = 'success') AS successful_schedules,
          COUNT(*) FILTER (WHERE status = 'partial') AS partial_schedules,
          COUNT(*) FILTER (WHERE status = 'failed') AS failed_schedules,
          COUNT(*) FILTER (WHERE status = 'skipped') AS skipped_schedules,
          COALESCE(SUM(emails_sent), 0) AS emails_sent,
          COALESCE(SUM(emails_failed), 0) AS emails_failed,
          COUNT(*) FILTER (WHERE status = 'running') AS running_count,
          COUNT(*) FILTER (WHERE status = 'queued') AS queued_count
        FROM report_batch_run_items
        WHERE batch_run_id = $1
      )
      UPDATE report_batch_runs batch
      SET
        total_schedules = summary.total_schedules,
        processed_schedules = summary.processed_schedules,
        successful_schedules = summary.successful_schedules,
        partial_schedules = summary.partial_schedules,
        failed_schedules = summary.failed_schedules,
        skipped_schedules = summary.skipped_schedules,
        emails_sent = summary.emails_sent,
        emails_failed = summary.emails_failed,
        status = CASE
          WHEN summary.running_count > 0 THEN 'running'
          WHEN summary.queued_count > 0 AND summary.processed_schedules = 0 THEN 'queued'
          WHEN summary.queued_count > 0 THEN 'running'
          WHEN summary.failed_schedules > 0 AND summary.successful_schedules = 0 AND summary.partial_schedules = 0 THEN 'failed'
          WHEN summary.failed_schedules > 0 OR summary.partial_schedules > 0 THEN 'partial'
          ELSE 'completed'
        END,
        started_at = CASE
          WHEN summary.processed_schedules > 0 OR summary.running_count > 0
            THEN COALESCE(batch.started_at, CURRENT_TIMESTAMP)
          ELSE batch.started_at
        END,
        completed_at = CASE
          WHEN summary.running_count = 0 AND summary.queued_count = 0
            THEN COALESCE(batch.completed_at, CURRENT_TIMESTAMP)
          ELSE NULL
        END,
        updated_at = CURRENT_TIMESTAMP
      FROM summary
      WHERE batch.id = $1
      RETURNING batch.*
    `;

    const result = await this.pool.query(query, [id]);
    return result.rows[0] || null;
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
