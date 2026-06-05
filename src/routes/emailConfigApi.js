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
const pnlPdfServer = require('../utils/pnlPdfServer');
const {
  buildAttachmentFilename,
  buildReportEmailMessage,
  normalizeEmailTemplateType,
  splitNameParts
} = require('../services/reportEmailTemplateService');

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

function normalizeIntegerArray(values) {
  const rawValues = Array.isArray(values)
    ? values
    : values === undefined || values === null
      ? []
      : [values];

  return [...new Set(
    rawValues
      .map(value => parseInt(value, 10))
      .filter(Number.isFinite)
  )];
}

function normalizeEmailGroupContacts(body = {}) {
  const inputs = Array.isArray(body.contacts)
    ? body.contacts
    : Array.isArray(body.emails)
      ? body.emails.map(email => ({ email }))
      : [];

  const seenEmails = new Set();
  const contacts = [];

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

    const fullName = String(input.name || '').trim();
    const firstName = String(input.first_name || input.firstName || '').trim();
    const lastName = String(input.last_name || input.lastName || '').trim();
    const derivedNames = (!firstName || !lastName) && fullName
      ? splitNameParts(fullName)
      : { firstName: '', lastName: '' };
    const resolvedFirstName = firstName || derivedNames.firstName;
    const resolvedLastName = lastName || derivedNames.lastName;

    contacts.push({
      email,
      name: fullName || [resolvedFirstName, resolvedLastName].filter(Boolean).join(' ').trim() || null,
      first_name: resolvedFirstName || null,
      last_name: resolvedLastName || null
    });
  });

  return contacts;
}

async function getPdfRowHeightSetting() {
  if (!emailConfigService.isAvailable()) {
    return 12.5;
  }

  try {
    const storedValue = await emailConfigService.getGlobalSetting('pdf_row_height');
    const parsed = parseFloat(storedValue);
    return Number.isFinite(parsed) ? parsed : 12.5;
  } catch (error) {
    console.warn('Unable to load PDF row height setting, using default 12.5:', error.message);
    return 12.5;
  }
}

function normalizeReportGroupReports(reports) {
  if (!Array.isArray(reports)) {
    return [];
  }

  return reports.map((report, index) => ({
    id: report?.id || null,
    sort_order: index,
    template_name: String(report?.template_name || '').trim(),
    template_type: String(report?.template_type || '').trim(),
    process: String(report?.process || '').trim(),
    apply_subsidiary_filter_to_detail: Boolean(report?.apply_subsidiary_filter_to_detail),
    service_filter_id: report?.service_filter_id || null,
    service_filter_name: report?.service_filter_name || null,
    customer_tag_filter_id: report?.customer_tag_filter_id || null,
    customer_tag_filter_name: report?.customer_tag_filter_name || null,
    header_subsidiary_id: report?.header_subsidiary_id || null,
    header_subsidiary_name: report?.header_subsidiary_name || null,
    district_id: report?.district_id || null,
    district_name: report?.district_name || null,
    region_id: report?.region_id || null,
    region_name: report?.region_name || null,
    subsidiary_id: report?.subsidiary_id || null,
    subsidiary_name: report?.subsidiary_name || null,
    customer_tag_id: report?.customer_tag_id || null,
    customer_tag_name: report?.customer_tag_name || null
  }));
}

function getLegacyReportFromGroup(group) {
  const templateType = group?.template_type || group?.hierarchy;
  const process = group?.process || group?.report_type;
  if (!templateType || !process) {
    return null;
  }

  return {
    id: group?.report_id || group?.id || null,
    template_name: String(group?.report_template_name || group?.template_name || group?.name || '').trim(),
    template_type: templateType,
    process,
    apply_subsidiary_filter_to_detail: Boolean(group?.apply_subsidiary_filter_to_detail),
    service_filter_id: group?.service_filter_id || null,
    service_filter_name: group?.service_filter_name || null,
    customer_tag_filter_id: group?.customer_tag_filter_id || null,
    customer_tag_filter_name: group?.customer_tag_filter_name || null,
    header_subsidiary_id: group?.header_subsidiary_id || null,
    header_subsidiary_name: group?.header_subsidiary_name || null,
    district_id: group?.district_id || null,
    district_name: group?.district_name || null,
    region_id: group?.region_id || null,
    region_name: group?.region_name || null,
    subsidiary_id: group?.subsidiary_id || null,
    subsidiary_name: group?.subsidiary_name || null,
    customer_tag_id: group?.customer_tag_id || null,
    customer_tag_name: group?.customer_tag_name || null
  };
}

function getReportGroupReports(group) {
  const normalizedReports = normalizeReportGroupReports(group?.reports);
  if (normalizedReports.length > 0) {
    return normalizedReports;
  }

  const legacyReport = getLegacyReportFromGroup(group);
  return legacyReport ? [legacyReport] : [];
}

