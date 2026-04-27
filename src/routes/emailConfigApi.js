/**
 * Email Configuration API Routes
 *
 * RESTful API endpoints for managing email groups and report schedules.
 */

const express = require('express');
const emailConfigService = require('../services/emailConfigService');
const mockEmailData = require('../services/mockEmailData');
const emailService = require('../services/emailService');
const emailSchedulerService = require('../services/emailSchedulerService');
const reportBatchTaskService = require('../services/reportBatchTaskService');
const scheduleReportService = require('../services/scheduleReportService');

// Store reference to bigQueryService instance (set via createEmailConfigRoutes)
let bigQueryServiceInstance = null;

// Create router instance
const router = express.Router();

// ============================================
// API Key Authentication Middleware
// ============================================

/**
 * Middleware to verify API key for protected endpoints
 * Checks for X-API-Key header against SCHEDULER_API_KEY env var
 */
const requireApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const expectedKey = process.env.SCHEDULER_API_KEY;

  if (!expectedKey) {
    console.error('SCHEDULER_API_KEY not configured');
    return res.status(500).json({
      error: 'Server configuration error',
      message: 'API key authentication not configured'
    });
  }

  if (!apiKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing X-API-Key header'
    });
  }

  if (apiKey !== expectedKey) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid API key'
    });
  }

  next();
};

function normalizeScheduleTags(tags) {
  if (tags === undefined) {
    return undefined;
  }

  const rawTags = Array.isArray(tags)
    ? tags
    : typeof tags === 'string'
      ? tags.split(',')
      : [];

  const seen = new Set();
  const normalized = [];

  rawTags.forEach(tag => {
    if (typeof tag !== 'string') return;

    const trimmed = tag.trim();
    if (!trimmed) return;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    normalized.push(trimmed);
  });

  return normalized;
}

function normalizeBatchMode(mode) {
  return String(mode || '').trim().toLowerCase() === 'generate' ? 'generate' : 'send';
}

// ============================================
// Email Groups API
// ============================================

/**
 * GET /api/email-groups
 * Get all email groups
 */
router.get('/email-groups', async (req, res) => {
  try {
    // Use mock data if database not available
    if (!emailConfigService.isAvailable()) {
      const groups = mockEmailData.getMockEmailGroups();
      return res.json(groups);
    }
    
    const groups = await emailConfigService.getEmailGroups();
    res.json(groups);
  } catch (error) {
    console.error('Error fetching email groups:', error);
    res.status(500).json({
      error: 'Failed to fetch email groups',
      message: error.message
    });
  }
});

/**
 * GET /api/email-groups/:id
 * Get a single email group
 */
router.get('/email-groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const group = await emailConfigService.getEmailGroup(parseInt(id));

    if (!group) {
      return res.status(404).json({
        error: 'Email group not found'
      });
    }

    res.json(group);
  } catch (error) {
    console.error('Error fetching email group:', error);
    res.status(500).json({
      error: 'Failed to fetch email group',
      message: error.message
    });
  }
});

/**
 * GET /api/email-groups/:id/contacts
 * Get contacts for an email group
 */
router.get('/email-groups/:id/contacts', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Use mock data if database not available
    if (!emailConfigService.isAvailable()) {
      const contacts = mockEmailData.getMockEmailGroupContacts(parseInt(id));
      return res.json(contacts);
    }
    
    const contacts = await emailConfigService.getEmailGroupContacts(parseInt(id));
    res.json(contacts);
  } catch (error) {
    console.error('Error fetching email group contacts:', error);
    res.status(500).json({
      error: 'Failed to fetch email group contacts',
      message: error.message
    });
  }
});

/**
 * POST /api/email-groups
 * Create a new email group
 */
router.post('/email-groups', async (req, res) => {
  try {
    const { name, description, emails } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Group name is required'
      });
    }

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'At least one email address is required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = emails.filter(email => !emailRegex.test(email));
    
    if (invalidEmails.length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        message: `Invalid email addresses: ${invalidEmails.join(', ')}`
      });
    }

    // Use mock data if database not available
    if (!emailConfigService.isAvailable()) {
      const group = mockEmailData.createMockEmailGroup({
        name: name.trim(),
        description: description?.trim() || null,
        emails
      });
      console.log(`✅ Created mock email group: ${group.name} (ID: ${group.id})`);
      return res.status(201).json(group);
    }

    const group = await emailConfigService.createEmailGroup({
      name: name.trim(),
      description: description?.trim() || null,
      emails
    });

    console.log(`✅ Created email group: ${group.name} (ID: ${group.id})`);
    res.status(201).json(group);
  } catch (error) {
    console.error('Error creating email group:', error);
    
    // Handle unique constraint violation (duplicate name)
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'Email group already exists',
        message: 'An email group with this name already exists'
      });
    }

    res.status(500).json({
      error: 'Failed to create email group',
      message: error.message
    });
  }
});

/**
 * PUT /api/email-groups/:id
 * Update an email group
 */
