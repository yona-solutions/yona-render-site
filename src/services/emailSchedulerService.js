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

    // Job tracking for manual runs
    this.currentJob = null;
  }

  /**
   * Get current job status (for persistent tracking)
   */
  getJobStatus() {
    if (!this.currentJob) {
      return { running: false };
    }

    return {
      running: this.currentJob.status === 'running',
      jobId: this.currentJob.jobId,
      status: this.currentJob.status,
      startTime: this.currentJob.startTime,
      totalSchedules: this.currentJob.totalSchedules,
      processedSchedules: this.currentJob.processedSchedules,
      currentSchedule: this.currentJob.currentSchedule,
      results: this.currentJob.results,
      emailsSent: this.currentJob.emailsSent,
      emailsFailed: this.currentJob.emailsFailed,
      endTime: this.currentJob.endTime,
      error: this.currentJob.error
    };
  }

  /**
   * Start a new manual job (async - returns immediately)
   * @returns {Object} Job info with jobId, or error if already running
   */
  async startManualRun() {
    // Check if a job is already running
    if (this.currentJob && this.currentJob.status === 'running') {
      return {
        success: false,
        error: 'A job is already running',
        existingJob: this.getJobStatus()
      };
    }

    // Create new job
    const jobId = `job_${Date.now()}`;
    this.currentJob = {
      jobId,
      status: 'running',
      startTime: new Date().toISOString(),
      totalSchedules: 0,
      processedSchedules: 0,
      currentSchedule: null,
      results: [],
      emailsSent: 0,
      emailsFailed: 0,
      endTime: null,
      error: null
    };

    // Start processing in background (don't await)
    this._runJobAsync(jobId).catch(error => {
      console.error('Job error:', error);
      if (this.currentJob && this.currentJob.jobId === jobId) {
        this.currentJob.status = 'error';
        this.currentJob.error = error.message;
        this.currentJob.endTime = new Date().toISOString();
      }
    });

    return {
      success: true,
      jobId,
      message: 'Job started'
    };
  }

  /**
   * Internal async job runner
   */
  async _runJobAsync(jobId) {
    console.log(`\n🚀 Starting manual job ${jobId}...`);

    try {
      // Get all enabled schedules
      let schedules = await emailConfigService.getReportSchedules();
      schedules = schedules.filter(s => s.enabled !== false);

      this.currentJob.totalSchedules = schedules.length;
      console.log(`📧 Found ${schedules.length} enabled schedule(s) to process`);

      if (schedules.length === 0) {
        this.currentJob.status = 'completed';
        this.currentJob.endTime = new Date().toISOString();
        return;
      }

      // Process each schedule
      for (let i = 0; i < schedules.length; i++) {
        const schedule = schedules[i];

        // Check if job was cancelled
        if (this.currentJob.jobId !== jobId || this.currentJob.status !== 'running') {
          console.log('Job cancelled or replaced');
          return;
        }

        this.currentJob.currentSchedule = {
          id: schedule.id,
          name: schedule.template_name,
          index: i + 1
        };

        console.log(`\n📧 Processing schedule ${i + 1}/${schedules.length}: ${schedule.template_name}`);

        const result = await this.processSchedule(schedule, 'manual');
        this.currentJob.results.push(result);
        this.currentJob.processedSchedules = i + 1;

        if (result.status === 'success') {
          this.currentJob.emailsSent += result.emailsSent || 0;
          this.currentJob.emailsFailed += result.emailsFailed || 0;
          this.stats.schedulesProcessed++;
        }
      }

      this.currentJob.status = 'completed';
      this.currentJob.endTime = new Date().toISOString();
      this.currentJob.currentSchedule = null;

      console.log(`\n✅ Job ${jobId} completed: ${this.currentJob.emailsSent} sent, ${this.currentJob.emailsFailed} failed`);

    } catch (error) {
      console.error(`❌ Job ${jobId} failed:`, error);
      this.currentJob.status = 'error';
      this.currentJob.error = error.message;
      this.currentJob.endTime = new Date().toISOString();
    }
  }

  /**
   * Clear completed/failed job (allows starting a new one)
   */
  clearJob() {
    if (this.currentJob && this.currentJob.status !== 'running') {
      this.currentJob = null;
      return { success: true };
    }
    return { success: false, error: 'Cannot clear a running job' };
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
      isRunning: this.isRunning,
      lastRunTime: this.lastRunTime,
      nextRunTime: this.isRunning ? this.getNextRunTime() : null
    };
  }

  /**
   * Main processing function - check and send due schedules
   * @param {boolean} forceAll - If true, process ALL schedules regardless of due date
   * @returns {Array} Array of schedule results with status and details
   */
  async processSchedules(forceAll = false) {
    console.log('\n⏰ ======================================');
    console.log(`⏰ Email Scheduler: ${forceAll ? 'Processing ALL schedules' : 'Checking for due schedules'}`);
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

      // Get schedules to process
      let schedules;
      if (forceAll) {
        // Get ALL enabled schedules
        schedules = await emailConfigService.getReportSchedules();
        schedules = schedules.filter(s => s.enabled !== false);
        console.log(`📧 Found ${schedules.length} enabled schedule(s) to process (forced run)`);
      } else {
        // Get only schedules that are due
        schedules = await emailConfigService.getSchedulesDueForSend();
        console.log(`📧 Found ${schedules.length} schedule(s) due for sending`);
      }
      
      if (schedules.length === 0) {
        console.log('✓ No schedules to process at this time');
        return results;
      }

      schedules.forEach(s => {
        console.log(`   - ${s.template_name} (ID: ${s.id})`);
      });
      console.log('');

      // Process each schedule
      const triggerType = forceAll ? 'manual' : 'scheduled';
      for (const schedule of schedules) {
        const result = await this.processSchedule(schedule, triggerType);
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

      // Get entity ID
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
      const emailGroupIds = schedule.email_group_ids || [schedule.email_group_id].filter(Boolean);

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

      // Get all recipients from all email groups
      for (const groupId of emailGroupIds) {
        const contacts = await emailConfigService.getEmailGroupContacts(groupId);
        contacts.forEach(contact => allRecipients.add(contact.email));
      }

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
      const reportData = await this.generateReport(schedule, entityId);

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
  async generateReport(schedule, entityId) {
    try {
      // Headers for internal server-to-server calls
      const internalHeaders = process.env.SCHEDULER_API_KEY
        ? { 'X-API-Key': process.env.SCHEDULER_API_KEY }
        : {};

      // Use external URL in production, localhost in development
      const port = process.env.PORT || 3000;
      const baseUrl = process.env.NODE_ENV === 'production'
        ? (process.env.RENDER_EXTERNAL_URL || 'https://yona-render-site.onrender.com')
        : `http://127.0.0.1:${port}`;

      // Get latest available date
      const datesResponse = await fetch(`${baseUrl}/api/pl/dates`, {
        headers: internalHeaders
      });

      if (!datesResponse.ok) {
        const errorText = await datesResponse.text();
        console.error('Failed to fetch dates:', datesResponse.status, errorText.substring(0, 200));
        throw new Error(`Failed to fetch dates: ${datesResponse.status}`);
      }

      const dates = await datesResponse.json();

      if (!dates || !Array.isArray(dates) || dates.length === 0) {
        throw new Error(dates?.error || 'No P&L data available');
      }

      const latestDate = dates[0].time || dates[0].formatted;

      // Fetch P&L data
      const dataUrl = `${baseUrl}/api/pl/data?hierarchy=${schedule.template_type}&selectedId=${encodeURIComponent(entityId)}&date=${latestDate}&plType=${schedule.process}`;
      const dataResponse = await fetch(dataUrl, { headers: internalHeaders });
      
      if (!dataResponse.ok) {
        throw new Error(`Failed to fetch P&L data: ${dataResponse.status}`);
      }
      
      const jsonData = await dataResponse.json();
      const htmlContent = jsonData.html;
      
      if (!htmlContent || !htmlContent.trim()) {
        throw new Error('No report data available');
      }

      // Filter HTML for non-zero income (reuse logic from emailConfigApi.js)
      const parser = new (require('jsdom').JSDOM)(htmlContent).window.DOMParser;
      const doc = new parser().parseFromString(`<div id="root">${htmlContent}</div>`, "text/html");
      const root = doc.getElementById("root");
      
      const kept = [];
      root.querySelectorAll(".pnl-report-container").forEach(container => {
        if (this.hasNonZeroIncome(container)) {
          kept.push(container.outerHTML);
        }
      });
      
      const filteredHtmlContent = kept.length ? kept.join("\n") : 
        (root.querySelector(".pnl-report-container")?.outerHTML || htmlContent);

      // Build complete PDF HTML
      const fullHTML = this.buildPDFHTML(filteredHtmlContent);
      
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

      return {
        pdfBuffer,
        date: latestDate
      };

    } catch (error) {
      console.error('Error generating report:', error);
      return null;
    }
  }

  /**
   * Check if a report container has non-zero income
   * Checks BOTH Actuals (cells[1]) and Budget (cells[2])
   * Returns true if EITHER has non-zero income
   */
  hasNonZeroIncome(container) {
    const table = container.querySelector("table");
    if (!table) return false;

    const rows = Array.from(table.querySelectorAll("tr"));
    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll("td"));
      if (cells.length > 0 && cells[0].textContent.trim() === "Income") {
        const actualsValue = cells.length > 1 ? this.parseAccountingToNumber(cells[1].textContent.trim()) : 0;
        const budgetValue = cells.length > 2 ? this.parseAccountingToNumber(cells[2].textContent.trim()) : 0;
        // Keep if EITHER Actuals OR Budget is non-zero
        return actualsValue !== 0 || budgetValue !== 0;
      }
    }
    return false;
  }

  /**
   * Parse accounting format to number
   */
  parseAccountingToNumber(str) {
    if (!str || str === "—" || str === "-") return 0;
    let cleaned = str.replace(/[$,\s]/g, "");
    if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
      cleaned = "-" + cleaned.slice(1, -1);
    }
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  /**
   * Build complete PDF HTML with styles
   */
  buildPDFHTML(content) {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: Arial, sans-serif;
      margin: 0;
      padding: 10px;
      font-size: 9px;
    }
    .pnl-report-container {
      background: #ffffff;
      width: 100%;
      padding: 12px 20px;
      page-break-after: always;
    }
    .pnl-report-container:last-child {
      page-break-after: auto;
    }
    .pnl-report-header {
      text-align: center;
      margin-bottom: 8px;
      padding: 0;
    }
    .pnl-title {
      font-size: 14px;
      font-weight: 700;
      margin: 0 0 2px 0;
    }
    .pnl-subtitle {
      font-size: 11px;
      font-weight: 600;
      color: #444;
      margin: 0 0 4px 0;
    }
    .pnl-meta {
      font-size: 9px;
      color: #666;
      margin: 1px 0;
    }
    .pnl-divider {
      border: none;
      border-top: 1px solid #ccc;
      margin: 6px 0 10px 0;
    }
    .pnl-report-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8px;
      table-layout: auto;
    }
    .pnl-report-table th,
    .pnl-report-table td {
      padding: 3px 4px;
      border: none;
      white-space: nowrap;
      vertical-align: middle;
    }
    .pnl-report-table th {
      font-weight: 600;
      text-align: center;
      font-size: 8px;
    }
    .pnl-report-table td:first-child,
    .pnl-report-table th:first-child {
      text-align: left;
      white-space: normal;
      word-wrap: break-word;
      max-width: 150px;
    }
    .pnl-report-table td:not(:first-child),
    .pnl-report-table th:not(:first-child) {
      text-align: right;
    }
    .pnl-report-table .header-group-row th {
      font-size: 9px;
      padding: 5px 4px;
    }
    .pnl-report-table .header-label-row th {
      font-size: 7px;
      padding: 3px 4px;
      border-bottom: 1px solid #ddd;
    }
    .pnl-report-table .section-header-row td {
      padding-top: 10px;
      padding-bottom: 4px;
    }
    .pnl-report-table td:empty::after {
      content: "-";
      color: #999;
    }
    @media print {
      body { margin: 0; padding: 8px; }
      .pnl-report-container { page-break-after: always; }
    }
  </style>
</head>
<body>
  ${content}
</body>
</html>
    `;
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

      await emailConfigService.updateScheduleSendTimestamps(schedule.id, now, nextSendAt, triggerType);

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

  /**
   * Manually trigger processing (for testing)
   */
  /**
   * Manually run scheduler, processing ALL enabled schedules (not just due ones)
   * This is for manual testing/triggering
   * @returns {Array} Array of schedule results
   */
  async runNow() {
    console.log('⏰ Manual scheduler trigger - processing ALL enabled schedules...');
    return await this.processSchedules(true); // Force process all schedules
  }
}

// Create singleton instance
const schedulerService = new EmailSchedulerService();

module.exports = schedulerService;
