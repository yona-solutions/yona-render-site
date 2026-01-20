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

Then edit `.env` and add your GCP service account key:

```env
GCP_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"yona-solutions-poc",...}
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