router.put('/email-groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, emails } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Group name is required'
      });
    }

    if (emails !== undefined) {
      if (!Array.isArray(emails)) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Emails must be an array'
        });
      }

      if (emails.length === 0) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'At least one email address is required'
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const invalidEmails = emails.filter(email => !emailRegex.test(email));
      
      if (invalidEmails.length > 0) {
        return res.status(400).json({
          error: 'Validation failed',
          message: `Invalid email addresses: ${invalidEmails.join(', ')}`
        });
      }
    }

    const group = await emailConfigService.updateEmailGroup(parseInt(id), {
      name: name.trim(),
      description: description?.trim() || null,
      emails
    });

    console.log(`✅ Updated email group: ${group.name} (ID: ${group.id})`);
    res.json(group);
  } catch (error) {
    console.error('Error updating email group:', error);

    if (error.message === 'Email group not found') {
      return res.status(404).json({
        error: 'Email group not found'
      });
    }

    // Handle unique constraint violation (duplicate name)
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'Email group already exists',
        message: 'An email group with this name already exists'
      });
    }

    res.status(500).json({
      error: 'Failed to update email group',
      message: error.message
    });
  }
});

/**
 * DELETE /api/email-groups/:id
 * Delete an email group
 */
router.delete('/email-groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Use mock data if database not available
    if (!emailConfigService.isAvailable()) {
      const deleted = mockEmailData.deleteMockEmailGroup(parseInt(id));
      if (!deleted) {
        return res.status(404).json({ error: 'Email group not found' });
      }
      console.log(`✅ Deleted mock email group ID: ${id}`);
      return res.status(204).send();
    }
    
    await emailConfigService.deleteEmailGroup(parseInt(id));

    console.log(`✅ Deleted email group ID: ${id}`);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting email group:', error);

    if (error.message === 'Email group not found') {
      return res.status(404).json({
        error: 'Email group not found'
      });
    }

    // Handle foreign key constraint (group is referenced by schedules)
    if (error.code === '23503') {
      return res.status(409).json({
        error: 'Cannot delete email group',
        message: 'This email group is used by one or more report schedules'
      });
    }

    res.status(500).json({
      error: 'Failed to delete email group',
      message: error.message
    });
  }
});

// ============================================
// Report Schedules API
// ============================================

/**
 * GET /api/report-schedules
 * Get all report schedules
 */
router.get('/report-schedules', async (req, res) => {
  try {
    // Use mock data if database not available
    if (!emailConfigService.isAvailable()) {
      const schedules = mockEmailData.getMockReportSchedules();
      return res.json(schedules);
    }
    
    const schedules = await emailConfigService.getReportSchedules();
    res.json(schedules);
  } catch (error) {
    console.error('Error fetching report schedules:', error);
    res.status(500).json({
      error: 'Failed to fetch report schedules',
      message: error.message
    });
  }
});

/**
 * GET /api/report-schedules/:id
 * Get a single report schedule
 */
router.get('/report-schedules/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const schedule = await emailConfigService.getReportSchedule(parseInt(id));

    if (!schedule) {
      return res.status(404).json({
        error: 'Report schedule not found'
      });
    }

    res.json(schedule);
  } catch (error) {
    console.error('Error fetching report schedule:', error);
    res.status(500).json({
      error: 'Failed to fetch report schedule',
      message: error.message
    });
  }
});

/**
 * GET /api/report-schedules/due
 * Get schedules that are due to be sent
 */
router.get('/report-schedules/due', async (req, res) => {
  try {
    const schedules = await emailConfigService.getSchedulesDueForSend();
    res.json(schedules);
  } catch (error) {
    console.error('Error fetching due schedules:', error);
    res.status(500).json({
      error: 'Failed to fetch due schedules',
      message: error.message
    });
  }
});

/**
 * POST /api/report-schedules
 * Create a new report schedule (supports minimal data for inline editing)
 */
router.post('/report-schedules', async (req, res) => {
  try {
    const {
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
      tags,
      email_group_ids,  // Now an array
      frequency,
      day_of_week,
      day_of_month,
      time_of_day,
      enabled,
      // Legacy fields for compatibility
      report_type,
      hierarchy,
      entity_id,
      entity_name,
      status
    } = req.body;

    // For inline editing, allow creating with minimal data
    // Use defaults for required fields that aren't provided
    const scheduleData = {
      template_name: template_name || 'New Report Schedule',
      template_type: template_type || '',
      process: process || '',
      service_filter_id: service_filter_id || null,
      service_filter_name: service_filter_name || null,
      header_subsidiary_id: header_subsidiary_id || null,
      header_subsidiary_name: header_subsidiary_name || null,
      district_id: district_id || null,
      district_name: district_name || null,
      region_id: region_id || null,
      region_name: region_name || null,
      subsidiary_id: subsidiary_id || null,
      subsidiary_name: subsidiary_name || null,
      tags: normalizeScheduleTags(tags) || [],
      email_group_ids: Array.isArray(email_group_ids) ? email_group_ids.map(id => parseInt(id)) : [],
      frequency: frequency || 'monthly',
      day_of_week: day_of_week || null,
      day_of_month: day_of_month || null,
      time_of_day: time_of_day || null,
      enabled: enabled !== undefined ? enabled : true,
      // Legacy fields
      report_type: report_type || '',
      hierarchy: hierarchy || '',
      entity_id: entity_id || '',
      entity_name: entity_name || '',
      status: status || 'active'
    };

    // Use mock data if database not available
    if (!emailConfigService.isAvailable()) {
      const schedule = mockEmailData.createMockReportSchedule(scheduleData);
      console.log(`✅ Created mock report schedule: ${schedule.template_name} (ID: ${schedule.id})`);
      return res.status(201).json(schedule);
    }

    const schedule = await emailConfigService.createReportSchedule(scheduleData);

    console.log(`✅ Created report schedule: ${schedule.template_name} (ID: ${schedule.id})`);
    res.status(201).json(schedule);
  } catch (error) {
    console.error('Error creating report schedule:', error);

    // Handle foreign key constraint (email group doesn't exist)
    if (error.code === '23503') {
      return res.status(400).json({
        error: 'Invalid email group',
        message: 'The specified email group does not exist'
      });
    }

    res.status(500).json({
      error: 'Failed to create report schedule',
      message: error.message
    });
  }
});

