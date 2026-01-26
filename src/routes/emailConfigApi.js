/**
 * Email Configuration API Routes
 * 
 * RESTful API endpoints for managing email groups and report schedules.
 */

const express = require('express');
const router = express.Router();
const emailConfigService = require('../services/emailConfigService');
const mockEmailData = require('../services/mockEmailData');
const emailService = require('../services/emailService');
const bigQueryService = require('../services/bigQueryService');
const emailSchedulerService = require('../services/emailSchedulerService');

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

    // Get latest available date
    const datesResponse = await fetch('http://localhost:' + (process.env.PORT || 3000) + '/api/pl/dates');
    const dates = await datesResponse.json();
    
    if (!dates || dates.length === 0) {
      return res.status(400).json({
        error: 'No P&L data available',
        message: 'Cannot generate report: no data available'
      });
    }

    const latestDate = dates[0].time || dates[0].formatted;
    console.log(`   Using date: ${latestDate}`);

    // Fetch P&L data
    const dataUrl = `http://localhost:${process.env.PORT || 3000}/api/pl/data?hierarchy=${schedule.template_type}&selectedId=${encodeURIComponent(entityId)}&date=${latestDate}&plType=${schedule.process}`;
    console.log(`   Fetching data from: ${dataUrl}`);
    
    const dataResponse = await fetch(dataUrl);
    
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

    // Parse and filter HTML (reuse logic from download)
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

    // Build complete PDF HTML (reuse from download logic)
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

    // Send email with PDF attachment (using recipient from request body)
    console.log(`   Sending to: ${recipientEmail}`);
    const result = await emailService.sendPDFEmail(schedule, pdfBuffer, recipientEmail, latestDate);

    console.log(`✅ Email sent successfully`);

    res.json({
      success: true,
      message: `Email sent successfully to ${result.recipient}`,
      recipient: result.recipient,
      subject: result.subject,
      filename: result.filename
    });

  } catch (error) {
    console.error('❌ Error sending email:', error);
    res.status(500).json({
      error: 'Failed to send email',
      message: error.message
    });
  }
});

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
    
    // Run scheduler and wait for it to complete
    await emailSchedulerService.runNow();
    
    // Get stats after running
    const statsAfter = emailSchedulerService.getStats();
    const schedulesProcessed = (statsAfter.schedulesProcessed || 0) - schedulesProcessedBefore;
    const successCount = statsAfter.successfulSends - successBefore;
    const failCount = statsAfter.failedSends - failBefore;
    
    console.log(`✅ Manual scheduler run complete: ${schedulesProcessed} schedules, ${successCount} sent, ${failCount} failed`);
    
    res.json({
      success: true,
      message: 'Scheduler run completed successfully',
      schedulesProcessed,
      emailsSent: successCount,
      emailsFailed: failCount,
      errors: statsAfter.lastError ? [statsAfter.lastError] : []
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

module.exports = router;