function buildReportGroupPayload(body = {}) {
  const name = String(body.name || body.template_name || '').trim();

  return {
    name,
    email_template_type: normalizeEmailTemplateType(body.email_template_type),
    tags: normalizeScheduleTags(body.tags) || [],
    email_group_ids: normalizeIntegerArray(body.email_group_ids ?? body.email_group_id),
    reports: getReportGroupReports(body),
    enabled: body.enabled !== undefined ? Boolean(body.enabled) : true,
    frequency: body.frequency || 'monthly',
    day_of_week: body.day_of_week || null,
    day_of_month: body.day_of_month ?? null,
    time_of_day: body.time_of_day || '08:00:00'
  };
}

function validateReportGroupPayload(groupData) {
  if (!groupData.name) {
    return 'Group name is required';
  }

  if (!groupData.email_template_type) {
    return 'Email template type is required';
  }

  if (!Array.isArray(groupData.email_group_ids) || groupData.email_group_ids.length === 0) {
    return 'At least one email group is required';
  }

  if (!Array.isArray(groupData.reports) || groupData.reports.length === 0) {
    return 'At least one P&L is required';
  }

  for (const [index, report] of groupData.reports.entries()) {
    const label = report.template_name || `P&L ${index + 1}`;
    if (!report.template_name) {
      return `P&L ${index + 1} must have a name`;
    }
    if (!report.template_type) {
      return `${label} must have a report type`;
    }
    if (!report.process) {
      return `${label} must have a P&L process`;
    }
    if (!report.header_subsidiary_id) {
      return `${label} must have a subsidiary header`;
    }

    if (report.template_type === 'district' && !report.district_id) {
      return `${label} must have a district selected`;
    }
    if (report.template_type === 'region' && !report.region_id) {
      return `${label} must have a region selected`;
    }
    if (report.template_type === 'subsidiary' && !report.subsidiary_id) {
      return `${label} must have a subsidiary selected`;
    }
    if (report.template_type === 'customer_tag' && !report.subsidiary_id && !report.customer_tag_id) {
      return `${label} must have a subsidiary selected`;
    }
  }

  if (groupData.email_template_type === 'district') {
    if (groupData.reports.length !== 1) {
      return 'District email template type requires exactly one attached P&L';
    }
    if (groupData.reports[0]?.template_type !== 'district') {
      return 'District email template type requires a district P&L';
    }
  }

  if (groupData.email_template_type === 'region') {
    if (groupData.reports.length !== 1) {
      return 'Region email template type requires exactly one attached P&L';
    }
    if (groupData.reports[0]?.template_type !== 'region') {
      return 'Region email template type requires a region P&L';
    }
  }

  if (groupData.email_template_type === 'customer_tag') {
    if (groupData.reports.length !== 1) {
      return 'Customer Tag email template type requires exactly one attached P&L';
    }
    if (groupData.reports[0]?.template_type !== 'customer_tag') {
      return 'Customer Tag email template type requires a customer tag P&L';
    }
  }

  if (groupData.email_template_type === 'multiple_districts') {
    if (groupData.reports.length < 2) {
      return 'Multiple Districts email template type requires at least two attached P&Ls';
    }
    if (groupData.reports.some(report => report?.template_type !== 'district')) {
      return 'Multiple Districts email template type only supports district P&Ls';
    }
  }

  if (groupData.email_template_type === 'subsidiary_dietary') {
    if (groupData.reports.length !== 1) {
      return 'Subsidiary (Dietary Only) email template type requires exactly one attached P&L';
    }
    if (groupData.reports[0]?.template_type !== 'subsidiary') {
      return 'Subsidiary (Dietary Only) email template type requires a subsidiary P&L';
    }
    if (String(groupData.reports[0]?.service_filter_name || '').trim().toLowerCase() !== 'dietary') {
      return 'Subsidiary (Dietary Only) email template type requires the attached P&L to be filtered to Dietary';
    }
  }

  if (groupData.email_template_type === 'subsidiary') {
    if (groupData.reports.length !== 1) {
      return 'Subsidiary (All) email template type requires exactly one attached P&L';
    }
    if (groupData.reports[0]?.template_type !== 'subsidiary') {
      return 'Subsidiary (All) email template type requires a subsidiary P&L';
    }
  }

  return null;
}

function buildGroupedAttachmentFilename(report, entityName, reportDate) {
  return buildAttachmentFilename({
    name: report?.template_name || entityName,
    template_name: report?.template_name || entityName,
    template_type: report?.template_type,
    process: report?.process,
    reports: [report]
  }, reportDate, report);
}

function normalizeBatchMode(mode) {
  return String(mode || '').trim().toLowerCase() === 'generate' ? 'generate' : 'send';
}