/**
 * PUT /api/report-schedules/:id
 * Update a report schedule (supports partial updates for inline editing)
 */
router.put('/report-schedules/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Extract all possible fields from request body
    const updateData = {};
    
    // Only include fields that are provided in the request
    const allowedFields = [
      'template_name',
      'template_type',
      'process',
      'service_filter_id',
      'service_filter_name',
      'header_subsidiary_id',
      'header_subsidiary_name',
      'district_id',
      'district_name',
      'region_id',
      'region_name',
      'subsidiary_id',
      'subsidiary_name',
      'tags',
      'email_group_ids',  // Now an array
      'frequency',
      'day_of_week',
      'day_of_month',
      'time_of_day',
      'enabled',
      // Legacy fields
      'report_type',
      'hierarchy',
      'entity_id',
      'entity_name',
      'status'
    ];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });

    // Convert email_group_ids array to integers if present
    if (updateData.email_group_ids !== undefined) {
      updateData.email_group_ids = Array.isArray(updateData.email_group_ids) 
        ? updateData.email_group_ids.map(id => parseInt(id))
        : [];
    }
    if (updateData.tags !== undefined) {
      updateData.tags = normalizeScheduleTags(updateData.tags);
    }

    // Use mock data if database not available
    if (!emailConfigService.isAvailable()) {
      const schedule = mockEmailData.updateMockReportSchedule(parseInt(id), updateData);
      if (!schedule) {
        return res.status(404).json({ error: 'Report schedule not found' });
      }
      console.log(`✅ Updated mock report schedule ID: ${id}`);
      return res.json(schedule);
    }

    const schedule = await emailConfigService.updateReportSchedule(parseInt(id), updateData);

    console.log(`✅ Updated report schedule ID: ${id}`);
    res.json(schedule);
  } catch (error) {
    console.error('Error updating report schedule:', error);

    if (error.message === 'Report schedule not found') {
      return res.status(404).json({
        error: 'Report schedule not found'
      });
    }

    // Handle foreign key constraint (email group doesn't exist)
    if (error.code === '23503') {
      return res.status(400).json({
        error: 'Invalid email group',
        message: 'The specified email group does not exist'
      });
    }

    res.status(500).json({
      error: 'Failed to update report schedule',
      message: error.message
    });
  }
});

/**
 * DELETE /api/report-schedules/:id
 * Delete a report schedule
 */
router.delete('/report-schedules/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Use mock data if database not available
    if (!emailConfigService.isAvailable()) {
      const deleted = mockEmailData.deleteMockReportSchedule(parseInt(id));
      if (!deleted) {
        return res.status(404).json({ error: 'Report schedule not found' });
      }
      console.log(`✅ Deleted mock report schedule ID: ${id}`);
      return res.status(204).send();
    }
    
    await emailConfigService.deleteReportSchedule(parseInt(id));

    console.log(`✅ Deleted report schedule ID: ${id}`);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting report schedule:', error);

    if (error.message === 'Report schedule not found') {
      return res.status(404).json({
        error: 'Report schedule not found'
      });
    }

    res.status(500).json({
      error: 'Failed to delete report schedule',
      message: error.message
    });
  }
});

// ============================================
// Health Check
// ============================================

/**
 * GET /api/email-config/health
 * Check database health
 */
router.get('/email-config/health', async (req, res) => {
  try {
    const health = await emailConfigService.healthCheck();
    
    if (health.healthy) {
      res.json(health);
    } else {
      res.status(503).json(health);
    }
  } catch (error) {
    res.status(503).json({
      healthy: false,
      error: error.message
    });
  }
});

// ============================================
// Send Email API
// ============================================

/**
 * POST /api/report-schedules/:id/send-email
 * Generate PDF and send email for a report schedule
 */
