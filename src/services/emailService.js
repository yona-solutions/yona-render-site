/**
 * Email Service Module
 * 
 * Handles email sending via SendGrid API
 * Supports sending P&L reports as PDF attachments
 */

const sgMail = require('@sendgrid/mail');

class EmailService {
  constructor() {
    this.initialized = false;
    this.senderEmail = null;
  }

  /**
   * Initialize SendGrid with API key
   */
  initialize() {
    try {
      const apiKey = process.env.SENDGRID_API_KEY;
      this.senderEmail = process.env.SENDER_EMAIL;

      if (!apiKey || !this.senderEmail) {
        console.warn('⚠️  SendGrid not configured (missing SENDGRID_API_KEY or SENDER_EMAIL)');
        console.warn('   Email sending will be disabled');
        return false;
      }

      sgMail.setApiKey(apiKey);
      this.initialized = true;

      console.log('✅ SendGrid Email Service initialized');
      console.log(`   Sender: ${this.senderEmail}`);

      return true;
    } catch (error) {
      console.error('❌ Failed to initialize SendGrid:', error.message);
      return false;
    }
  }

  /**
   * Check if email service is available
   */
  isAvailable() {
    return this.initialized;
  }

  /**
   * Send P&L report email with PDF attachment
   * 
   * @param {Object} schedule - Report schedule configuration
   * @param {Buffer} pdfBuffer - PDF file as buffer
   * @param {string} recipientEmail - Email address to send to
   * @param {string} reportDate - Report date (formatted)
   * @returns {Promise<Object>} Send result with success status
   */
  async sendPDFEmail(schedule, pdfBuffer, recipientEmail, reportDate) {
    if (!this.isAvailable()) {
      throw new Error('Email service not initialized');
    }

    try {
      // Determine entity name based on template type
      let entityName = '';
      let entityType = '';
      
      switch (schedule.template_type) {
        case 'district':
          entityName = schedule.district_name || schedule.district_id;
          entityType = 'District';
          break;
        case 'region':
          entityName = schedule.region_name || schedule.region_id;
          entityType = 'Region';
          break;
        case 'subsidiary':
          entityName = schedule.subsidiary_name || schedule.subsidiary_id;
          entityType = 'Subsidiary';
          break;
        default:
          entityName = 'Unknown';
          entityType = schedule.template_type;
      }

      const processType = schedule.process === 'standard' ? 'Standard' : 'Operational';
      
      // Create subject line
      const subject = `P&L Report - ${schedule.template_name} - ${reportDate}`;
      
      // Create HTML email body
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
          </style>
        </head>
        <body>
          <p>Hello,</p>

          <p>This is Yona Solutions. Your P&L for <strong>${entityType}: ${entityName}</strong> is ready.</p>

          <p>Please find your ${processType} P&L report for <strong>${reportDate}</strong> attached to this email.</p>

          <p>Best regards,<br>Yona Solutions</p>
        </body>
        </html>
      `;

      // Create plain text version
      const textContent = `
Hello,

This is Yona Solutions. Your P&L for ${entityType}: ${entityName} is ready.

Please find your ${processType} P&L report for ${reportDate} attached to this email.

Best regards,
Yona Solutions
      `.trim();

      // Create filename for PDF attachment
      const filename = `PNL_${entityType}_${entityName.replace(/[^a-zA-Z0-9]/g, '_')}_${reportDate.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;

      // Prepare email message
      const msg = {
        to: recipientEmail,
        from: {
          email: this.senderEmail,
          name: 'Yona Solutions SPHERE'
        },
        subject: subject,
        text: textContent,
        html: htmlContent,
        attachments: [
          {
            content: pdfBuffer.toString('base64'),
            filename: filename,
            type: 'application/pdf',
            disposition: 'attachment'
          }
        ]
      };

      // Send email
      console.log(`📧 Sending email to ${recipientEmail}...`);
      console.log(`   Subject: ${subject}`);
      console.log(`   Attachment: ${filename} (${(pdfBuffer.length / 1024).toFixed(1)} KB)`);

      await sgMail.send(msg);

      console.log(`✅ Email sent successfully to ${recipientEmail}`);

      return {
        success: true,
        recipient: recipientEmail,
        subject: subject,
        filename: filename
      };

    } catch (error) {
      console.error('❌ Failed to send email:', error.message);
      
      // SendGrid specific error handling
      if (error.response) {
        console.error('   SendGrid Error:', error.response.body);
      }

      throw new Error(`Failed to send email: ${error.message}`);
    }
  }
}

// Create singleton instance
const emailService = new EmailService();

module.exports = emailService;

