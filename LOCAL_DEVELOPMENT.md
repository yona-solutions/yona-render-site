# Local Development Guide

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Set Up Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Then edit `.env` and add your GCP service account key and Render API key:

```env
GCP_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"yona-solutions-poc",...}

# Render API Configuration
RENDER_API_KEY=rnd_xxxxxxxxxxxxxxxxxxxxx
```

**Note:** The entire JSON content from `gcp-service-account-key.json` should be on one line, or you can use the file directly:

```bash
# Option 1: Copy the JSON content to .env (all on one line)
echo "GCP_SERVICE_ACCOUNT_KEY=$(cat gcp-service-account-key.json | tr -d '\n')" > .env

# Option 2: Or manually copy from gcp-service-account-key.json
cat gcp-service-account-key.json
# Then paste into .env file
```

### 3. Start the Development Server

```bash
npm start
```

The server will start on http://localhost:3000

### 4. Access the Application

- **P&L View (Home):** http://localhost:3000
- **Storage Browser:** http://localhost:3000/storage-browser
- **Health Check API:** http://localhost:3000/api/health
- **Storage List API:** http://localhost:3000/api/storage/list

## Development Workflow

1. **Make changes** to your code
2. **Stop the server** (Ctrl+C)
3. **Restart** with `npm start`
4. **Test** at http://localhost:3000

## Hot Reload (Optional)

For automatic restarts when files change, install nodemon:

```bash
npm install --save-dev nodemon
```

Then add to `package.json`:

```json
"scripts": {
  "start": "node server.js",
  "dev": "nodemon server.js"
}
```

Run with:
```bash
npm run dev
```

## Deploying to Render

Once you've tested your changes locally and pushed them to GitHub, you can deploy to Render:

### Manual Deployment

```bash
./deploy.sh
```

This script will:
1. Load the `RENDER_API_KEY` from your `.env` file
2. Trigger a deployment on Render
3. Monitor the deployment status
4. Notify you when it's live

### Auto-Deploy

The service is configured for auto-deploy, so pushing to the `main` branch on GitHub will automatically trigger a deployment.

```bash
git add -A
git commit -m "Your commit message"
git push origin main
# Render will automatically deploy your changes
```

## Troubleshooting

### Port Already in Use
If port 3000 is taken, set a different port:
```bash
PORT=3001 npm start
```

### GCP Authentication Errors
Make sure your `.env` file has the correct JSON format for `GCP_SERVICE_ACCOUNT_KEY`

### Changes Not Showing
Remember to restart the server after making changes (unless using nodemon)

### Render Deployment Issues
- Check the dashboard: https://dashboard.render.com/web/srv-d5ndl4pr0fns73fh5b4g
- Verify your `RENDER_API_KEY` is correct in `.env`
- Check deployment logs on the Render dashboard

