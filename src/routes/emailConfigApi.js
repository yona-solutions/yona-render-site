/**
 * Email Configuration API Routes
 * 
 * RESTful API endpoints for managing email groups and report schedules.
 */

const express = require('express');
const router = express.Router();
const emailConfigService = require('../services/emailConfigService');

// ============================================
// Email Groups API
// ============================================

/**
 * GET /api/email-groups
 * Get all email groups
 */
router.get('/email-groups', async (req, res) => {
  try {
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
 * Create a new report schedule
 */
router.post('/report-schedules', async (req, res) => {
  try {
    const {
      report_type,
      hierarchy,
      entity_id,
      entity_name,
      email_group_id,
      frequency,
      status
    } = req.body;

    // Validation
    if (!report_type || !hierarchy || !entity_id || !email_group_id || !frequency) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Missing required fields'
      });
    }

    // Validate enum values
    const validReportTypes = ['standard', 'operational'];
    const validHierarchies = ['district', 'region', 'subsidiary'];
    const validFrequencies = ['daily', 'weekly', 'monthly'];
    const validStatuses = ['active', 'paused'];

    if (!validReportTypes.includes(report_type)) {
      return res.status(400).json({
        error: 'Validation failed',
        message: `Invalid report type. Must be one of: ${validReportTypes.join(', ')}`
      });
    }

    if (!validHierarchies.includes(hierarchy)) {
      return res.status(400).json({
        error: 'Validation failed',
        message: `Invalid hierarchy. Must be one of: ${validHierarchies.join(', ')}`
      });
    }

    if (!validFrequencies.includes(frequency)) {
      return res.status(400).json({
        error: 'Validation failed',
        message: `Invalid frequency. Must be one of: ${validFrequencies.join(', ')}`
      });
    }

    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        error: 'Validation failed',
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const schedule = await emailConfigService.createReportSchedule({
      report_type,
      hierarchy,
      entity_id,
      entity_name,
      email_group_id: parseInt(email_group_id),
      frequency,
      status: status || 'active'
    });

    console.log(`✅ Created report schedule: ${schedule.report_type} ${schedule.hierarchy} (ID: ${schedule.id})`);
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
 * Update a report schedule
 */
router.put('/report-schedules/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      report_type,
      hierarchy,
      entity_id,
      entity_name,
      email_group_id,
      frequency,
      status
    } = req.body;

    // Validation (same as POST)
    if (!report_type || !hierarchy || !entity_id || !email_group_id || !frequency || !status) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Missing required fields'
      });
    }

    const schedule = await emailConfigService.updateReportSchedule(parseInt(id), {
      report_type,
      hierarchy,
      entity_id,
      entity_name,
      email_group_id: parseInt(email_group_id),
      frequency,
      status
    });

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