router.post('/report-schedules/:id/send-email', async (req, res) => {
  try {
    const { id } = req.params;
    const { recipientEmail, reportDate } = req.body;

    // Validate recipient email
    if (!recipientEmail || !recipientEmail.trim()) {
      return res.status(400).json({
        error: 'Recipient email required',
        message: 'Please provide a recipient email address'
      });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipientEmail)) {
      return res.status(400).json({
        error: 'Invalid email address',
        message: 'Please provide a valid email address'
      });
    }

    // Check if email service is available
    if (!emailService.isAvailable()) {
      return res.status(503).json({
        error: 'Email service not configured',
        message: 'SendGrid API key not configured. Please add SENDGRID_API_KEY to environment variables.'
      });
    }

    // Get report schedule
    let schedule;
    if (!emailConfigService.isAvailable()) {
      schedule = mockEmailData.getMockReportSchedule(parseInt(id));
    } else {
      schedule = await emailConfigService.getReportSchedule(parseInt(id));
    }

    if (!schedule) {
      return res.status(404).json({
        error: 'Report schedule not found'
      });
    }

    // Validate schedule configuration
    if (!schedule.template_type) {
      return res.status(400).json({
        error: 'Invalid schedule configuration',
        message: 'Template type is required'
      });
    }

    if (!schedule.process) {
      return res.status(400).json({
        error: 'Invalid schedule configuration',
        message: 'Process (standard/operational) is required'
      });
    }

    console.log(`📧 Generating and sending email for schedule: ${schedule.template_name}`);
    const {
      entityId,
      entityName,
      reportDate: resolvedReportDate,
      htmlContent,
      pdfBuffer,
      preparedReport
    } = await scheduleReportService.generateSchedulePdf(schedule, {
      reportDate,
      bigQueryService: bigQueryServiceInstance
    });

    console.log(`   Using date: ${resolvedReportDate}${reportDate ? ' (user selected)' : ' (latest available)'}`);
    console.log(`   HTML content length: ${htmlContent.length}`);
    console.log(`   Filtered to ${preparedReport.keptCount} report(s) with non-zero net income`);
    console.log(`   PDF generated: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

    // Send email with PDF attachment (using recipient from request body)
    console.log(`   Sending to: ${recipientEmail}`);
    let emailSuccess = false;
    let emailError = null;

    try {
      const result = await emailService.sendPDFEmail(schedule, pdfBuffer, recipientEmail, resolvedReportDate);
      emailSuccess = true;
      console.log(`✅ Email sent successfully`);

      // Log the test run
      if (emailConfigService.isAvailable()) {
        await emailConfigService.createRunLog({
          schedule_id: schedule.id,
          template_name: schedule.template_name,
          template_type: schedule.template_type,
          process: schedule.process,
          entity_id: entityId,
          entity_name: entityName,
          report_date: resolvedReportDate,
          status: 'success',
          emails_sent: 1,
          emails_failed: 0,
          recipient_emails: [recipientEmail],
          trigger_type: 'manual',
          pdf_size_bytes: pdfBuffer.length
        });

        // Update last_run_manual timestamp
        await emailConfigService.updateScheduleSendTimestamps(schedule.id, new Date(), null, 'manual');
        console.log(`   Updated last_run_manual timestamp`);
      }

      res.json({
        success: true,
        message: `Email sent successfully to ${result.recipient}`,
        recipient: result.recipient,
        subject: result.subject,
        filename: result.filename
      });
    } catch (sendError) {
      emailError = sendError;

      // Log the failed test run
      if (emailConfigService.isAvailable()) {
        await emailConfigService.createRunLog({
          schedule_id: schedule.id,
          template_name: schedule.template_name,
          template_type: schedule.template_type,
          process: schedule.process,
          entity_id: entityId,
          entity_name: entityName,
          report_date: resolvedReportDate,
          status: 'failed',
          error_message: sendError.message,
          emails_sent: 0,
          emails_failed: 1,
          recipient_emails: [recipientEmail],
          trigger_type: 'test',
          pdf_size_bytes: pdfBuffer.length
        });
      }

      throw sendError;
    }

  } catch (error) {
    console.error('❌ Error sending email:', error);
    res.status(500).json({
      error: 'Failed to send email',
      message: error.message
    });
  }
});

/**
 * POST /api/report-schedules/:id/send-to-groups
 * Send P&L report to all email groups attached to the schedule
 * Uses authenticated user session (not API key)
 */
router.post('/report-schedules/:id/send-to-groups', async (req, res) => {
  const startTime = Date.now();
  const { id } = req.params;
  const { reportDate } = req.body || {};

  console.log(`\n📧 Send to all groups - Schedule ID: ${id}, Report Date: ${reportDate || 'latest'}`);

  try {
    // Check if email service is available
    if (!emailService.isAvailable()) {
      return res.status(503).json({
        error: 'Email service not available',
        message: 'SendGrid API key not configured'
      });
    }

    // Get report schedule
    let schedule;
    if (!emailConfigService.isAvailable()) {
      return res.status(503).json({
        error: 'Database not available',
        message: 'Email configuration service not initialized'
      });
    }

    schedule = await emailConfigService.getReportSchedule(parseInt(id));

    if (!schedule) {
      return res.status(404).json({
        error: 'Report schedule not found',
        scheduleId: parseInt(id)
      });
    }

    console.log(`   Schedule: ${schedule.template_name}`);

    // Get all email groups for this schedule
    const emailGroupIds = schedule.email_group_ids || (schedule.email_group_id ? [schedule.email_group_id] : []);

    if (emailGroupIds.length === 0) {
      return res.status(400).json({
        error: 'No email groups attached',
        message: 'This schedule has no email groups. Please add email groups in the schedule settings.'
      });
    }

    const recipientList = await scheduleReportService.getScheduleRecipients(schedule);
    console.log(`   Email groups: ${emailGroupIds.length}, Total recipients: ${recipientList.length}`);

    if (recipientList.length === 0) {
      return res.status(400).json({
        error: 'No recipients found',
        message: 'The attached email groups have no contacts. Please add contacts to the email groups.'
      });
    }

    // Validate required fields
    if (!schedule.template_type) {
      return res.status(400).json({
        error: 'Missing template type',
        message: 'Please select a Template Type (District, Region, or Subsidiary)'
      });
    }

    if (!schedule.process) {
      return res.status(400).json({
        error: 'Missing process type',
        message: 'Please select a Process (Standard or Operational)'
      });
    }

    const {
      entityId,
      entityName,
      reportDate: resolvedReportDate,
      pdfBuffer,
      preparedReport
    } = await scheduleReportService.generateSchedulePdf(schedule, {
      reportDate,
      bigQueryService: bigQueryServiceInstance
    });

    console.log(`   Using date: ${resolvedReportDate}${reportDate ? ' (user selected)' : ' (latest available)'}`);
    console.log(`   Filtered to ${preparedReport.keptCount} report(s) with non-zero net income`);
    console.log(`   PDF generated: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

    // Format date for email subject
    const dateObj = new Date(resolvedReportDate + 'T00:00:00');
    const monthName = dateObj.toLocaleString('en-US', { month: 'long' });
    const year = dateObj.getFullYear();

    // Create email content
    const subject = `${schedule.template_name || entityName} - ${monthName} ${year} P&L Report`;
    const filename = `${schedule.template_name || entityName}_${resolvedReportDate}_PnL.pdf`.replace(/[^a-zA-Z0-9_.-]/g, '_');

    // Send to all recipients
    console.log(`   Sending to ${recipientList.length} recipients...`);
    let emailsSent = 0;
    let emailsFailed = 0;
    const results = [];

    for (const recipientEmail of recipientList) {
      try {
        await emailService.sendPDFEmail(schedule, pdfBuffer, recipientEmail, resolvedReportDate);
        emailsSent++;
        results.push({ email: recipientEmail, status: 'sent' });
        console.log(`      ✅ Sent to ${recipientEmail}`);
      } catch (sendError) {
        emailsFailed++;
        results.push({ email: recipientEmail, status: 'failed', error: sendError.message });
        console.error(`      ❌ Failed to send to ${recipientEmail}:`, sendError.message);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`   ✅ Complete: ${emailsSent}/${recipientList.length} sent in ${duration}ms`);

    // Log the run
    if (emailConfigService.isAvailable()) {
      await emailConfigService.createRunLog({
        schedule_id: parseInt(id),
        template_name: schedule.template_name,
        template_type: schedule.template_type,
        process: schedule.process,
        entity_id: entityId,
        entity_name: entityName,
        report_date: resolvedReportDate,
        status: emailsFailed === 0 ? 'success' : (emailsSent > 0 ? 'partial' : 'failed'),
        error_message: emailsFailed > 0 ? `${emailsFailed} of ${recipientList.length} emails failed` : null,
        emails_sent: emailsSent,
        emails_failed: emailsFailed,
        recipient_emails: recipientList,
        trigger_type: 'manual',
        pdf_size_bytes: pdfBuffer.length,
        duration_ms: duration
      });

      // Update last_run_manual timestamp
      await emailConfigService.updateScheduleSendTimestamps(schedule.id, new Date(), null, 'manual');
      console.log(`   Updated last_run_manual timestamp`);
    }

    res.json({
      success: true,
      emailsSent,
      emailsFailed,
      totalRecipients: recipientList.length,
      subject,
      filename,
      results,
      duration: `${duration}ms`
    });

  } catch (error) {
    console.error('❌ Error sending to groups:', error);
    res.status(500).json({
      error: 'Failed to send emails',
      message: error.message
    });
  }
});

// ============================================
// Process Schedule API (for Cloud Function)
// ============================================

/**
 * POST /api/report-schedules/:id/process
 * Process a single schedule - generate PDF and send to all recipients in email groups
 * Protected by API key authentication for use by Cloud Functions
 */
router.post('/report-schedules/:id/process', requireApiKey, async (req, res) => {
  const startTime = Date.now();
  const { id } = req.params;
  const { triggerType = 'scheduled', reportDate, mode = 'send' } = req.body;

  console.log(`\n📧 Processing schedule ${id} (trigger: ${triggerType}, mode: ${mode})`);

  try {
    // Get report schedule
    let schedule;
    if (!emailConfigService.isAvailable()) {
      schedule = mockEmailData.getMockReportSchedule(parseInt(id));
    } else {
      schedule = await emailConfigService.getReportSchedule(parseInt(id));
    }

    if (!schedule) {
      return res.status(404).json({
        error: 'Report schedule not found',
        scheduleId: parseInt(id),
        status: 'error'
      });
    }

    // Check if schedule is enabled
    if (schedule.enabled === false) {
      return res.status(400).json({
        error: 'Schedule is disabled',
        scheduleId: parseInt(id),
        scheduleName: schedule.template_name,
        status: 'skipped',
        skipReason: 'Schedule is disabled'
      });
    }

    // Validate schedule configuration
    if (!schedule.template_type) {
      return res.status(400).json({
        error: 'Invalid schedule configuration',
        message: 'Template type is required',
        scheduleId: parseInt(id),
        scheduleName: schedule.template_name,
        status: 'skipped',
        skipReason: 'Missing template_type'
      });
    }

    if (!schedule.process) {
      return res.status(400).json({
        error: 'Invalid schedule configuration',
        message: 'Process (standard/operational) is required',
        scheduleId: parseInt(id),
        scheduleName: schedule.template_name,
        status: 'skipped',
        skipReason: 'Missing process'
      });
    }

    let entityId;
    let entityName;
    try {
      ({ entityId, entityName } = scheduleReportService.getScheduleEntity(schedule));
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid schedule configuration',
        message: error.message,
        scheduleId: parseInt(id),
        scheduleName: schedule.template_name,
        status: 'skipped',
        skipReason: `No ${schedule.template_type} selected`
      });
    }

    const emailGroupIds = scheduleReportService.getScheduleEmailGroupIds(schedule);

    if (mode === 'send' && emailGroupIds.length === 0) {
      return res.status(400).json({
        error: 'No email groups assigned',
        scheduleId: parseInt(id),
        scheduleName: schedule.template_name,
        status: 'skipped',
        skipReason: 'No email groups assigned'
      });
    }

    if (mode === 'send' && !emailService.isAvailable()) {
      return res.status(503).json({
        error: 'Email service not configured',
        message: 'SendGrid API key not configured',
        scheduleId: parseInt(id),
        scheduleName: schedule.template_name,
        status: 'error'
      });
    }

    const recipientList = mode === 'send'
      ? await scheduleReportService.getScheduleRecipients(schedule)
      : [];

    if (mode === 'send' && recipientList.length === 0) {
      return res.status(400).json({
        error: 'No recipients in email groups',
        scheduleId: parseInt(id),
        scheduleName: schedule.template_name,
        status: 'skipped',
        skipReason: 'No recipients in email groups'
      });
    }

    console.log(`   Schedule: ${schedule.template_name}`);
    console.log(`   Type: ${schedule.template_type} - ${entityName}`);
    console.log(`   Process: ${schedule.process}`);
    if (mode === 'send') {
      console.log(`   Recipients: ${recipientList.length}`);
    }

    const {
      reportDate: resolvedReportDate,
      pdfBuffer,
      preparedReport
    } = await scheduleReportService.generateSchedulePdf(schedule, {
      reportDate,
      bigQueryService: bigQueryServiceInstance
    });

    console.log(`   Using date: ${resolvedReportDate}${reportDate ? ' (user selected)' : ' (latest available)'}`);
    console.log(`   Filtered to ${preparedReport.keptCount} report(s) with non-zero net income`);
    console.log(`   PDF generated: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

    let successCount = 0;
    let failCount = 0;
    const recipientResults = [];

    if (mode === 'send') {
      console.log(`   Sending emails to ${recipientList.length} recipient(s)...`);

      for (const recipientEmail of recipientList) {
        try {
          await emailService.sendPDFEmail(schedule, pdfBuffer, recipientEmail, resolvedReportDate);
          successCount++;
          recipientResults.push({ email: recipientEmail, status: 'sent' });
          console.log(`      ✓ Sent to ${recipientEmail}`);
        } catch (error) {
          failCount++;
          recipientResults.push({ email: recipientEmail, status: 'failed', error: error.message });
          console.log(`      ✗ Failed: ${recipientEmail} - ${error.message}`);
        }
      }
    }

    // Determine status
    let status;
    let errorMessage = null;
    if (mode === 'generate') {
      status = 'success';
    } else if (successCount === 0) {
      status = 'failed';
      errorMessage = `All ${failCount} email(s) failed to send`;
    } else if (failCount > 0) {
      status = 'partial';
    } else {
      status = 'success';
    }

    // Log the run
    if (emailConfigService.isAvailable()) {
      await emailConfigService.createRunLog({
        schedule_id: schedule.id,
        template_name: schedule.template_name,
        template_type: schedule.template_type,
        process: schedule.process,
        entity_id: entityId,
        entity_name: entityName,
        report_date: resolvedReportDate,
        status: status,
        error_message: errorMessage,
        emails_sent: successCount,
        emails_failed: failCount,
        recipient_emails: recipientList,
        trigger_type: triggerType,
        pdf_size_bytes: pdfBuffer.length
      });

      // Update schedule timestamps
      if (mode === 'send' && successCount > 0) {
        await emailConfigService.updateScheduleSendTimestamps(schedule.id, new Date(), null, triggerType);
      }
    }

    const durationMs = Date.now() - startTime;
    if (mode === 'generate') {
      console.log(`   ✅ Complete: PDF generated (${durationMs}ms)`);
    } else {
      console.log(`   ✅ Complete: ${successCount} sent, ${failCount} failed (${durationMs}ms)`);
    }

    res.json({
      success: status !== 'failed',
      scheduleId: parseInt(id),
      scheduleName: schedule.template_name,
      status,
      mode,
      emailsSent: successCount,
      emailsFailed: failCount,
      reportDate: resolvedReportDate,
      pdfSizeBytes: pdfBuffer.length,
      durationMs,
      error: errorMessage,
      recipients: recipientResults
    });

  } catch (error) {
    console.error(`❌ Error processing schedule ${id}:`, error);
    res.status(500).json({
      error: 'Failed to process schedule',
      message: error.message,
      scheduleId: parseInt(id),
      status: 'error'
    });
  }
});

// ============================================
// Report Batch Runs API
// ============================================

router.get('/report-batches/latest', async (req, res) => {
  try {
    if (!emailConfigService.isAvailable()) {
      return res.status(503).json({
        error: 'Database not available',
        message: 'Batch runs require the email configuration database'
      });
    }

    const batchRun = await emailConfigService.getLatestReportBatchRun();
    if (!batchRun) {
      return res.status(404).json({
        error: 'No batch runs found'
      });
    }

    res.json(batchRun);
  } catch (error) {
    console.error('Error fetching latest batch run:', error);
    res.status(500).json({
      error: 'Failed to fetch latest batch run',
      message: error.message
    });
  }
});

router.get('/report-batches/:id', async (req, res) => {
  try {
    if (!emailConfigService.isAvailable()) {
      return res.status(503).json({
        error: 'Database not available',
        message: 'Batch runs require the email configuration database'
      });
    }

    const batchRun = await emailConfigService.getReportBatchRunWithItems(parseInt(req.params.id));
    if (!batchRun) {
      return res.status(404).json({
        error: 'Batch run not found'
      });
    }

    res.json(batchRun);
  } catch (error) {
    console.error('Error fetching batch run:', error);
    res.status(500).json({
      error: 'Failed to fetch batch run',
      message: error.message
    });
  }
});

router.post('/report-batches', async (req, res) => {
  try {
    if (!emailConfigService.isAvailable()) {
      return res.status(503).json({
        error: 'Database not available',
        message: 'Batch runs require the email configuration database'
      });
    }

    const tag = String(req.body?.tag || '').trim();
    const reportDate = scheduleReportService.normalizeReportDateValue(req.body?.reportDate);
    const runMode = normalizeBatchMode(req.body?.mode);

    if (!tag) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Please choose a tag'
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Please choose a valid report month'
      });
    }

    const existingBatch = await emailConfigService.findActiveReportBatchRun({
      tag,
      report_date: reportDate,
      run_mode: runMode
    });

    if (existingBatch) {
      const existingWithItems = await emailConfigService.getReportBatchRunWithItems(existingBatch.id);
      return res.json({
        success: true,
        reusedExisting: true,
        dispatchType: reportBatchTaskService.shouldUseLocalDispatch() ? 'local' : 'cloud-tasks',
        batchRun: existingWithItems
      });
    }

    const schedules = await emailConfigService.getEnabledReportSchedulesByTag(tag);
    if (!schedules.length) {
      return res.status(400).json({
        error: 'No matching schedules',
        message: `No enabled report schedules were found for the tag "${tag}".`
      });
    }

    const batchRun = await emailConfigService.createReportBatchRun({
      tag,
      report_date: reportDate,
      run_mode: runMode,
      requested_by_email: req.user?.email || null,
      total_schedules: schedules.length,
      status: 'queued'
    });

    const batchItems = await emailConfigService.createReportBatchRunItems(batchRun.id, schedules, {
      report_date: reportDate,
      run_mode: runMode
    });

    try {
      const dispatchResults = await reportBatchTaskService.enqueueBatchItems(batchItems);

      await Promise.all(dispatchResults.map(result =>
        emailConfigService.updateReportBatchRunItem(result.itemId, {
          task_name: result.taskName
        })
      ));

      const hydratedBatchRun = await emailConfigService.getReportBatchRunWithItems(batchRun.id);

      res.status(201).json({
        success: true,
        reusedExisting: false,
        dispatchType: dispatchResults[0]?.dispatchType || (reportBatchTaskService.shouldUseLocalDispatch() ? 'local' : 'cloud-tasks'),
        batchRun: hydratedBatchRun
      });
    } catch (dispatchError) {
      await emailConfigService.updateReportBatchRun(batchRun.id, {
        status: 'failed',
        error_message: dispatchError.message,
        completed_at: new Date()
      });

      throw dispatchError;
    }
  } catch (error) {
    console.error('Error creating report batch run:', error);
    res.status(500).json({
      error: 'Failed to create report batch run',
      message: error.message
    });
  }
});

router.post('/report-batches/items/:itemId/execute', requireApiKey, async (req, res) => {
  try {
    if (!emailConfigService.isAvailable()) {
      return res.status(503).json({
        error: 'Database not available',
        message: 'Batch runs require the email configuration database'
      });
    }

    const itemId = parseInt(req.params.itemId);
    const item = await emailConfigService.getReportBatchRunItem(itemId);

    if (!item) {
      return res.status(404).json({
        error: 'Batch run item not found'
      });
    }

    if (!item.schedule_id) {
      await emailConfigService.updateReportBatchRunItem(itemId, {
        status: 'skipped',
        completed_at: new Date(),
        error_message: 'Schedule was deleted before the batch run executed'
      });
      const batchRun = await emailConfigService.recalculateReportBatchRun(item.batch_run_id);
      return res.json({
        success: true,
        status: 'skipped',
        batchStatus: batchRun?.status || 'partial'
      });
    }

    if (['success', 'partial', 'skipped'].includes(item.status)) {
      const batchRun = await emailConfigService.recalculateReportBatchRun(item.batch_run_id);
      return res.json({
        success: true,
        alreadyProcessed: true,
        status: item.status,
        batchStatus: batchRun?.status || item.batch_status
      });
    }

    if (item.status === 'running' && item.last_attempt_at) {
      const lastAttemptAgeMs = Date.now() - new Date(item.last_attempt_at).getTime();
      if (lastAttemptAgeMs < 30 * 60 * 1000) {
        return res.status(202).json({
          success: true,
          alreadyProcessing: true,
          status: 'running'
        });
      }
    }

    await emailConfigService.markReportBatchRunStarted(item.batch_run_id);
    await emailConfigService.updateReportBatchRunItem(itemId, {
      status: 'running',
      attempt_count: (item.attempt_count || 0) + 1,
      last_attempt_at: new Date(),
      completed_at: null,
      error_message: null
    });

    const headers = {
      'Content-Type': 'application/json',
      ...scheduleReportService.getInternalApiHeaders()
    };
    const targetUrl = `${scheduleReportService.getApplicationBaseUrl()}/api/report-schedules/${item.schedule_id}/process`;
    const processResponse = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        triggerType: 'manual-batch',
        reportDate: scheduleReportService.normalizeReportDateValue(item.report_date),
        mode: item.run_mode
      })
    });

    const processPayload = await processResponse.json().catch(() => ({}));

    if (!processResponse.ok) {
      const skippedStatus = processPayload.status === 'skipped';
      await emailConfigService.updateReportBatchRunItem(itemId, {
        status: skippedStatus ? 'skipped' : 'failed',
        completed_at: new Date(),
        emails_sent: processPayload.emailsSent || 0,
        emails_failed: processPayload.emailsFailed || 0,
        pdf_size_bytes: processPayload.pdfSizeBytes || null,
        error_message: processPayload.message || processPayload.error || 'Failed to execute batch item',
        result_payload: processPayload
      });

      const batchRun = await emailConfigService.recalculateReportBatchRun(item.batch_run_id);

      if (skippedStatus) {
        return res.json({
          success: true,
          status: 'skipped',
          batchStatus: batchRun?.status || 'partial',
          result: processPayload
        });
      }

      return res.status(500).json({
        error: 'Failed to execute batch item',
        message: processPayload.message || processPayload.error || 'Report processing failed',
        status: 'failed',
        batchStatus: batchRun?.status || 'failed'
      });
    }

    const itemStatus = processPayload.status === 'partial'
      ? 'partial'
      : (processPayload.status === 'skipped' ? 'skipped' : 'success');

    await emailConfigService.updateReportBatchRunItem(itemId, {
      status: itemStatus,
      completed_at: new Date(),
      emails_sent: processPayload.emailsSent || 0,
      emails_failed: processPayload.emailsFailed || 0,
      pdf_size_bytes: processPayload.pdfSizeBytes || null,
      error_message: processPayload.error || null,
      result_payload: processPayload
    });

    const batchRun = await emailConfigService.recalculateReportBatchRun(item.batch_run_id);

    res.json({
      success: true,
      status: itemStatus,
      batchStatus: batchRun?.status || 'running',
      result: processPayload
    });
  } catch (error) {
    console.error('Error executing batch run item:', error);

    if (emailConfigService.isAvailable()) {
      const itemId = parseInt(req.params.itemId);
      const item = await emailConfigService.getReportBatchRunItem(itemId).catch(() => null);
      if (item) {
        await emailConfigService.updateReportBatchRunItem(itemId, {
          status: 'failed',
          completed_at: new Date(),
          error_message: error.message,
          result_payload: { error: error.message }
        }).catch(() => null);
        await emailConfigService.recalculateReportBatchRun(item.batch_run_id).catch(() => null);
      }
    }

    res.status(500).json({
      error: 'Failed to execute batch run item',
      message: error.message
    });
  }
});

// ============================================
// Email Scheduler API
// ============================================

/**
 * GET /api/email-scheduler/status
 * Get scheduler status and statistics
 */
router.get('/email-scheduler/status', (req, res) => {
  try {
    const stats = emailSchedulerService.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching scheduler status:', error);
    res.status(500).json({
      error: 'Failed to fetch scheduler status',
      message: error.message
    });
  }
});

// ============================================
// Run Logs API
// ============================================

/**
 * GET /api/run-logs
 * Get all run logs with optional filters
 */
router.get('/run-logs', async (req, res) => {
  try {
    if (!emailConfigService.isAvailable()) {
      return res.status(503).json({
        error: 'Database not available',
        message: 'Run logs require database connection'
      });
    }

    const { limit, offset, schedule_id, status, template_name } = req.query;

    const logs = await emailConfigService.getRunLogs({
      limit: limit ? parseInt(limit) : 100,
      offset: offset ? parseInt(offset) : 0,
      schedule_id: schedule_id ? parseInt(schedule_id) : undefined,
      status,
      template_name
    });

    res.json(logs);
  } catch (error) {
    console.error('Error fetching run logs:', error);
    res.status(500).json({
      error: 'Failed to fetch run logs',
      message: error.message
    });
  }
});

/**
 * GET /api/run-logs/stats
 * Get run log statistics
 */
router.get('/run-logs/stats', async (req, res) => {
  try {
    if (!emailConfigService.isAvailable()) {
      return res.status(503).json({
        error: 'Database not available',
        message: 'Run logs require database connection'
      });
    }

    const stats = await emailConfigService.getRunLogStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching run log stats:', error);
    res.status(500).json({
      error: 'Failed to fetch run log statistics',
      message: error.message
    });
  }
});

/**
 * GET /api/run-logs/:id
 * Get a single run log by ID
 */
router.get('/run-logs/:id', async (req, res) => {
  try {
    if (!emailConfigService.isAvailable()) {
      return res.status(503).json({
        error: 'Database not available',
        message: 'Run logs require database connection'
      });
    }

    const { id } = req.params;
    const log = await emailConfigService.getRunLog(parseInt(id));

    if (!log) {
      return res.status(404).json({
        error: 'Run log not found'
      });
    }

    res.json(log);
  } catch (error) {
    console.error('Error fetching run log:', error);
    res.status(500).json({
      error: 'Failed to fetch run log',
      message: error.message
    });
  }
});

/**
 * DELETE /api/run-logs/cleanup
 * Delete old run logs (older than specified days)
 */
router.delete('/run-logs/cleanup', async (req, res) => {
  try {
    if (!emailConfigService.isAvailable()) {
      return res.status(503).json({
        error: 'Database not available',
        message: 'Run logs require database connection'
      });
    }

    const { days } = req.query;
    const daysToKeep = days ? parseInt(days) : 90;

    const deletedCount = await emailConfigService.deleteOldRunLogs(daysToKeep);

    res.json({
      success: true,
      message: `Deleted ${deletedCount} run logs older than ${daysToKeep} days`,
      deletedCount
    });
  } catch (error) {
    console.error('Error cleaning up run logs:', error);
    res.status(500).json({
      error: 'Failed to cleanup run logs',
      message: error.message
    });
  }
});

/**
 * Initialize the email config routes with required services
 * @param {Object} bigQueryService - BigQuery service instance for direct data access
 */
function initializeEmailConfigRoutes(bigQueryService) {
  bigQueryServiceInstance = bigQueryService;
  console.log('✅ Email config routes initialized with BigQuery service');
}

module.exports = {
  router,
  initializeEmailConfigRoutes
};
