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
      district_id,
      district_name,
      region_id,
      region_name,
      subsidiary_id,
      subsidiary_name,
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
      district_id: district_id || null,
      district_name: district_name || null,
      region_id: region_id || null,
      region_name: region_name || null,
      subsidiary_id: subsidiary_id || null,
      subsidiary_name: subsidiary_name || null,
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
      'district_id',
      'district_name',
      'region_id',
      'region_name',
      'subsidiary_id',
      'subsidiary_name',
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
    const { recipientEmail } = req.body;

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

    // Get entity ID based on template type
    let entityId, entityName;
    if (schedule.template_type === 'district' && schedule.district_id) {
      entityId = schedule.district_id;
      entityName = schedule.district_name || 'District';
    } else if (schedule.template_type === 'region' && schedule.region_id) {
      entityId = schedule.region_id;
      entityName = schedule.region_name || 'Region';
    } else if (schedule.template_type === 'subsidiary' && schedule.subsidiary_id) {
      entityId = schedule.subsidiary_id;
      entityName = schedule.subsidiary_name || 'Subsidiary';
    } else {
      return res.status(400).json({
        error: 'Invalid schedule configuration',
        message: `Please select a ${schedule.template_type} before sending email`
      });
    }

    console.log(`📧 Generating and sending email for schedule: ${schedule.template_name}`);

    // Get latest available date directly from BigQuery service
    console.log(`   Fetching available dates...`);
    let dates;
    try {
      if (!bigQueryServiceInstance) {
        throw new Error('BigQuery service not initialized');
      }
      dates = await bigQueryServiceInstance.getAvailableDates();
    } catch (err) {
      console.error('Failed to fetch dates:', err.message);
      return res.status(500).json({
        error: 'Failed to fetch dates',
        message: err.message
      });
    }

    if (!dates || !Array.isArray(dates) || dates.length === 0) {
      return res.status(400).json({
        error: 'No P&L data available',
        message: 'Cannot generate report: no data available'
      });
    }

    const latestDate = dates[0].time || dates[0].formatted;
    console.log(`   Using date: ${latestDate}`);

    // Headers for internal server-to-server calls (still needed for P&L data)
    const internalHeaders = process.env.SCHEDULER_API_KEY
      ? { 'X-API-Key': process.env.SCHEDULER_API_KEY }
      : {};

    // Fetch P&L data - use external URL in production, localhost in development
    const baseUrl = process.env.NODE_ENV === 'production'
      ? (process.env.RENDER_EXTERNAL_URL || 'https://yona-render-site.onrender.com')
      : `http://127.0.0.1:${process.env.PORT || 3000}`;
    const dataUrl = `${baseUrl}/api/pl/data?hierarchy=${schedule.template_type}&selectedId=${encodeURIComponent(entityId)}&date=${latestDate}&plType=${schedule.process}`;
    console.log(`   Fetching data from: ${dataUrl}`);

    const controller2 = new AbortController();
    const timeout2 = setTimeout(() => controller2.abort(), 600000); // 10 minutes

    let dataResponse;
    try {
      dataResponse = await fetch(dataUrl, { headers: internalHeaders, signal: controller2.signal });
    } catch (fetchErr) {
      clearTimeout(timeout2);
      console.error('Data fetch error:', fetchErr.message);
      throw new Error(`Network error fetching P&L data: ${fetchErr.message}`);
    }
    clearTimeout(timeout2);

    if (!dataResponse.ok) {
      throw new Error(`Failed to fetch P&L data: ${dataResponse.status}`);
    }

    const jsonData = await dataResponse.json();
    const htmlContent = jsonData.html;
    
    if (!htmlContent || !htmlContent.trim()) {
      return res.status(400).json({
        error: 'No report data available',
        message: 'Cannot generate PDF: no data for selected configuration'
      });
    }

    console.log(`   HTML content length: ${htmlContent.length}`);

    // Filter P&L reports to only include those with non-zero income
    // Using regex instead of JSDOM to avoid memory issues on Render
    console.log(`   Filtering reports with non-zero income...`);

    const filteredHtmlContent = filterReportsWithIncome(htmlContent);
    console.log(`   Filtered HTML length: ${filteredHtmlContent.length}`);

    // Build complete PDF HTML (reuse from download logic)
    console.log(`   Building PDF HTML...`);
    const fullHTML = buildPDFHTML(filteredHtmlContent);
    console.log(`   PDF HTML length: ${fullHTML.length}`);

    console.log(`   Generating PDF via PDFShift...`);

    // Convert to PDF using PDFShift
    const pdfResponse = await fetch('https://api.pdfshift.io/v3/convert/pdf', {
      method: 'POST',
      headers: {
        'X-API-Key': 'sk_3df748acf1ce265988e07e04544b6452ece1b20e',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source: fullHTML,
        landscape: false,
        use_print: true,
        margin: { top: 10, bottom: 10, left: 10, right: 10 }
      })
    });
    
    if (!pdfResponse.ok) {
      throw new Error(`PDF generation failed: ${pdfResponse.status}`);
    }
    
    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
    console.log(`   PDF generated: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

    // Send email with PDF attachment (using recipient from request body)
    console.log(`   Sending to: ${recipientEmail}`);
    let emailSuccess = false;
    let emailError = null;

    try {
      const result = await emailService.sendPDFEmail(schedule, pdfBuffer, recipientEmail, latestDate);
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
          report_date: latestDate,
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
          report_date: latestDate,
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
 * Filter P&L report HTML to only include reports with non-zero income
 * Uses regex instead of JSDOM to avoid memory issues
 */
function filterReportsWithIncome(htmlContent) {
  // Match each pnl-report-container div
  const containerRegex = /<div class="pnl-report-container[^"]*"[\s\S]*?<\/div>\s*(?=<div class="pnl-report-container|$)/g;
  const containers = htmlContent.match(containerRegex) || [];

  if (containers.length === 0) {
    // No containers found, return original content
    return htmlContent;
  }

  // Filter to only containers with non-zero income
  const kept = containers.filter(container => {
    // Look for the Income row and its value
    // Pattern: <td...>Income</td><td...>$X,XXX</td> or similar
    const incomeMatch = container.match(/<td[^>]*>\s*Income\s*<\/td>\s*<td[^>]*>([^<]*)<\/td>/i);

    if (!incomeMatch) {
      // No income row found, keep the report
      return true;
    }

    const valueText = incomeMatch[1].trim();

    // Parse the accounting value
    if (!valueText || valueText === '—' || valueText === '-' || valueText === '$0' || valueText === '$0.00') {
      return false;
    }

    // Remove $ and , and parse
    let cleaned = valueText.replace(/[$,\s]/g, '');
    if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
      cleaned = '-' + cleaned.slice(1, -1);
    }
    const num = parseFloat(cleaned);

    return !isNaN(num) && num !== 0;
  });

  console.log(`   Filtered: ${kept.length} of ${containers.length} reports have non-zero income`);

  if (kept.length === 0) {
    // If all filtered out, keep at least the first one
    return containers[0] || htmlContent;
  }

  return kept.join('\n');
}

// Helper function to build PDF HTML (matches exact styling from frontend download)
function buildPDFHTML(content) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 0;
    }

    .pnl-report-container {
      background: #ffffff;
      font-family: Arial, sans-serif;
      color: #000000;
      width: 100%;
      margin: 0 auto;
      padding: 8px 24px 12px 24px;
      page-break-after: always;
    }

    .pnl-report-container:last-of-type {
      page-break-after: auto !important;
    }

    /* ---------------- Header Styles ---------------- */
    .pnl-report-header {
      text-align: center;
      margin-bottom: 6px;
      padding: 0;
      line-height: 1.2;
    }

    .pnl-report-header .pnl-title {
      font-weight: 700;
      font-size: 13px;
      margin: 0;
      line-height: 1.1;
    }

    .pnl-report-header .pnl-subtitle {
      font-weight: 600;
      font-size: 10px;
      margin: 1px 0 0 0;
      line-height: 1.1;
    }

    .pnl-report-header .pnl-meta,
    .pnl-report-header .meta {
      font-size: 8px;
      line-height: 1.2;
      margin: 0;
    }

    .pnl-divider {
      border: none;
      border-top: 1px solid #ccc;
      margin: 4px 0 6px 0;
    }

    /* ---------------- Table Styles ---------------- */
    .pnl-report-table {
      width: 100%;
      margin: 0 auto;
      border-collapse: collapse;
      font-size: 7.5px;
      background: #ffffff;
      table-layout: auto;
    }

    .pnl-report-table th,
    .pnl-report-table td {
      padding: 2px 2px;
      border: none;
      white-space: nowrap;
      height: 12px;
      line-height: 1.2;
      vertical-align: middle;
    }

    .pnl-report-table th {
      font-weight: 600;
      text-align: center;
      border-bottom: 1px solid #fff;
      background: transparent;
      font-size: 7.5px;
    }

    .pnl-report-table td:first-child,
    .pnl-report-table th:first-child {
      text-align: left;
      white-space: normal;
      word-wrap: break-word;
      max-width: 140px;
      font-size: 7.5px;
    }

    .pnl-report-table td:not(:first-child),
    .pnl-report-table th:not(:first-child) {
      text-align: right;
      font-size: 7.5px;
    }

    /* Centered dashes for empty values - but not for the gap column (7th column) */
    .pnl-report-table td:empty:not(:nth-child(7))::after {
      content: "-";
      display: inline-block;
      text-align: center;
      width: 100%;
      color: #000;
      opacity: 0.8;
    }

    .pnl-report-table td {
      vertical-align: middle;
    }

    @media print {
      .pnl-report-container {
        page-break-after: always;
      }
    }
  </style>
</head>
<body>
  ${content}
</body>
</html>`;
}

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
  const { triggerType = 'scheduled' } = req.body;

  console.log(`\n📧 Processing schedule ${id} (trigger: ${triggerType})`);

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

    // Get entity ID based on template type
    let entityId, entityName;
    if (schedule.template_type === 'district' && schedule.district_id) {
      entityId = schedule.district_id;
      entityName = schedule.district_name || 'District';
    } else if (schedule.template_type === 'region' && schedule.region_id) {
      entityId = schedule.region_id;
      entityName = schedule.region_name || 'Region';
    } else if (schedule.template_type === 'subsidiary' && schedule.subsidiary_id) {
      entityId = schedule.subsidiary_id;
      entityName = schedule.subsidiary_name || 'Subsidiary';
    } else {
      return res.status(400).json({
        error: 'Invalid schedule configuration',
        message: `Please select a ${schedule.template_type} before sending email`,
        scheduleId: parseInt(id),
        scheduleName: schedule.template_name,
        status: 'skipped',
        skipReason: `No ${schedule.template_type} selected`
      });
    }

    // Get all email groups for this schedule
    const emailGroupIds = schedule.email_group_ids || [schedule.email_group_id].filter(Boolean);

    if (emailGroupIds.length === 0) {
      return res.status(400).json({
        error: 'No email groups assigned',
        scheduleId: parseInt(id),
        scheduleName: schedule.template_name,
        status: 'skipped',
        skipReason: 'No email groups assigned'
      });
    }

    // Check if email service is available
    if (!emailService.isAvailable()) {
      return res.status(503).json({
        error: 'Email service not configured',
        message: 'SendGrid API key not configured',
        scheduleId: parseInt(id),
        scheduleName: schedule.template_name,
        status: 'error'
      });
    }

    // Get all recipients from all email groups
    const allRecipients = new Set();
    for (const groupId of emailGroupIds) {
      const contacts = await emailConfigService.getEmailGroupContacts(groupId);
      contacts.forEach(contact => allRecipients.add(contact.email));
    }

    if (allRecipients.size === 0) {
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
    console.log(`   Recipients: ${allRecipients.size}`);

    // Get latest available date directly from BigQuery service
    console.log(`   Fetching available dates...`);
    let dates;
    try {
      if (!bigQueryServiceInstance) {
        throw new Error('BigQuery service not initialized');
      }
      dates = await bigQueryServiceInstance.getAvailableDates();
    } catch (err) {
      console.error('Failed to fetch dates:', err.message);
      return res.status(500).json({
        error: 'Failed to fetch dates',
        message: err.message,
        scheduleId: parseInt(id),
        scheduleName: schedule.template_name,
        status: 'error'
      });
    }

    if (!dates || !Array.isArray(dates) || dates.length === 0) {
      return res.status(400).json({
        error: 'No P&L data available',
        message: 'Cannot generate report: no data available',
        scheduleId: parseInt(id),
        scheduleName: schedule.template_name,
        status: 'error'
      });
    }

    const latestDate = dates[0].time || dates[0].formatted;
    console.log(`   Using date: ${latestDate}`);

    // Headers for internal server-to-server calls (still needed for P&L data)
    const internalHeaders = process.env.SCHEDULER_API_KEY
      ? { 'X-API-Key': process.env.SCHEDULER_API_KEY }
      : {};

    // Fetch P&L data - use external URL in production, localhost in development
    const baseUrl = process.env.NODE_ENV === 'production'
      ? (process.env.RENDER_EXTERNAL_URL || 'https://yona-render-site.onrender.com')
      : `http://127.0.0.1:${process.env.PORT || 3000}`;
    const dataUrl = `${baseUrl}/api/pl/data?hierarchy=${schedule.template_type}&selectedId=${encodeURIComponent(entityId)}&date=${latestDate}&plType=${schedule.process}`;
    console.log(`   Fetching data...`);

    const dataResponse = await fetch(dataUrl, { headers: internalHeaders });

    if (!dataResponse.ok) {
      throw new Error(`Failed to fetch P&L data: ${dataResponse.status}`);
    }

    const jsonData = await dataResponse.json();
    const htmlContent = jsonData.html;

    if (!htmlContent || !htmlContent.trim()) {
      return res.status(400).json({
        error: 'No report data available',
        message: 'Cannot generate PDF: no data for selected configuration',
        scheduleId: parseInt(id),
        scheduleName: schedule.template_name,
        status: 'error'
      });
    }

    // Parse and filter HTML
    const parser = new (require('jsdom').JSDOM)(htmlContent).window.DOMParser;
    const doc = new parser().parseFromString(`<div id="root">${htmlContent}</div>`, "text/html");
    const root = doc.getElementById("root");

    // Helper function to check if a report has non-zero income
    function hasNonZeroIncome(container) {
      const table = container.querySelector("table");
      if (!table) return false;

      const rows = Array.from(table.querySelectorAll("tr"));
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll("td"));
        if (cells.length > 0 && cells[0].textContent.trim() === "Income") {
          if (cells.length > 1) {
            const valueText = cells[1].textContent.trim();
            const numValue = parseAccountingToNumber(valueText);
            return numValue !== 0;
          }
        }
      }
      return false;
    }

    function parseAccountingToNumber(str) {
      if (!str || str === "—" || str === "-") return 0;
      let cleaned = str.replace(/[$,\s]/g, "");
      if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
        cleaned = "-" + cleaned.slice(1, -1);
      }
      const num = parseFloat(cleaned);
      return isNaN(num) ? 0 : num;
    }

    // Filter pages
    const kept = [];
    root.querySelectorAll(".pnl-report-container").forEach(container => {
      if (hasNonZeroIncome(container)) {
        kept.push(container.outerHTML);
      }
    });

    const filteredHtmlContent = kept.length ? kept.join("\n") :
      (root.querySelector(".pnl-report-container")?.outerHTML || htmlContent);

    console.log(`   Filtered to ${kept.length} reports with non-zero income`);

    // Build complete PDF HTML
    const fullHTML = buildPDFHTML(filteredHtmlContent);

    console.log(`   Generating PDF...`);

    // Convert to PDF using PDFShift
    const pdfResponse = await fetch('https://api.pdfshift.io/v3/convert/pdf', {
      method: 'POST',
      headers: {
        'X-API-Key': 'sk_3df748acf1ce265988e07e04544b6452ece1b20e',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source: fullHTML,
        landscape: false,
        use_print: true,
        margin: { top: 10, bottom: 10, left: 10, right: 10 }
      })
    });

    if (!pdfResponse.ok) {
      throw new Error(`PDF generation failed: ${pdfResponse.status}`);
    }

    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
    console.log(`   PDF generated: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

    // Send to all recipients
    let successCount = 0;
    let failCount = 0;
    const recipientResults = [];

    console.log(`   Sending emails to ${allRecipients.size} recipient(s)...`);

    for (const recipientEmail of allRecipients) {
      try {
        await emailService.sendPDFEmail(schedule, pdfBuffer, recipientEmail, latestDate);
        successCount++;
        recipientResults.push({ email: recipientEmail, status: 'sent' });
        console.log(`      ✓ Sent to ${recipientEmail}`);
      } catch (error) {
        failCount++;
        recipientResults.push({ email: recipientEmail, status: 'failed', error: error.message });
        console.log(`      ✗ Failed: ${recipientEmail} - ${error.message}`);
      }
    }

    // Determine status
    let status;
    let errorMessage = null;
    if (successCount === 0) {
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
        report_date: latestDate,
        status: status,
        error_message: errorMessage,
        emails_sent: successCount,
        emails_failed: failCount,
        recipient_emails: Array.from(allRecipients),
        trigger_type: triggerType,
        pdf_size_bytes: pdfBuffer.length
      });

      // Update schedule timestamps
      if (successCount > 0) {
        await emailConfigService.updateScheduleSendTimestamps(schedule.id, new Date(), null, triggerType);
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(`   ✅ Complete: ${successCount} sent, ${failCount} failed (${durationMs}ms)`);

    res.json({
      success: status !== 'failed',
      scheduleId: parseInt(id),
      scheduleName: schedule.template_name,
      status,
      emailsSent: successCount,
      emailsFailed: failCount,
      reportDate: latestDate,
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

/**
 * POST /api/email-scheduler/run-now
 * Manually trigger scheduler and wait for completion
 */
router.post('/email-scheduler/run-now', async (req, res) => {
  try {
    console.log('📧 Manual scheduler trigger requested via API');
    
    // Get stats before running
    const statsBefore = emailSchedulerService.getStats();
    const schedulesProcessedBefore = statsBefore.schedulesProcessed || 0;
    const successBefore = statsBefore.successfulSends;
    const failBefore = statsBefore.failedSends;
    
    // Run scheduler and wait for it to complete (returns array of results)
    const scheduleResults = await emailSchedulerService.runNow();
    
    // Get stats after running
    const statsAfter = emailSchedulerService.getStats();
    const schedulesProcessed = (statsAfter.schedulesProcessed || 0) - schedulesProcessedBefore;
    const successCount = statsAfter.successfulSends - successBefore;
    const failCount = statsAfter.failedSends - failBefore;
    
    console.log(`✅ Manual scheduler run complete: ${schedulesProcessed} schedules, ${successCount} sent, ${failCount} failed`);
    
    // Build errors array from schedule results
    const errors = [];
    const skipped = [];
    scheduleResults.forEach(r => {
      if (r.status === 'error') {
        errors.push(`${r.scheduleName}: ${r.error}`);
      } else if (r.status === 'skipped') {
        skipped.push(`${r.scheduleName}: ${r.skipReason}`);
      }
    });
    
    res.json({
      success: true,
      message: 'Scheduler run completed successfully',
      schedulesProcessed,
      emailsSent: successCount,
      emailsFailed: failCount,
      scheduleResults: scheduleResults, // Detailed per-schedule results
      errors: errors.length > 0 ? errors : (statsAfter.lastError ? [statsAfter.lastError] : []),
      skipped: skipped
    });
  } catch (error) {
    console.error('Error triggering scheduler:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to trigger scheduler',
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