function getBatchItemHeartbeatTimeoutMs() {
  const parsed = Number(process.env.REPORT_BATCH_ITEM_STALE_TIMEOUT_MS || 2 * 60 * 1000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2 * 60 * 1000;
}

function createInitialBatchProgressPayload({
  scheduleId = null,
  scheduleName = '',
  mode = 'send',
  reportDate = null,
  emailGroupIds = [],
  recipientCount = 0
} = {}) {
  return {
    scheduleId,
    scheduleName,
    mode,
    reportDate: scheduleReportService.normalizeReportDateValue(reportDate),
    emailGroupIds,
    recipientCount,
    recipientResults: [],
    currentStep: 'validate',
    status: 'queued',
    steps: {
      validate: { status: 'pending', detail: '' },
      fetch_data: { status: 'pending', detail: '' },
      generate_pdf: { status: 'pending', detail: '' },
      send_email: { status: mode === 'generate' ? 'skipped' : 'pending', detail: mode === 'generate' ? 'Generate only run' : '' }
    }
  };
}

function mergeBatchProgressPayload(currentPayload, patch = {}) {
  const merged = {
    ...(currentPayload || {}),
    ...patch
  };

  merged.steps = {
    ...((currentPayload && currentPayload.steps) || {}),
    ...(patch.steps || {})
  };

  if (patch.recipientResults !== undefined) {
    merged.recipientResults = patch.recipientResults;
  } else if (currentPayload?.recipientResults) {
    merged.recipientResults = currentPayload.recipientResults;
  } else {
    merged.recipientResults = [];
  }

  if (patch.emailGroupIds !== undefined) {
    merged.emailGroupIds = patch.emailGroupIds;
  } else if (currentPayload?.emailGroupIds) {
    merged.emailGroupIds = currentPayload.emailGroupIds;
  } else {
    merged.emailGroupIds = [];
  }

  return merged;
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
    const { name, description } = req.body;
    const contacts = normalizeEmailGroupContacts(req.body);

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Group name is required'
      });
    }

    if (contacts.length === 0) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'At least one contact is required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = contacts
      .map(contact => contact.email)
      .filter(email => !emailRegex.test(email));
    
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
        contacts
      });
      console.log(`✅ Created mock email group: ${group.name} (ID: ${group.id})`);
      return res.status(201).json(group);
    }

    const group = await emailConfigService.createEmailGroup({
      name: name.trim(),
      description: description?.trim() || null,
      contacts
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
    const { name, description } = req.body;
    const contactsProvided = req.body.contacts !== undefined || req.body.emails !== undefined;
    const contacts = contactsProvided ? normalizeEmailGroupContacts(req.body) : undefined;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Group name is required'
      });
    }

    if (contactsProvided) {
      if (contacts.length === 0) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'At least one contact is required'
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const invalidEmails = contacts
        .map(contact => contact.email)
        .filter(email => !emailRegex.test(email));
      
      if (invalidEmails.length > 0) {
        return res.status(400).json({
          error: 'Validation failed',
          message: `Invalid email addresses: ${invalidEmails.join(', ')}`
        });
      }
    }

    if (!emailConfigService.isAvailable()) {
      const group = mockEmailData.updateMockEmailGroup(parseInt(id), {
        name: name.trim(),
        description: description?.trim() || null,
        contacts
      });

      if (!group) {
        return res.status(404).json({
          error: 'Email group not found'
        });
      }

      console.log(`✅ Updated mock email group: ${group.name} (ID: ${group.id})`);
      return res.json(group);
    }

    const group = await emailConfigService.updateEmailGroup(parseInt(id), {
      name: name.trim(),
      description: description?.trim() || null,
      contacts
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
    const scheduleData = buildReportGroupPayload(req.body);
    const validationError = validateReportGroupPayload(scheduleData);
    if (validationError) {
      return res.status(400).json({
        error: 'Validation failed',
        message: validationError
      });
    }

    // Use mock data if database not available
    if (!emailConfigService.isAvailable()) {
      const schedule = mockEmailData.createMockReportSchedule(scheduleData);
      console.log(`✅ Created mock report group: ${schedule.name || schedule.template_name} (ID: ${schedule.id})`);
      return res.status(201).json(schedule);
    }

    const schedule = await emailConfigService.createReportSchedule(scheduleData);

    console.log(`✅ Created report group: ${schedule.name || schedule.template_name} (ID: ${schedule.id})`);
    res.status(201).json(schedule);
  } catch (error) {
    console.error('Error creating report group:', error);

    // Handle foreign key constraint (email group doesn't exist)
    if (error.code === '23503') {
      return res.status(400).json({
        error: 'Invalid email group',
        message: 'The specified email group does not exist'
      });
    }

    res.status(500).json({
      error: 'Failed to create report group',
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
    const updateData = buildReportGroupPayload(req.body);
    const validationError = validateReportGroupPayload(updateData);
    if (validationError) {
      return res.status(400).json({
        error: 'Validation failed',
        message: validationError
      });
    }

    // Use mock data if database not available
    if (!emailConfigService.isAvailable()) {
      const schedule = mockEmailData.updateMockReportSchedule(parseInt(id), updateData);
      if (!schedule) {
        return res.status(404).json({ error: 'Report schedule not found' });
      }
      console.log(`✅ Updated mock report group ID: ${id}`);
      return res.json(schedule);
    }

    const schedule = await emailConfigService.updateReportSchedule(parseInt(id), updateData);

    console.log(`✅ Updated report group ID: ${id}`);
    res.json(schedule);
  } catch (error) {
    console.error('Error updating report group:', error);

    if (error.message === 'Report schedule not found') {
      return res.status(404).json({
        error: 'Report group not found'
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
      error: 'Failed to update report group',
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
    const pdfRowHeight = await getPdfRowHeightSetting();
    const {
      entityId,
      entityName,
      reportDate: resolvedReportDate,
      htmlContent,
      pdfBuffer,
      preparedReport
    } = await scheduleReportService.generateSchedulePdf(schedule, {
      reportDate,
      bigQueryService: bigQueryServiceInstance,
      pdfRowHeight
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
        const completedAt = new Date();
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

        await emailConfigService.updateScheduleRunTimestamps(schedule.id, {
          lastRunAt: completedAt,
          lastSentAt: completedAt
        });
        console.log('   Updated last_run_at timestamp');
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
        const completedAt = new Date();
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

        await emailConfigService.updateScheduleRunTimestamps(schedule.id, {
          lastRunAt: completedAt
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

    const recipientList = await scheduleReportService.getScheduleRecipientContacts(schedule);
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
        message: 'Please select a Template Type (District, Region, Subsidiary, or Customer Tag)'
      });
    }

    if (!schedule.process) {
      return res.status(400).json({
        error: 'Missing process type',
        message: 'Please select a Process (Standard or Operational)'
      });
    }

    const pdfRowHeight = await getPdfRowHeightSetting();
    const {
      entityId,
      entityName,
      reportDate: resolvedReportDate,
      pdfBuffer,
      preparedReport
    } = await scheduleReportService.generateSchedulePdf(schedule, {
      reportDate,
      bigQueryService: bigQueryServiceInstance,
      pdfRowHeight
    });

    console.log(`   Using date: ${resolvedReportDate}${reportDate ? ' (user selected)' : ' (latest available)'}`);
    console.log(`   Filtered to ${preparedReport.keptCount} report(s) with non-zero net income`);
    console.log(`   PDF generated: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

    const previewMessage = buildReportEmailMessage(schedule, recipientList[0], resolvedReportDate);
    const subject = previewMessage.subject;
    const filename = buildAttachmentFilename(schedule, resolvedReportDate);

    // Send to all recipients
    console.log(`   Sending to ${recipientList.length} recipients...`);
    let emailsSent = 0;
    let emailsFailed = 0;
    const results = [];

    for (const recipient of recipientList) {
      try {
        await emailService.sendPDFEmail(schedule, pdfBuffer, recipient, resolvedReportDate);
        emailsSent++;
        results.push({ email: recipient.email, name: recipient.name, status: 'sent' });
        console.log(`      ✅ Sent to ${recipient.email}`);
      } catch (sendError) {
        emailsFailed++;
        results.push({ email: recipient.email, name: recipient.name, status: 'failed', error: sendError.message });
        console.error(`      ❌ Failed to send to ${recipient.email}:`, sendError.message);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`   ✅ Complete: ${emailsSent}/${recipientList.length} sent in ${duration}ms`);

    // Log the run
    if (emailConfigService.isAvailable()) {
      const completedAt = new Date();
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
        recipient_emails: recipientList.map(recipient => recipient.email),
        trigger_type: 'manual',
        pdf_size_bytes: pdfBuffer.length,
        duration_ms: duration
      });

      await emailConfigService.updateScheduleRunTimestamps(schedule.id, {
        lastRunAt: completedAt,
        lastSentAt: emailsSent > 0 ? completedAt : null
      });
      console.log('   Updated last_run_at timestamp');
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
 * GET /api/report-schedules/:id/pdf-debug
 * Generate the PDF exactly as the email flow would, return it as a download,
 * and include X-Debug headers showing prepared container count vs PDF page count
 * so we can see where PDFShift is adding extra breaks beyond our pagination.
 */
router.get('/report-schedules/:id/pdf-debug', async (req, res) => {
  try {
    const { id } = req.params;
    const { reportDate } = req.query;

    let schedule;
    if (!emailConfigService.isAvailable()) {
      schedule = mockEmailData.getMockReportSchedule(parseInt(id));
    } else {
      schedule = await emailConfigService.getReportSchedule(parseInt(id));
    }
    if (!schedule) return res.status(404).json({ error: 'Report schedule not found' });

    const pdfRowHeight = await getPdfRowHeightSetting();
    const resolvedDate = await scheduleReportService.resolveReportDate(
      reportDate || null,
      bigQueryServiceInstance
    );

    const htmlContent = await scheduleReportService.fetchScheduleReportHtml(schedule, {
      entityId: scheduleReportService.getScheduleEntity(schedule).entityId,
      reportDate: scheduleReportService.normalizeReportDateValue(resolvedDate)
    });

    const { pdfBuffer, prepared, fullHTML } = await pnlPdfServer.generatePdfBufferFromReportHtml(
      htmlContent, { pdfRowHeight }
    );

    // Count prepared containers
    const preparedContainerCount = (prepared.html.match(/pnl-report-container/g) || []).length;

    // Count PDF pages by scanning for /Type /Page in the PDF binary
    let pdfPageCount = 0;
    const pdfStr = pdfBuffer.toString('binary');
    const pageMatches = pdfStr.match(/\/Type\s*\/Page[^s]/g);
    pdfPageCount = pageMatches ? pageMatches.length : 0;

    // Find containers where PDFShift likely added extra breaks
    // (total PDF pages - prepared containers = extra PDFShift splits)
    const extraBreaks = pdfPageCount - preparedContainerCount;

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="debug_${schedule.template_name.replace(/[^a-z0-9]/gi,'_')}_${resolvedDate}.pdf"`,
      'X-Prepared-Containers': String(preparedContainerCount),
      'X-Kept-Reports': String(prepared.keptCount),
      'X-Pdf-Pages': String(pdfPageCount),
      'X-Extra-Pdfshift-Breaks': String(extraBreaks),
      'X-Raw-Html-Length': String(htmlContent.length),
      'X-Full-Html-Length': String(fullHTML.length),
      'X-Pdf-Row-Height': String(pdfRowHeight),
      'Access-Control-Expose-Headers': 'X-Prepared-Containers,X-Kept-Reports,X-Pdf-Pages,X-Extra-Pdfshift-Breaks,X-Pdf-Row-Height'
    });

    console.log(`📊 pdf-debug for schedule ${id}: ${preparedContainerCount} containers → ${pdfPageCount} PDF pages (${extraBreaks > 0 ? '+'+extraBreaks+' PDFShift extra breaks' : 'clean'})`);
    res.send(pdfBuffer);

  } catch (error) {
    console.error('❌ pdf-debug error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/report-schedules/:id/html-debug
 * Fetch the raw HTML the email path would generate, run it through prepareReportHtml,
 * and return stats + HTML artifacts for comparison with the browser download path.
 * Query params:
 *   reportDate  - optional YYYY-MM-DD date (defaults to latest)
 *   includeHtml - set to "true" to include raw/prepared HTML strings in the response
 */
router.get('/report-schedules/:id/html-debug', async (req, res) => {
  try {
    const { id } = req.params;
    const { reportDate, includeHtml } = req.query;

    let schedule;
    if (!emailConfigService.isAvailable()) {
      schedule = mockEmailData.getMockReportSchedule(parseInt(id));
    } else {
      schedule = await emailConfigService.getReportSchedule(parseInt(id));
    }

    if (!schedule) {
      return res.status(404).json({ error: 'Report schedule not found' });
    }

    const pdfRowHeight = await getPdfRowHeightSetting();
    const resolvedDate = await scheduleReportService.resolveReportDate(
      reportDate || null,
      bigQueryServiceInstance
    );

    const htmlContent = await scheduleReportService.fetchScheduleReportHtml(schedule, {
      entityId: scheduleReportService.getScheduleEntity(schedule).entityId,
      reportDate: scheduleReportService.normalizeReportDateValue(resolvedDate)
    });

    const prepared = pnlPdfServer.prepareReportHtml(htmlContent, { pdfRowHeight });

    function countContainers(html) {
      return (String(html).match(/pnl-report-container/g) || []).length;
    }

    function getContainerStats(html) {
      const doc = (() => {
        try {
          const { JSDOM } = require('jsdom');
          return new JSDOM(`<div id="root">${html}</div>`).window.document;
        } catch (e) {
          return null;
        }
      })();
      if (!doc) return [];
      return Array.from(doc.querySelectorAll('.pnl-report-container')).map(c => {
        const title = (c.querySelector('.pnl-title')?.textContent || '').trim();
        const rows = c.querySelectorAll('tbody tr').length;
        return { title, bodyRows: rows };
      });
    }

    const rawContainerCount = countContainers(htmlContent);
    const preparedContainerCount = countContainers(prepared.html);
    const preparedStats = getContainerStats(prepared.html);

    const response = {
      scheduleId: id,
      templateName: schedule.template_name,
      templateType: schedule.template_type,
      reportDate: resolvedDate,
      pdfRowHeight,
      rawHtmlLength: htmlContent.length,
      preparedHtmlLength: prepared.html.length,
      rawContainerCount,
      preparedContainerCount,
      keptReportCount: prepared.keptCount,
      preparedContainers: preparedStats
    };

    if (includeHtml === 'true') {
      response.rawHtml = htmlContent;
      response.preparedHtml = prepared.html;
    }

    res.json(response);
  } catch (error) {
    console.error('❌ html-debug error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/report-schedules/:id/process
 * Process a single schedule - generate PDF and send to all recipients in email groups
 * Protected by API key authentication for use by Cloud Functions
 */
router.post('/report-schedules/:id/process', requireApiKey, async (req, res) => {
  const startTime = Date.now();
  const { id } = req.params;
  const {
    triggerType = 'scheduled',
    reportDate,
    mode = 'send',
    batchItemId: rawBatchItemId
  } = req.body;
  const normalizedMode = normalizeBatchMode(mode);
  const batchItemId = rawBatchItemId ? parseInt(rawBatchItemId) : null;
  let batchProgress = null;

  const persistBatchProgress = async (patch = {}) => {
    if (!batchItemId || !emailConfigService.isAvailable()) {
      return;
    }

    batchProgress = mergeBatchProgressPayload(batchProgress, patch);
    await emailConfigService.updateReportBatchRunItem(batchItemId, {
      result_payload: batchProgress
    });
  };

  console.log(`\n📧 Processing report group ${id} (trigger: ${triggerType}, mode: ${normalizedMode})`);

  try {
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

    const reportGroupName = schedule.name || schedule.template_name;
    const groupReports = getReportGroupReports(schedule);

    batchProgress = createInitialBatchProgressPayload({
      scheduleId: parseInt(id),
      scheduleName: reportGroupName,
      mode: normalizedMode,
      reportDate
    });
    batchProgress.reportCount = groupReports.length;
    batchProgress.generatedAttachmentCount = 0;
    batchProgress.reportResults = [];

    await persistBatchProgress({
      status: 'running',
      currentStep: 'validate',
      steps: {
        validate: {
          status: 'running',
          detail: 'Checking report group configuration'
        }
      }
    });

    if (schedule.enabled === false) {
      await persistBatchProgress({
        status: 'skipped',
        steps: {
          validate: {
            status: 'failed',
            detail: 'Report group is disabled'
          }
        }
      });
      return res.status(400).json({
        error: 'Report group is disabled',
        scheduleId: parseInt(id),
        scheduleName: reportGroupName,
        status: 'skipped',
        skipReason: 'Report group is disabled'
      });
    }

    if (!groupReports.length) {
      await persistBatchProgress({
        status: 'skipped',
        steps: {
          validate: {
            status: 'failed',
            detail: 'No P&Ls are attached to this report group'
          }
        }
      });
      return res.status(400).json({
        error: 'Invalid report group configuration',
        message: 'Please add at least one P&L to this report group',
        scheduleId: parseInt(id),
        scheduleName: reportGroupName,
        status: 'skipped',
        skipReason: 'No attached P&Ls'
      });
    }

    const emailGroupIds = scheduleReportService.getScheduleEmailGroupIds(schedule);

    if (normalizedMode === 'send' && emailGroupIds.length === 0) {
      await persistBatchProgress({
        status: 'skipped',
        emailGroupIds,
        steps: {
          validate: {
            status: 'failed',
            detail: 'No email groups assigned'
          }
        }
      });
      return res.status(400).json({
        error: 'No email groups assigned',
        scheduleId: parseInt(id),
        scheduleName: reportGroupName,
        status: 'skipped',
        skipReason: 'No email groups assigned'
      });
    }

    if (normalizedMode === 'send' && !emailService.isAvailable()) {
      await persistBatchProgress({
        status: 'failed',
        emailGroupIds,
        steps: {
          validate: {
            status: 'failed',
            detail: 'Email service is not configured'
          }
        }
      });
      return res.status(503).json({
        error: 'Email service not configured',
        message: 'SendGrid API key not configured',
        scheduleId: parseInt(id),
        scheduleName: reportGroupName,
        status: 'error'
      });
    }

    const recipientList = normalizedMode === 'send'
      ? await scheduleReportService.getScheduleRecipientContacts(schedule)
      : [];

    if (normalizedMode === 'send' && recipientList.length === 0) {
      await persistBatchProgress({
        status: 'skipped',
        emailGroupIds,
        recipientCount: 0,
        steps: {
          validate: {
            status: 'failed',
            detail: 'No recipients in email groups'
          }
        }
      });
      return res.status(400).json({
        error: 'No recipients in email groups',
        scheduleId: parseInt(id),
        scheduleName: reportGroupName,
        status: 'skipped',
        skipReason: 'No recipients in email groups'
      });
    }

    console.log(`   Report Group: ${reportGroupName}`);
    console.log(`   Attached P&Ls: ${groupReports.length}`);
    if (normalizedMode === 'send') {
      console.log(`   Recipients: ${recipientList.length}`);
    }

    await persistBatchProgress({
      status: 'running',
      emailGroupIds,
      recipientCount: recipientList.length,
      currentStep: 'fetch_data',
      steps: {
        validate: {
          status: 'success',
          detail: normalizedMode === 'send'
            ? `${groupReports.length} P&L${groupReports.length === 1 ? '' : 's'} • ${emailGroupIds.length} group${emailGroupIds.length === 1 ? '' : 's'} • ${recipientList.length} recipient${recipientList.length === 1 ? '' : 's'}`
            : `${groupReports.length} P&L${groupReports.length === 1 ? '' : 's'} ready for generate-only run`
        },
        fetch_data: {
          status: 'running',
          detail: `Loading P&L 1 of ${groupReports.length}`
        }
      }
    });

    const resolvedReportDate = await scheduleReportService.resolveReportDate(reportDate, bigQueryServiceInstance);
    const normalizedReportDate = scheduleReportService.normalizeReportDateValue(resolvedReportDate);
    const attachments = [];
    const reportResults = [];
    let totalPdfSizeBytes = 0;
    const pdfRowHeight = await getPdfRowHeightSetting();

    console.log(`   Using date: ${normalizedReportDate}${reportDate ? ' (user selected)' : ' (latest available)'}`);

    for (const [index, report] of groupReports.entries()) {
      const reportLabel = report.template_name || `P&L ${index + 1}`;

      await persistBatchProgress({
        reportDate: normalizedReportDate,
        currentStep: 'fetch_data',
        steps: {
          fetch_data: {
            status: 'running',
            detail: `Loading ${reportLabel} (${index + 1} of ${groupReports.length})`
          },
          generate_pdf: {
            status: 'pending',
            detail: ''
          }
        }
      });

      try {
        const reportProgressPrefix = groupReports.length > 1 ? `${reportLabel}: ` : '';
        const {
          entityName,
          pdfBuffer,
          preparedReport
        } = await scheduleReportService.generateSchedulePdf(report, {
          reportDate: normalizedReportDate,
          bigQueryService: bigQueryServiceInstance,
          pdfRowHeight,
          onProgress: batchItemId
            ? async (progressEvent) => {
                const detail = [progressEvent.detail || progressEvent.message]
                  .filter(Boolean)
                  .map(text => `${reportProgressPrefix}${text}`)
                  .join('');

                await persistBatchProgress({
                  reportDate: normalizedReportDate,
                  currentStep: 'fetch_data',
                  steps: {
                    fetch_data: {
                      status: 'running',
                      detail: detail || `Loading ${reportLabel} (${index + 1} of ${groupReports.length})`
                    }
                  }
                });
              }
            : undefined
        });

        const filename = buildGroupedAttachmentFilename(report, entityName, normalizedReportDate);
        attachments.push({
          reportId: report.id,
          template_name: reportLabel,
          label: `${reportLabel} • ${entityName}`,
          entityName,
          filename,
          pdfBuffer
        });
        totalPdfSizeBytes += pdfBuffer.length;

        reportResults.push({
          reportId: report.id,
          templateName: reportLabel,
          entityName,
          filename,
          status: 'success',
          pdfSizeBytes: pdfBuffer.length,
          keptCount: preparedReport.keptCount
        });

        console.log(`   ✓ Generated attachment ${index + 1}/${groupReports.length}: ${filename}`);

        await persistBatchProgress({
          reportDate: normalizedReportDate,
          generatedAttachmentCount: attachments.length,
          reportResults,
          currentStep: 'generate_pdf',
          steps: {
            fetch_data: {
              status: 'success',
              detail: `Loaded ${reportLabel}`
            },
            generate_pdf: {
              status: 'running',
              detail: `Generated ${attachments.length} of ${groupReports.length} attachments`
            }
          }
        });
      } catch (error) {
        console.error(`   ✗ Failed to generate ${reportLabel}:`, error.message);
        reportResults.push({
          reportId: report.id,
          templateName: reportLabel,
          status: 'failed',
          error: error.message
        });

        await persistBatchProgress({
          reportDate: normalizedReportDate,
          generatedAttachmentCount: attachments.length,
          reportResults,
          currentStep: 'generate_pdf',
          steps: {
            fetch_data: {
              status: 'failed',
              detail: `Failed to load ${reportLabel}`
            },
            generate_pdf: {
              status: 'running',
              detail: `Generated ${attachments.length} of ${groupReports.length} attachments`
            }
          }
        });
      }
    }

    const attachmentFailures = reportResults.filter(result => result.status !== 'success').length;
    const allAttachmentsGenerated = attachments.length === groupReports.length;

    let successCount = 0;
    let failCount = 0;
    const recipientResults = [];
    let status = 'success';
    let errorMessage = null;

    await persistBatchProgress({
      reportDate: normalizedReportDate,
      generatedAttachmentCount: attachments.length,
      reportResults,
      currentStep: normalizedMode === 'send' && allAttachmentsGenerated ? 'send_email' : 'generate_pdf',
      steps: {
        generate_pdf: {
          status: allAttachmentsGenerated ? 'success' : 'failed',
          detail: allAttachmentsGenerated
            ? `${attachments.length} attachment${attachments.length === 1 ? '' : 's'} ready`
            : `${attachments.length} of ${groupReports.length} attachments generated`
        },
        ...(normalizedMode === 'generate'
          ? {
              send_email: {
                status: 'skipped',
                detail: 'Generate only run'
              }
            }
          : allAttachmentsGenerated
            ? {
                send_email: {
                  status: 'running',
                  detail: `Sending grouped packet to ${recipientList.length} recipient${recipientList.length === 1 ? '' : 's'}`
                }
              }
            : {
                send_email: {
                  status: 'failed',
                  detail: 'Grouped email not sent because one or more attachments failed'
                }
              })
      }
    });

    if (normalizedMode === 'generate') {
      status = attachmentFailures === 0 ? 'success' : (attachments.length > 0 ? 'partial' : 'failed');
      if (status !== 'success') {
        errorMessage = attachmentFailures === groupReports.length
          ? 'No grouped attachments were generated'
          : `Generated ${attachments.length} of ${groupReports.length} grouped attachments`;
      }
    } else if (!allAttachmentsGenerated) {
      status = attachments.length > 0 ? 'partial' : 'failed';
      errorMessage = attachments.length > 0
        ? `Generated ${attachments.length} of ${groupReports.length} attachments. Grouped email was not sent.`
        : 'No grouped attachments were generated, so the email was not sent.';
    } else {
      console.log(`   Sending grouped emails to ${recipientList.length} recipient(s)...`);

      for (const recipient of recipientList) {
        try {
          await emailService.sendGroupedPDFEmail(schedule, attachments, recipient, normalizedReportDate);
          successCount++;
          recipientResults.push({ email: recipient.email, name: recipient.name, status: 'sent' });
          console.log(`      ✓ Sent grouped packet to ${recipient.email}`);
        } catch (error) {
          failCount++;
          recipientResults.push({ email: recipient.email, name: recipient.name, status: 'failed', error: error.message });
          console.log(`      ✗ Failed: ${recipient.email} - ${error.message}`);
        }

        await persistBatchProgress({
          recipientResults,
          steps: {
            send_email: {
              status: 'running',
              detail: `${successCount} sent • ${failCount} failed of ${recipientList.length}`
            }
          }
        });
      }

      if (successCount === 0) {
        status = 'failed';
        errorMessage = `All ${failCount} grouped email(s) failed to send`;
      } else if (failCount > 0) {
        status = 'partial';
      } else {
        status = 'success';
      }
    }

    await persistBatchProgress({
      status,
      currentStep: status === 'failed' ? 'send_email' : 'complete',
      recipientResults,
      generatedAttachmentCount: attachments.length,
      reportResults,
      steps: {
        send_email: normalizedMode === 'generate'
          ? {
              status: 'skipped',
              detail: 'Generate only run'
            }
          : !allAttachmentsGenerated
            ? {
                status: 'failed',
                detail: errorMessage || 'Grouped email not sent because attachments failed'
              }
          : {
              status: status === 'success' ? 'success' : (status === 'partial' ? 'partial' : 'failed'),
              detail: `${successCount} sent • ${failCount} failed • ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`
            }
      }
    });

    if (emailConfigService.isAvailable()) {
      const completedAt = new Date();
      await emailConfigService.createRunLog({
        schedule_id: schedule.id,
        template_name: reportGroupName,
        template_type: 'report_group',
        process: 'grouped',
        entity_id: null,
        entity_name: null,
        report_date: normalizedReportDate,
        status,
        error_message: errorMessage,
        emails_sent: successCount,
        emails_failed: failCount,
        recipient_emails: recipientList.map(recipient => recipient.email),
        trigger_type: triggerType,
        pdf_size_bytes: totalPdfSizeBytes || null
      });

      await emailConfigService.updateScheduleRunTimestamps(schedule.id, {
        lastRunAt: completedAt,
        lastSentAt: normalizedMode === 'send' && successCount > 0 ? completedAt : null
      });
    }

    const durationMs = Date.now() - startTime;
    if (normalizedMode === 'generate') {
      console.log(`   ✅ Complete: ${attachments.length} grouped attachment(s) generated (${durationMs}ms)`);
    } else {
      console.log(`   ✅ Complete: ${attachments.length} attachment(s), ${successCount} sent, ${failCount} failed (${durationMs}ms)`);
    }

    res.json({
      success: status !== 'failed',
      scheduleId: parseInt(id),
      scheduleName: reportGroupName,
      status,
      mode: normalizedMode,
      emailsSent: successCount,
      emailsFailed: failCount,
      reportDate: normalizedReportDate,
      pdfSizeBytes: totalPdfSizeBytes || null,
      generatedAttachmentCount: attachments.length,
      reportCount: groupReports.length,
      reportResults,
      durationMs,
      error: errorMessage,
      recipients: recipientResults,
      progress: batchProgress
    });

  } catch (error) {
    console.error(`❌ Error processing schedule ${id}:`, error);

    await persistBatchProgress({
      status: 'failed',
      steps: {
        [(batchProgress && batchProgress.currentStep) || 'validate']: {
          status: 'failed',
          detail: error.message
        }
      }
    }).catch(() => null);

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
        error: 'No matching report groups',
        message: `No report groups were found for the tag "${tag}".`
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
      const heartbeatAt = item.updated_at || item.last_attempt_at;
      const heartbeatAgeMs = Date.now() - new Date(heartbeatAt).getTime();
      if (heartbeatAgeMs < getBatchItemHeartbeatTimeoutMs()) {
        res.set('Retry-After', '30');
        return res.status(429).json({
          success: true,
          alreadyProcessing: true,
          status: 'running'
        });
      }

      console.warn(`⚠️  Reclaiming stale batch item ${itemId}; last heartbeat was ${Math.round(heartbeatAgeMs / 1000)}s ago`);
    }

    await emailConfigService.markReportBatchRunStarted(item.batch_run_id);
    await emailConfigService.updateReportBatchRunItem(itemId, {
      status: 'running',
      attempt_count: (item.attempt_count || 0) + 1,
      last_attempt_at: new Date(),
      completed_at: null,
      error_message: null,
      result_payload: createInitialBatchProgressPayload({
        scheduleId: item.schedule_id,
        scheduleName: item.schedule_name,
        mode: item.run_mode,
        reportDate: item.report_date
      })
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
        mode: item.run_mode,
        batchItemId: itemId
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

    const itemStatus = processPayload.status === 'failed'
      ? 'failed'
      : (processPayload.status === 'partial'
          ? 'partial'
          : (processPayload.status === 'skipped' ? 'skipped' : 'success'));

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
