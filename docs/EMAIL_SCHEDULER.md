# Email Scheduler - Automated P&L Report Delivery

## Overview

The Email Scheduler automatically sends P&L reports based on configured schedules. It runs continuously in the background, checking every hour for schedules that are due and sending emails to all configured recipients.

## How It Works

### 1. Automatic Scheduling

The scheduler starts automatically when the server starts:
- **Runs every hour** at minute :05 (1:05, 2:05, 3:05, etc.)
- **Checks for due schedules** where `next_send_at <= NOW` and `status = 'active'`
- **Processes all due schedules** in sequence
- **Updates timestamps** after successful sends

### 2. Email Delivery Process

For each due schedule:

1. **Validates Configuration**
   - Checks that template_type, process, and entity are configured
   - Gets list of all email groups assigned to the schedule
   - Collects all recipient emails from the groups

2. **Generates Report**
   - Fetches latest P&L data from BigQuery
   - Filters for reports with non-zero income
   - Converts HTML to PDF using PDFShift

3. **Sends Emails**
   - Sends PDF attachment to each recipient via SendGrid
   - Tracks success/failure for each send
   - Logs all activity to console

4. **Updates Schedule**
   - Sets `last_sent_at` to current timestamp
   - Calculates `next_send_at` based on frequency:
     - **Daily**: Next day at scheduled time
     - **Weekly**: Same day next week
     - **Monthly**: Same day next month
   - Handles edge cases (e.g., Feb 31 -> Feb 28/29)

## Configuration

### Email Schedule Setup

Configure schedules via the Email Config UI (`/email-config`):

1. **Create Email Groups** (Distribution Lists)
   - Add email addresses
   - Can assign multiple groups to one schedule

2. **Create Report Schedule**
   - **Template Type**: District, Region, or Subsidiary
   - **Process**: Standard or Operational
   - **Entity**: Select specific entity
   - **Email Groups**: Select one or more groups
   - **Frequency**: Monthly, Weekly, or Daily
   - **Timing**: Day and time to send
   - **Status**: Active (will send) or Paused

### Example Schedule

```javascript
{
  id: 1,
  template_name: "West District Monthly Report",
  template_type: "district",
  process: "standard",
  district_id: "west_district",
  district_name: "West District",
  email_group_ids: [1, 2],  // District Managers + Regional Directors
  frequency: "monthly",
  day_of_month: 5,
  time_of_day: "08:00",
  status: "active",
  last_sent_at: "2026-01-05T08:00:00Z",
  next_send_at: "2026-02-05T08:00:00Z"
}
```

**Result**: Every month on the 5th at 8:00 AM, sends West District Standard P&L to all recipients in both email groups.

## API Endpoints

### Check Scheduler Status

```bash
GET /api/email-scheduler/status
```

**Response:**
```json
{
  "isRunning": true,
  "totalRuns": 142,
  "successfulSends": 256,
  "failedSends": 3,
  "lastError": null,
  "lastRunTime": "2026-01-25T14:05:00Z",
  "nextRunTime": "2026-01-25T15:05:00Z"
}
```

### Manually Trigger Scheduler

```bash
POST /api/email-scheduler/run-now
```

Useful for testing without waiting for the next scheduled run.

**Response:**
```json
{
  "success": true,
  "message": "Scheduler triggered manually. Check server logs for progress."
}
```

## Monitoring

### Console Logs

The scheduler provides detailed logging:

```
⏰ ======================================
⏰ Email Scheduler: Checking for due schedules
⏰ Time: 1/25/2026, 2:05:00 PM
⏰ ======================================

📧 Found 2 schedule(s) due for sending:
   - West District Monthly Report (ID: 1)
   - Northeast Region Weekly Report (ID: 2)

📋 Processing schedule: West District Monthly Report (ID: 1)
   Type: district - West District
   Process: standard
   Email Groups: 2
   Recipients: 8 total
   📊 Generating P&L report...
   ✓ Report generated: 245.3 KB
   📧 Sending emails...
      ✓ Sent to john.smith@yona.com
      ✓ Sent to jane.doe@yona.com
      ...
   📊 Results: 8 sent, 0 failed
   ✓ Schedule updated for next run

✅ Scheduler run complete
```

### Statistics Tracking

The scheduler tracks:
- **Total runs**: How many times scheduler has checked for due schedules
- **Successful sends**: Total emails sent successfully
- **Failed sends**: Total emails that failed
- **Last error**: Most recent error message (if any)
- **Last run time**: When scheduler last checked
- **Next run time**: When scheduler will check next

## Frequency Types

### Monthly
- **day_of_month**: 1-31 (which day to send)
- **time_of_day**: HH:MM (what time to send)
- **Example**: Day 5 at 08:00 = 5th of each month at 8:00 AM
- **Edge cases**: If day doesn't exist (e.g., Feb 31), sends on last day of month

