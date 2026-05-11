/**
 * Email Service Module
 * 
 * Handles email sending via SendGrid API
 * Supports sending P&L reports as PDF attachments
 */

const sgMail = require('@sendgrid/mail');
const {
  buildAttachmentFilename,
  buildReportEmailMessage,
  normalizeRecipientContact
} = require('./reportEmailTemplateService');

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
   * @param {Object|string} recipient - Recipient contact or email
   * @param {string} reportDate - Report date (formatted)
   * @returns {Promise<Object>} Send result with success status
   */
  async sendPDFEmail(schedule, pdfBuffer, recipient, reportDate) {
    if (!this.isAvailable()) {
      throw new Error('Email service not initialized');
    }

    try {
      const normalizedRecipient = normalizeRecipientContact(recipient);
      if (!normalizedRecipient.email) {
        throw new Error('Recipient email is required');
      }

      const emailMessage = buildReportEmailMessage(schedule, normalizedRecipient, reportDate);
      const filename = buildAttachmentFilename(schedule, reportDate);

      // Prepare email message
      const msg = {
        to: normalizedRecipient.email,
        from: {
          email: this.senderEmail,
          name: 'Yona Finance Team'
        },
        subject: emailMessage.subject,
        text: emailMessage.text,
        html: emailMessage.html,
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
      console.log(`📧 Sending email to ${normalizedRecipient.email}...`);
      console.log(`   Subject: ${emailMessage.subject}`);
      console.log(`   Attachment: ${filename} (${(pdfBuffer.length / 1024).toFixed(1)} KB)`);

      await sgMail.send(msg);

      console.log(`✅ Email sent successfully to ${normalizedRecipient.email}`);

      return {
        success: true,
        recipient: normalizedRecipient.email,
        subject: emailMessage.subject,
        filename
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

  /**
   * Send one grouped email containing multiple PDF attachments.
   *
   * @param {Object} reportGroup - Report group configuration
   * @param {Array} attachments - Attachment objects with filename + pdfBuffer
   * @param {Object|string} recipient - Recipient contact or email
   * @param {string} reportDate - Report date (formatted)
   * @returns {Promise<Object>} Send result with success status
   */
  async sendGroupedPDFEmail(reportGroup, attachments, recipient, reportDate) {
    if (!this.isAvailable()) {
      throw new Error('Email service not initialized');
    }

    if (!Array.isArray(attachments) || attachments.length === 0) {
      throw new Error('At least one PDF attachment is required');
    }

    try {
      const normalizedRecipient = normalizeRecipientContact(recipient);
      if (!normalizedRecipient.email) {
        throw new Error('Recipient email is required');
      }

      const emailMessage = buildReportEmailMessage(reportGroup, normalizedRecipient, reportDate);
      const attachmentCount = attachments.length;

      const msg = {
        to: normalizedRecipient.email,
        from: {
          email: this.senderEmail,
          name: 'Yona Finance Team'
        },
        subject: emailMessage.subject,
        text: emailMessage.text,
        html: emailMessage.html,
        attachments: attachments.map(attachment => ({
          content: attachment.pdfBuffer.toString('base64'),
          filename: attachment.filename,
          type: 'application/pdf',
          disposition: 'attachment'
        }))
      };

      console.log(`📧 Sending grouped email to ${normalizedRecipient.email}...`);
      console.log(`   Subject: ${emailMessage.subject}`);
      console.log(`   Attachments: ${attachments.map(attachment => attachment.filename).join(', ')}`);

      await sgMail.send(msg);

      console.log(`✅ Grouped email sent successfully to ${normalizedRecipient.email}`);

      return {
        success: true,
        recipient: normalizedRecipient.email,
        subject: emailMessage.subject,
        attachmentCount
      };
    } catch (error) {
      console.error('❌ Failed to send grouped email:', error.message);
      if (error.response) {
        console.error('   SendGrid Error:', error.response.body);
      }
      throw new Error(`Failed to send grouped email: ${error.message}`);
    }
  }

  /**
   * Send a simple text/HTML email (no attachments)
   *
   * @param {string} to - Recipient email address
   * @param {string} subject - Email subject
   * @param {string} text - Plain text content
   * @param {string} html - HTML content (optional)
   * @returns {Promise<Object>} Send result
   */
  async sendEmail(to, subject, text, html = null) {
    if (!this.isAvailable()) {
      throw new Error('Email service not initialized');
    }

    try {
      const msg = {
        to,
        from: {
          email: this.senderEmail,
          name: 'Yona Solutions SPHERE'
        },
        subject,
        text,
        html: html || text.replace(/\n/g, '<br>')
      };

      console.log(`📧 Sending email to ${to}...`);
      console.log(`   Subject: ${subject}`);

      await sgMail.send(msg);

      console.log(`✅ Email sent successfully to ${to}`);

      return { success: true, recipient: to, subject };

    } catch (error) {
      console.error('❌ Failed to send email:', error.message);
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
