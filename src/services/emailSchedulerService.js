/**
 * Email Scheduler Service
 * 
 * Automatically sends scheduled P&L reports based on configured schedules.
 * Runs periodically to check for due schedules and sends emails to all recipients.
 */

const cron = require('node-cron');
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
   */
  async processSchedules(forceAll = false) {
    console.log('\n⏰ ======================================');
    console.log(`⏰ Email Scheduler: ${forceAll ? 'Processing ALL schedules' : 'Checking for due schedules'}`);
    console.log('⏰ Time:', new Date().toLocaleString());
    console.log('⏰ ======================================\n');

    this.lastRunTime = new Date();
    this.stats.totalRuns++;

    try {
      // Check if email service is available
      if (!emailService.isAvailable()) {
        console.log('⚠️  Email service not configured (SENDGRID_API_KEY missing)');
        console.log('   Scheduler will continue checking, but emails cannot be sent');
        return;
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
        return;
      }

      schedules.forEach(s => {
        console.log(`   - ${s.template_name} (ID: ${s.id})`);
      });
      console.log('');

      // Process each schedule
      for (const schedule of schedules) {
        await this.processSchedule(schedule);
        this.stats.schedulesProcessed++;
      }

      console.log('\n✅ Scheduler run complete\n');

    } catch (error) {
      console.error('❌ Error in scheduler:', error);
      this.stats.lastError = error.message;
    }
  }

  /**
   * Process a single schedule - send to all recipients in email group
   */
  async processSchedule(schedule) {
    console.log(`\n📋 Processing schedule: ${schedule.template_name} (ID: ${schedule.id})`);
    
    try {
      // Validate schedule configuration
      if (!schedule.template_type || !schedule.process) {
        console.log(`   ⚠️  Skipping: Invalid configuration (missing template_type or process)`);
        return;
      }

      // Get entity ID
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
        console.log(`   ⚠️  Skipping: No entity selected for ${schedule.template_type}`);
        return;
      }

      // Get all email groups for this schedule (now supports multiple groups)
      const emailGroupIds = schedule.email_group_ids || [schedule.email_group_id].filter(Boolean);
      
      if (emailGroupIds.length === 0) {
        console.log(`   ⚠️  Skipping: No email groups assigned`);
        return;
      }

      console.log(`   Type: ${schedule.template_type} - ${entityName}`);
      console.log(`   Process: ${schedule.process}`);
      console.log(`   Email Groups: ${emailGroupIds.length}`);

      // Get all recipients from all email groups
      const allRecipients = new Set();
      for (const groupId of emailGroupIds) {
        const contacts = await emailConfigService.getEmailGroupContacts(groupId);
        contacts.forEach(contact => allRecipients.add(contact.email));
      }

      if (allRecipients.size === 0) {
        console.log(`   ⚠️  Skipping: No recipients in email groups`);
        return;
      }

      console.log(`   Recipients: ${allRecipients.size} total`);

      // Generate the report once (to be sent to all recipients)
      console.log(`   📊 Generating P&L report...`);
      const reportData = await this.generateReport(schedule, entityId);
      
      if (!reportData) {
        console.log(`   ❌ Failed to generate report`);
        this.stats.failedSends++;
        return;
      }

      console.log(`   ✓ Report generated: ${(reportData.pdfBuffer.length / 1024).toFixed(1)} KB`);

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

      // Update schedule timestamps
      if (successCount > 0) {
        await this.updateScheduleTimestamps(schedule);
        console.log(`   ✓ Schedule updated for next run`);
      }

    } catch (error) {
      console.error(`   ❌ Error processing schedule ${schedule.id}:`, error);
      this.stats.failedSends++;
    }
  }

  /**
   * Generate P&L report (HTML and PDF)
   */
  async generateReport(schedule, entityId) {
    try {
      // Get latest available date
      const port = process.env.PORT || 3000;
      const datesResponse = await fetch(`http://localhost:${port}/api/pl/dates`);
      const dates = await datesResponse.json();
      
      if (!dates || dates.length === 0) {
        throw new Error('No P&L data available');
      }

      const latestDate = dates[0].time || dates[0].formatted;

      // Fetch P&L data
      const dataUrl = `http://localhost:${port}/api/pl/data?hierarchy=${schedule.template_type}&selectedId=${encodeURIComponent(entityId)}&date=${latestDate}&plType=${schedule.process}`;
      const dataResponse = await fetch(dataUrl);
      
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
   */
  hasNonZeroIncome(container) {
    const table = container.querySelector("table");
    if (!table) return false;
    
    const rows = Array.from(table.querySelectorAll("tr"));
    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll("td"));
      if (cells.length > 0 && cells[0].textContent.trim() === "Income") {
        if (cells.length > 1) {
          const valueText = cells[1].textContent.trim();
          const numValue = this.parseAccountingToNumber(valueText);
          return numValue !== 0;
        }
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
    body {
      font-family: Arial, sans-serif;
      margin: 0;
      padding: 20px;
      font-size: 11px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 30px;
    }
    th, td {
      padding: 6px 8px;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }
    th {
      background-color: #f5f5f5;
      font-weight: bold;
    }
    .pnl-report-header {
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 2px solid #333;
    }
    .pnl-title {
      font-size: 18px;
      font-weight: bold;
      margin-bottom: 5px;
    }
    .pnl-subtitle {
      font-size: 14px;
      color: #666;
      margin-bottom: 10px;
    }
    .pnl-meta {
      font-size: 10px;
      color: #666;
      margin-bottom: 3px;
    }
    .pnl-report-container {
      page-break-after: always;
      margin-bottom: 30px;
    }
    .pnl-report-container:last-child {
      page-break-after: auto;
    }
    @media print {
      body { margin: 0; padding: 10px; }
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
   */
  async updateScheduleTimestamps(schedule) {
    try {
      const now = new Date();
      const nextSendAt = this.calculateNextSendTime(schedule, now);

      await emailConfigService.updateScheduleSendTimestamps(schedule.id, now, nextSendAt);

    } catch (error) {
      console.error('Error updating schedule timestamps:', error);
    }
  }

  /**
   * Calculate next send time based on frequency
   */
  calculateNextSendTime(schedule, fromDate) {
    const next = new Date(fromDate);
    const [hours, minutes] = (schedule.time_of_day || '08:00').split(':').map(Number);

    switch (schedule.frequency) {
      case 'daily':
        // Next day at scheduled time
        next.setDate(next.getDate() + 1);
        next.setHours(hours, minutes, 0, 0);
        break;

      case 'weekly':
        // Next week on same day
        next.setDate(next.getDate() + 7);
        next.setHours(hours, minutes, 0, 0);
        break;

      case 'monthly':
        // Next month on same day
        next.setMonth(next.getMonth() + 1);
        if (schedule.day_of_month) {
          next.setDate(schedule.day_of_month);
        }
        next.setHours(hours, minutes, 0, 0);
        
        // Handle end of month (e.g., Feb 31 -> Feb 28/29)
        if (next.getDate() !== schedule.day_of_month) {
          // Day doesn't exist in this month, use last day
          next.setDate(0); // Go to last day of previous month
        }
        break;

      default:
        // Default to next day
        next.setDate(next.getDate() + 1);
        next.setHours(hours, minutes, 0, 0);
    }

    return next;
  }

  /**
   * Manually trigger processing (for testing)
   */
  /**
   * Manually run scheduler, processing ALL enabled schedules (not just due ones)
   * This is for manual testing/triggering
   */
  async runNow() {
    console.log('⏰ Manual scheduler trigger - processing ALL enabled schedules...');
    await this.processSchedules(true); // Force process all schedules
  }
}

// Create singleton instance
const schedulerService = new EmailSchedulerService();

module.exports = schedulerService;