### Weekly
- **day_of_week**: Monday-Sunday
- **time_of_day**: HH:MM
- **Example**: Monday at 09:00 = Every Monday at 9:00 AM

### Daily
- **time_of_day**: HH:MM
- **Example**: 07:00 = Every day at 7:00 AM

## Deployment

### Local Development

The scheduler starts automatically when you run:
```bash
npm start
```

Look for this in the logs:
```
⏰ Email scheduler started - will check for due schedules every hour at :05
   Next check: 1/25/2026, 3:05:00 PM
```

### Production (Render)

The scheduler runs automatically in production:
- No additional configuration needed
- Uses same PostgreSQL database for schedules
- Requires SendGrid API key in environment variables
- Logs available in Render dashboard

### Environment Variables

Required:
- `SENDGRID_API_KEY` - For sending emails
- `DATABASE_URL` - PostgreSQL connection (for persistent schedules)
- `GCP_SERVICE_ACCOUNT_KEY` - For fetching P&L data from BigQuery

Optional:
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment mode

## Testing

### 1. Check Scheduler Status

```bash
curl http://localhost:3000/api/email-scheduler/status
```

### 2. Create Test Schedule

1. Go to `/email-config`
2. Create an email group with your test email
3. Create a report schedule:
   - Set `next_send_at` to a past date (forces immediate send)
   - Or manually trigger with API

### 3. Manually Trigger

```bash
curl -X POST http://localhost:3000/api/email-scheduler/run-now
```

Check server logs for detailed progress.

### 4. Verify Email Sent

- Check your email inbox
- Check SendGrid dashboard for delivery status
- Check schedule updated: `last_sent_at` and `next_send_at` should be set

## Error Handling

### Email Service Not Configured
```
⚠️  Email service not configured (SENDGRID_API_KEY missing)
   Scheduler will continue checking, but emails cannot be sent
```

**Solution**: Add `SENDGRID_API_KEY` to environment variables

### Database Not Connected
```
ℹ️  Database not connected - using mock data
   In production, connect PostgreSQL for persistent schedules
```

**Solution**: Add `DATABASE_URL` to environment variables

### Report Generation Failed
```
❌ Failed to generate report for schedule 1
```

**Solution**: Check BigQuery connectivity and data availability

### Email Send Failed
```
✗ Failed to send to john@example.com: Invalid email address
```

**Solution**: Verify email addresses in email groups

## Production Considerations

### 1. Monitoring

Set up monitoring for:
- Failed email sends (check `failedSends` in status)
- Scheduler not running (check `lastRunTime`)
- Email bounce rates (in SendGrid dashboard)

### 2. Error Alerts

Consider adding:
- Email/Slack notifications when sends fail
- Dashboard showing scheduler health
- Retry logic for failed sends

### 3. Performance

The scheduler:
- Generates each report once (even if sending to 50+ recipients)
- Processes schedules sequentially (prevents overload)
- Times out individual operations to prevent hanging
- Runs hourly (can be adjusted in `emailSchedulerService.js`)

### 4. Scalability

For high volume:
- Consider using a queue system (Bull, BullMQ)
- Move to dedicated worker process
- Use job scheduling service (AWS Lambda, Google Cloud Functions)
- Implement rate limiting for email sends

## Troubleshooting

### Emails Not Sending

1. **Check scheduler is running**
   ```bash
   GET /api/email-scheduler/status
   ```
   Verify `isRunning: true`

2. **Check schedule configuration**
   - Visit `/email-config`
   - Verify status is "Active"
   - Verify `next_send_at` is in the past

3. **Check email service**
   - Verify `SENDGRID_API_KEY` is set
   - Check SendGrid dashboard for errors

4. **Check logs**
   - Look for scheduler errors in server logs
   - Check for BigQuery connection issues

### Emails Sending at Wrong Time

1. **Check server timezone**
   ```bash
   date
   ```
   Scheduler uses server's local time

2. **Check schedule timing**
   - Verify `time_of_day` in schedule
   - Verify `day_of_month` or `day_of_week`

3. **Manual trigger to test**
   ```bash
   POST /api/email-scheduler/run-now
   ```

### Duplicate Emails

If multiple emails are sent:
- Check `last_sent_at` and `next_send_at` timestamps
- Verify no duplicate schedules exist
- Check for multiple server instances running

## Summary

The Email Scheduler provides fully automated P&L report delivery:

✅ **Automatic** - Runs continuously without manual intervention  
✅ **Flexible** - Supports daily, weekly, monthly frequencies  
✅ **Scalable** - Handles multiple schedules and recipients  
✅ **Reliable** - Tracks success/failure, updates timestamps  
✅ **Monitorable** - Status API and detailed logging  
✅ **Testable** - Manual trigger for immediate testing  

Once configured, schedules run automatically forever until paused or deleted.
