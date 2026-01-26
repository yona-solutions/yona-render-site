# Monthly Report Sender - Deployment Guide

This Cloud Function sends monthly P&L reports by calling your production API.

## Prerequisites

1. Google Cloud SDK installed (`gcloud` CLI)
2. Access to the `yona-solutions-poc` GCP project
3. Your production API deployed and accessible

## Step 1: Generate an API Key

Generate a secure API key for the Cloud Function to authenticate with your API:

```bash
# Generate a random 32-character API key
openssl rand -hex 32
```

Save this key - you'll need it for both the Cloud Function and your Render environment.

## Step 2: Add API Key to Render

1. Go to your Render dashboard
2. Select your web service
3. Go to "Environment" tab
4. Add a new environment variable:
   - Key: `SCHEDULER_API_KEY`
   - Value: (the key you generated in Step 1)
5. Click "Save Changes" - this will trigger a redeploy

## Step 3: Deploy the Cloud Function

From the `cloud-functions/monthly-report-sender` directory:

```bash
cd cloud-functions/monthly-report-sender

# Deploy the function
gcloud functions deploy monthly-report-sender \
  --gen2 \
  --runtime=nodejs20 \
  --region=us-central1 \
  --source=. \
  --entry-point=sendMonthlyReports \
  --trigger-http \
  --allow-unauthenticated \
  --timeout=540s \
  --memory=512MB \
  --set-env-vars="API_BASE_URL=https://your-app.onrender.com,SCHEDULER_API_KEY=your-api-key-here"
```

Replace:
- `https://your-app.onrender.com` with your actual Render URL
- `your-api-key-here` with the API key from Step 1

## Step 4: Create Cloud Scheduler Job

Create a Cloud Scheduler job to trigger the function monthly:

```bash
# Create the scheduler job (runs on the 1st of each month at 8 AM EST)
gcloud scheduler jobs create http monthly-report-sender-job \
  --location=us-central1 \
  --schedule="0 13 1 * *" \
  --time-zone="America/New_York" \
  --uri="https://us-central1-yona-solutions-poc.cloudfunctions.net/monthly-report-sender" \
  --http-method=POST \
  --headers="Content-Type=application/json" \
  --message-body="{}"
```

**Schedule explanation**: `0 13 1 * *`
- `0` - At minute 0
- `13` - At 1 PM UTC (8 AM EST / 9 AM EDT)
- `1` - On day 1 of the month
- `*` - Every month
- `*` - Every day of week

To change the schedule:
- 15th of month at 9 AM EST: `0 14 15 * *`
- Last day of month: Use `0 13 28-31 * *` with a check in the function

## Step 5: Test the Function

### Manual test via gcloud:
```bash
gcloud functions call monthly-report-sender \
  --region=us-central1 \
  --data='{}'
```

### Manual test via curl:
```bash
curl -X POST \
  "https://us-central1-yona-solutions-poc.cloudfunctions.net/monthly-report-sender" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Force-run the scheduler job:
```bash
gcloud scheduler jobs run monthly-report-sender-job --location=us-central1
```

## Monitoring

### View function logs:
```bash
gcloud functions logs read monthly-report-sender \
  --region=us-central1 \
  --limit=50
```

### View in Cloud Console:
1. Go to Cloud Functions in GCP Console
2. Click on `monthly-report-sender`
3. View "Logs" tab

## Updating the Function

To update after code changes:

```bash
cd cloud-functions/monthly-report-sender

gcloud functions deploy monthly-report-sender \
  --gen2 \
  --runtime=nodejs20 \
  --region=us-central1 \
  --source=. \
  --entry-point=sendMonthlyReports \
  --trigger-http
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `API_BASE_URL` | Base URL of your production API (e.g., `https://your-app.onrender.com`) |
| `SCHEDULER_API_KEY` | Secret API key for authenticating with scheduler endpoints |

## Troubleshooting

### Function timeout
The default timeout is 540 seconds (9 minutes). If you have many schedules, you may need to increase this:
```bash
gcloud functions deploy monthly-report-sender ... --timeout=540s
```

### Authentication errors
1. Verify the `SCHEDULER_API_KEY` matches in both the Cloud Function and Render
2. Check the Render logs for authentication errors
3. Ensure the API key header is being sent correctly

### No schedules processed
1. Verify schedules are enabled in the database
2. Check that schedules have valid template_type, process, and entity configured
3. Verify email groups are assigned and contain recipients

## Cleanup (if needed)

To delete the function and scheduler:
```bash
# Delete scheduler job
gcloud scheduler jobs delete monthly-report-sender-job --location=us-central1

# Delete function
gcloud functions delete monthly-report-sender --region=us-central1
```
