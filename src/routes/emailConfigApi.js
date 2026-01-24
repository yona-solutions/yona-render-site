/**
 * Email Configuration API Routes
 * 
 * RESTful API endpoints for managing email groups and report schedules.
 */

const express = require('express');
const router = express.Router();
const emailConfigService = require('../services/emailConfigService');
const mockEmailData = require('../services/mockEmailData');

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

module.exports = router;

