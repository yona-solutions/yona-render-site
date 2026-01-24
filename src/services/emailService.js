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
            .header {
              background: linear-gradient(135deg, #3b5998 0%, #2d4373 100%);
              color: white;
              padding: 30px 20px;
              border-radius: 8px 8px 0 0;
              text-align: center;
            }
            .header h1 {
              margin: 0;
              font-size: 24px;
              font-weight: 600;
            }
            .content {
              background: #ffffff;
              padding: 30px 20px;
              border: 1px solid #e0e0e0;
              border-top: none;
            }
            .report-details {
              background: #f8f9fa;
              padding: 20px;
              border-radius: 6px;
              margin: 20px 0;
            }
            .detail-row {
              display: flex;
              justify-content: space-between;
              padding: 8px 0;
              border-bottom: 1px solid #e0e0e0;
            }
            .detail-row:last-child {
              border-bottom: none;
            }
            .detail-label {
              font-weight: 600;
              color: #555;
            }
            .detail-value {
              color: #333;
            }
            .footer {
              background: #f8f9fa;
              padding: 20px;
              border-radius: 0 0 8px 8px;
              text-align: center;
              font-size: 12px;
              color: #666;
              border: 1px solid #e0e0e0;
              border-top: none;
            }
            .attachment-note {
              background: #e3f2fd;
              border-left: 4px solid #2196f3;
              padding: 15px;
              margin: 20px 0;
              border-radius: 4px;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>📊 P&L Report</h1>
          </div>
          
          <div class="content">
            <p>Hello,</p>
            
            <p>Your scheduled P&L report is ready and attached to this email.</p>
            
            <div class="report-details">
              <div class="detail-row">
                <span class="detail-label">Report Name:</span>
                <span class="detail-value">${schedule.template_name}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Type:</span>
                <span class="detail-value">${entityType}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Entity:</span>
                <span class="detail-value">${entityName}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Process:</span>
                <span class="detail-value">${processType}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Report Date:</span>
                <span class="detail-value">${reportDate}</span>
              </div>
            </div>
            
            <div class="attachment-note">
              <strong>📎 Attachment:</strong> The P&L report is attached as a PDF file to this email.
            </div>
            
            <p>If you have any questions about this report, please contact your finance team.</p>
          </div>
          
          <div class="footer">
            <p><strong>Yona Solutions SPHERE</strong></p>
            <p>This is an automated report delivery. Please do not reply to this email.</p>
          </div>
        </body>
        </html>
      `;

      // Create plain text version
      const textContent = `
P&L Report - ${schedule.template_name}

Report Name: ${schedule.template_name}
Type: ${entityType}
Entity: ${entityName}
Process: ${processType}
Report Date: ${reportDate}

Your P&L report is attached as a PDF file.

---
Yona Solutions SPHERE
This is an automated report delivery.
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

