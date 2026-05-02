/**
 * Email Scheduler Service
 * 
 * Automatically sends scheduled P&L reports based on configured schedules.
 * Runs periodically to check for due schedules and sends emails to all recipients.
 * 
 * IMPORTANT: All schedule times are stored in Eastern Time (EST/EDT) and converted
 * to UTC for server execution. This ensures schedules run at the correct time
 * regardless of server timezone.
 */

const cron = require('node-cron');
const { DateTime } = require('luxon');
const emailConfigService = require('./emailConfigService');
const emailService = require('./emailService');
const scheduleReportService = require('./scheduleReportService');

class EmailSchedulerService {
  constructor() {
    this.isRunning = false;
    this.schedulerTask = null;
    this.lastRunTime = null;
    this.stats = {
      totalRuns: 0,
      schedulesProcessed: 0,
      successfulSends: 0,
      failedSends: 0,
      lastError: null
    };
  }

  /**
   * Start the automated scheduler
   * Runs every hour at minute 5 (e.g., 1:05, 2:05, 3:05, etc.)
   */
  start() {
    if (this.isRunning) {
      console.log('⏰ Email scheduler already running');
      return;
    }

    // Run every hour at minute 5
    // Cron format: minute hour day month day-of-week
    this.schedulerTask = cron.schedule('5 * * * *', async () => {
      await this.processSchedules();
    });

    this.isRunning = true;
    console.log('⏰ Email scheduler started - will check for due schedules every hour at :05');
    console.log('   Next check: ' + this.getNextRunTime());
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this.schedulerTask) {
      this.schedulerTask.stop();
      this.isRunning = false;
      console.log('⏰ Email scheduler stopped');
    }
  }

  /**
   * Get next scheduled run time
   */
  getNextRunTime() {
    const now = new Date();
    const next = new Date(now);
    next.setMinutes(5, 0, 0); // Set to :05:00
    
    // If we're past :05 this hour, go to next hour
    if (now.getMinutes() >= 5) {
      next.setHours(next.getHours() + 1);
    }
    
    return next.toLocaleString();
  }

  /**
   * Get scheduler statistics
   */
  getStats() {
    return {
      ...this.stats,
      schedulerEnabled: process.env.EMAIL_SCHEDULER_ENABLED === 'true',
      isRunning: this.isRunning,
      lastRunTime: this.lastRunTime,
      nextRunTime: this.isRunning ? this.getNextRunTime() : null
    };
  }

  /**
   * Main processing function - check and send due schedules
   * @returns {Array} Array of schedule results with status and details
   */
  async processSchedules() {
    console.log('\n⏰ ======================================');
    console.log('⏰ Email Scheduler: Checking for due schedules');
    console.log('⏰ Time:', new Date().toLocaleString());
    console.log('⏰ ======================================\n');

    this.lastRunTime = new Date();
    this.stats.totalRuns++;

    const results = []; // Track results per schedule

    try {
      // Check if email service is available
      if (!emailService.isAvailable()) {
        console.log('⚠️  Email service not configured (SENDGRID_API_KEY missing)');
        console.log('   Scheduler will continue checking, but emails cannot be sent');
        return results;
      }

      // Check if database is available
      if (!emailConfigService.isAvailable()) {
        console.log('ℹ️  Database not connected - using mock data');
        console.log('   In production, connect PostgreSQL for persistent schedules');
        // Still process mock schedules for testing
      }

      // Get only schedules that are due
      const schedules = await emailConfigService.getSchedulesDueForSend();
      console.log(`📧 Found ${schedules.length} schedule(s) due for sending`);
      
      if (schedules.length === 0) {
        console.log('✓ No schedules to process at this time');
        return results;
      }

      schedules.forEach(s => {
        console.log(`   - ${s.template_name} (ID: ${s.id})`);
      });
      console.log('');

      // Process each schedule
      for (const schedule of schedules) {
        const result = await this.processSchedule(schedule, 'scheduled');
        results.push(result);
        
        if (result.status === 'success') {
          this.stats.schedulesProcessed++;
        }
      }

      console.log('\n✅ Scheduler run complete\n');

    } catch (error) {
      console.error('❌ Error in scheduler:', error);
      this.stats.lastError = error.message;
    }
    
    return results;
  }

  /**
   * Process a single schedule - send to all recipients in email group
   * @param {Object} schedule - The schedule to process
   * @param {string} triggerType - 'scheduled', 'manual', or 'test'
   * @returns {Object} Result object with status, emails sent, and skip/error details
   */
  async processSchedule(schedule, triggerType = 'scheduled') {
    console.log(`\n📋 Processing schedule: ${schedule.template_name} (ID: ${schedule.id})`);

    const result = {
      scheduleId: schedule.id,
      scheduleName: schedule.template_name,
      status: 'pending',
      emailsSent: 0,
      emailsFailed: 0
    };

    // Initialize run log data
    let runLogId = null;
    let entityId, entityName;
    let allRecipients = new Set();
    let reportDate = null;
    let pdfSizeBytes = null;

    try {
      // Validate schedule configuration
      if (!schedule.template_type || !schedule.process) {
        const reason = 'Invalid configuration (missing template_type or process)';
        console.log(`   ⚠️  Skipping: ${reason}`);
        result.status = 'skipped';
        result.skipReason = reason;

        // Log skipped run
        await this.logRun({
          schedule,
          status: 'skipped',
          error_message: reason,
          trigger_type: triggerType
        });

        return result;
      }

      try {
        ({ entityId, entityName } = scheduleReportService.getScheduleEntity(schedule));
      } catch (error) {
        const reason = `No ${schedule.template_type} selected`;
        console.log(`   ⚠️  Skipping: ${reason}`);
        result.status = 'skipped';
        result.skipReason = reason;

        // Log skipped run
        await this.logRun({
          schedule,
          status: 'skipped',
          error_message: reason,
          trigger_type: triggerType
        });

        return result;
      }

      // Get all email groups for this schedule (now supports multiple groups)
      const emailGroupIds = scheduleReportService.getScheduleEmailGroupIds(schedule);

      if (emailGroupIds.length === 0) {
        const reason = 'No email groups assigned';
        console.log(`   ⚠️  Skipping: ${reason}`);
        result.status = 'skipped';
        result.skipReason = reason;

        // Log skipped run
        await this.logRun({
          schedule,
          entity_id: entityId,
          entity_name: entityName,
          status: 'skipped',
          error_message: reason,
          trigger_type: triggerType
        });

        return result;
      }

      console.log(`   Type: ${schedule.template_type} - ${entityName}`);
      console.log(`   Process: ${schedule.process}`);
      console.log(`   Email Groups: ${emailGroupIds.length}`);

      const recipientList = await scheduleReportService.getScheduleRecipients(schedule);
      recipientList.forEach(recipient => allRecipients.add(recipient));

      if (allRecipients.size === 0) {
        const reason = 'No recipients in email groups';
        console.log(`   ⚠️  Skipping: ${reason}`);
        result.status = 'skipped';
        result.skipReason = reason;

        // Log skipped run
        await this.logRun({
          schedule,
          entity_id: entityId,
          entity_name: entityName,
          status: 'skipped',
          error_message: reason,
          trigger_type: triggerType
        });

        return result;
      }

      console.log(`   Recipients: ${allRecipients.size} total`);

      // Generate the report once (to be sent to all recipients)
      console.log(`   📊 Generating P&L report...`);
      const reportData = await this.generateReport(schedule);

      if (!reportData) {
        const errorMsg = 'Failed to generate report';
        console.log(`   ❌ ${errorMsg}`);
        this.stats.failedSends++;
        result.status = 'error';
        result.error = errorMsg;

        // Log failed run
        await this.logRun({
          schedule,
          entity_id: entityId,
          entity_name: entityName,
          status: 'failed',
          error_message: errorMsg,
          recipient_emails: Array.from(allRecipients),
          trigger_type: triggerType
        });

        return result;
      }

      reportDate = reportData.date;
      pdfSizeBytes = reportData.pdfBuffer.length;
      console.log(`   ✓ Report generated: ${(pdfSizeBytes / 1024).toFixed(1)} KB`);

      // Send to all recipients
      let successCount = 0;
      let failCount = 0;

      console.log(`   📧 Sending emails...`);
      for (const recipientEmail of allRecipients) {
        try {
          await emailService.sendPDFEmail(
            schedule,
            reportData.pdfBuffer,
            recipientEmail,
            reportData.date
          );
          successCount++;
          console.log(`      ✓ Sent to ${recipientEmail}`);
        } catch (error) {
          failCount++;
          console.log(`      ✗ Failed to send to ${recipientEmail}: ${error.message}`);
        }
      }

      console.log(`   📊 Results: ${successCount} sent, ${failCount} failed`);

      this.stats.successfulSends += successCount;
      this.stats.failedSends += failCount;

      result.emailsSent = successCount;
      result.emailsFailed = failCount;

      // Determine final status
      if (successCount === 0) {
        result.status = 'failed';
        result.error = `All ${failCount} email(s) failed to send`;
      } else if (failCount > 0) {
        result.status = 'partial';
      } else {
        result.status = 'success';
      }

      // Log the run
      await this.logRun({
        schedule,
        entity_id: entityId,
        entity_name: entityName,
        report_date: reportDate,
        status: result.status,
        error_message: result.error,
        emails_sent: successCount,
        emails_failed: failCount,
        recipient_emails: Array.from(allRecipients),
        trigger_type: triggerType,
        pdf_size_bytes: pdfSizeBytes
      });

      // Update schedule timestamps
      if (successCount > 0) {
        await this.updateScheduleTimestamps(schedule, triggerType);
        console.log(`   ✓ Schedule updated for next run`);
      }

      return result;

    } catch (error) {
      console.error(`   ❌ Error processing schedule ${schedule.id}:`, error);
      this.stats.failedSends++;
      result.status = 'error';
      result.error = error.message;

      // Log failed run
      await this.logRun({
        schedule,
        entity_id: entityId,
        entity_name: entityName,
        report_date: reportDate,
        status: 'failed',
        error_message: error.message,
        recipient_emails: Array.from(allRecipients),
        trigger_type: triggerType,
        pdf_size_bytes: pdfSizeBytes
      });

      return result;
    }
  }

  /**
   * Log a schedule run to the database
   */
  async logRun(data) {
    try {
      if (!emailConfigService.isAvailable()) {
        console.log('   ℹ️  Run log skipped (database not available)');
        return null;
      }

      const logEntry = await emailConfigService.createRunLog({
        schedule_id: data.schedule?.id,
        template_name: data.schedule?.template_name || 'Unknown',
        template_type: data.schedule?.template_type || 'unknown',
        process: data.schedule?.process || 'unknown',
        entity_id: data.entity_id,
        entity_name: data.entity_name,
        report_date: data.report_date,
        status: data.status,
        error_message: data.error_message,
        emails_sent: data.emails_sent || 0,
        emails_failed: data.emails_failed || 0,
        recipient_emails: data.recipient_emails || [],
        trigger_type: data.trigger_type || 'scheduled',
        pdf_size_bytes: data.pdf_size_bytes
      });

      // Update to mark as completed
      if (logEntry) {
        await emailConfigService.updateRunLog(logEntry.id, {
          run_completed_at: new Date()
        });
      }

      console.log(`   📝 Run logged (ID: ${logEntry?.id})`);
      return logEntry;
    } catch (error) {
      console.error('   ⚠️  Failed to log run:', error.message);
      return null;
    }
  }

  /**
   * Generate P&L report (HTML and PDF)
   */
  async generateReport(schedule) {
    try {
      const storedRowHeight = emailConfigService.isAvailable()
        ? await emailConfigService.getGlobalSetting('pdf_row_height')
        : null;
      const parsedRowHeight = parseFloat(storedRowHeight);
      const pdfRowHeight = Number.isFinite(parsedRowHeight) ? parsedRowHeight : 12.5;
      const { pdfBuffer, reportDate } = await scheduleReportService.generateSchedulePdf(schedule, {
        pdfRowHeight
      });

      return {
        pdfBuffer,
        date: reportDate
      };

    } catch (error) {
      console.error('Error generating report:', error);
      return null;
    }
  }

  /**
   * Update schedule timestamps after successful send
   * @param {Object} schedule - The schedule object
   * @param {string} triggerType - 'manual' or 'scheduled'
   */
  async updateScheduleTimestamps(schedule, triggerType = 'scheduled') {
    try {
      const now = new Date();
      const nextSendAt = this.calculateNextSendTime(schedule, now);

      await emailConfigService.updateScheduleRunTimestamps(schedule.id, {
        lastRunAt: now,
        lastSentAt: now,
        nextSendAt
      });

    } catch (error) {
      console.error('Error updating schedule timestamps:', error);
    }
  }

  /**
   * Calculate next send time based on frequency
   * NOTE: All times are treated as Eastern Time (EST/EDT) and converted to UTC
   * @param {Object} schedule - The schedule object with frequency, day_of_month, time_of_day
   * @param {Date} fromDate - The date to calculate from (in UTC)
   * @returns {Date} The next send time in UTC
   */
  calculateNextSendTime(schedule, fromDate) {
    // Parse the scheduled time (stored as EST)
    const [hours, minutes] = (schedule.time_of_day || '08:00').split(':').map(Number);
    
    // Convert fromDate to Eastern Time
    const nowEST = DateTime.fromJSDate(fromDate).setZone('America/New_York');
    
    let nextEST;

    switch (schedule.frequency) {
      case 'daily':
        // Next day at scheduled time (EST)
        nextEST = nowEST.plus({ days: 1 }).set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
        break;

      case 'weekly':
        // Next week on same day (EST)
        nextEST = nowEST.plus({ weeks: 1 }).set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
        break;

      case 'monthly':
        // Next month on specified day (EST)
        const targetDay = schedule.day_of_month || nowEST.day;
        
        // Start with next month
        nextEST = nowEST.plus({ months: 1 }).set({ 
          day: 1,  // Start with first of month
          hour: hours, 
          minute: minutes, 
          second: 0, 
          millisecond: 0 
        });
        
        // Try to set the target day
        try {
          nextEST = nextEST.set({ day: targetDay });
        } catch (e) {
          // Day doesn't exist in this month (e.g., Feb 31)
          // Use last day of month
          nextEST = nextEST.endOf('month').set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
        }
        break;

      default:
        // Default to tomorrow (EST)
        nextEST = nowEST.plus({ days: 1 }).set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
    }

    // Convert EST time to UTC for storage
    const nextUTC = nextEST.toUTC();
    
    // Log for debugging (can remove later)
    console.log(`   📅 Next send time calculated:`);
    console.log(`      EST: ${nextEST.toFormat('yyyy-MM-dd HH:mm:ss ZZZZ')}`);
    console.log(`      UTC: ${nextUTC.toFormat('yyyy-MM-dd HH:mm:ss ZZZZ')}`);
    
    // Return as JavaScript Date object
    return nextUTC.toJSDate();
  }

}

// Create singleton instance
const schedulerService = new EmailSchedulerService();

module.exports = schedulerService;
