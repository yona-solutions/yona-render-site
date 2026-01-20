# Developer Guide

Quick reference for developers working on this project.

## 🗺️ Code Navigation

### Where to Find Things

| What You Need | Where to Look |
|--------------|---------------|
| **Add new API endpoint** | `src/routes/api.js` |
| **Add new HTML page** | `public/` directory |
| **Add route for new page** | `src/routes/views.js` |
| **Add GCP Storage logic** | `src/services/storageService.js` |
| **Add BigQuery logic** | `src/services/bigQueryService.js` |
| **Initialize new GCP service** | `src/config/gcp.js` |
| **Add Express middleware** | `src/config/express.js` |
| **Modify app startup** | `server.js` or `src/app.js` |
| **Add dependencies** | `package.json` |
| **Configure deployment** | `render.yaml` |

### Key Files by Purpose

#### Backend Core
- `server.js` - Application entry point
- `src/app.js` - Express app setup, route registration
- `src/config/gcp.js` - GCP service initialization (Storage, BigQuery)
- `src/config/express.js` - Middleware configuration

#### API Layer
- `src/routes/api.js` - All REST API endpoints
- `src/routes/views.js` - HTML page routes

#### Business Logic
- `src/services/storageService.js` - GCP Storage operations, hierarchy parsing
- `src/services/bigQueryService.js` - BigQuery queries

#### Frontend
- `public/pl-view.html` - P&L dashboard with hierarchy toggles
- `public/storage-browser.html` - GCP Storage file browser

#### Documentation
- `README.md` - Project overview, quick start
- `docs/ARCHITECTURE.md` - System architecture
- `docs/HIERARCHY_SYSTEM.md` - Hierarchy implementation details
- `docs/DEVELOPER_GUIDE.md` - This file
- `LOCAL_DEVELOPMENT.md` - Local dev setup

## 🔧 Common Tasks

### Add a New Hierarchy Type

1. **Add configuration file** to GCP Storage bucket `dimension_configurations`

2. **Create service method** in `src/services/storageService.js`:
```javascript
async getNewHierarchy() {
  const configData = await this.getFileAsJson('new_config.json');
  
  const items = [];
  for (const [id, config] of Object.entries(configData)) {
    if (/* your filter logic */) {
      items.push({
        id: id,
        label: config.label,
        type: 'new_type'
      });
    }
  }
  
  items.sort((a, b) => a.label.localeCompare(b.label));
  return items;
}
```

3. **Add API endpoint** in `src/routes/api.js`:
```javascript
router.get('/storage/new-hierarchy', async (req, res) => {
  try {
    const items = await storageService.getNewHierarchy();
    res.json(items);
  } catch (error) {
    console.error('Error fetching new hierarchy:', error);
    res.status(500).json({ 
      error: error.message,
      code: 'NEW_HIERARCHY_FETCH_ERROR'
    });
  }
});
```

4. **Add tab** in `public/pl-view.html`:
```html
<button class="tab">New Hierarchy</button>
```

5. **Update endpoint map** in `public/pl-view.html` (loadHierarchyOptions function):
```javascript
const endpointMap = {
  'district': '/api/storage/districts',
  'region': '/api/storage/regions',
  'subsidiary': '/api/storage/departments',
  'new hierarchy': '/api/storage/new-hierarchy'  // Add this
};
```

### Add a New API Endpoint

1. **Define route** in `src/routes/api.js`:
```javascript
/**
 * Brief description of endpoint
 * 
 * GET /api/your-endpoint
 * 
 * Response:
 *   { your: "data" }
 */
router.get('/your-endpoint', async (req, res) => {
  try {
    // Your logic here
    const data = await someService.getData();
    res.json(data);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      error: error.message,
      code: 'YOUR_ERROR_CODE'
    });
  }
});
```

2. **Add business logic** in appropriate service file (`src/services/`)

3. **Test endpoint**:
```bash
curl http://localhost:3000/api/your-endpoint
```

4. **Update documentation** in `README.md`

### Add a New Page

1. **Create HTML file** in `public/` directory:
```html
<!-- public/your-page.html -->
<!DOCTYPE html>
<html>
<head>
  <title>Your Page</title>
  <style>
    /* Your styles */
  </style>
</head>
<body>
  <h1>Your Page</h1>
  <script>
    // Your JavaScript
  </script>
</body>
</html>
```

2. **Add route** in `src/routes/views.js`:
```javascript
router.get('/your-page', (req, res) => {
  res.sendFile('your-page.html', { root: 'public' });
});
```

3. **Add navigation link** in existing pages (if needed)

### Add a BigQuery Query

1. **Add method** in `src/services/bigQueryService.js`:
```javascript
/**
 * Brief description of query
 * 
 * @returns {Promise<Array>} Query results
 */
async yourQuery() {
  const query = `
    SELECT column1, column2
    FROM your_table
    WHERE condition
    ORDER BY column1 DESC;
  `;

  try {
    const [job] = await this.bigquery.createQueryJob({ query });
    const [rows] = await job.getQueryResults();
    return rows.map(row => ({
      field1: row.column1,
      field2: row.column2
    }));
  } catch (error) {
    console.error('Error executing query:', error);
    throw new Error('Failed to execute query.');
  }
}
```

2. **Add API endpoint** in `src/routes/api.js` to expose the query

3. **Call from frontend** using `fetch()`

## 🧪 Testing

### Test API Endpoints

```bash
# Health check
curl http://localhost:3000/api/health

# Get districts
curl http://localhost:3000/api/storage/districts | jq

# Get regions
curl http://localhost:3000/api/storage/regions | jq

# Get departments
curl http://localhost:3000/api/storage/departments | jq

# Get available dates
curl http://localhost:3000/api/pl/dates | jq
```

### Test Hierarchy Switching

1. Open http://localhost:3000
2. Click District/Region/Subsidiary tabs
3. Check browser console for logs
4. Verify dropdown updates with correct data

### Test Local Changes

```bash
# Kill existing server
lsof -ti:3000 | xargs kill -9

# Restart server
npm start

# Or use the restart script
./restart.sh
```

## 📝 Code Style

### JSDoc Comments

All functions should have JSDoc comments:

```javascript
/**
 * Brief description
 * 
 * Detailed description if needed.
 * 
 * @param {Type} paramName - Description
 * @returns {Promise<Type>} Description
 * @throws {Error} When error occurs
 */
async function yourFunction(paramName) {
  // Implementation
}
```

### Error Handling

Always use try-catch for async operations:

```javascript
try {
  const data = await someAsyncOperation();
  return data;
} catch (error) {
  console.error('Error doing X:', error);
  throw new Error('Failed to do X.');
}
```

### API Response Format

Consistent response formats:

```javascript
// Success
res.json({ data: [...] });

// Error
res.status(500).json({ 
  error: 'Human-readable message',
  code: 'ERROR_CODE'
});
```

## 🐛 Debugging

### View Server Logs

**Local:**
```bash
# Logs appear in terminal where npm start runs
npm start
```

**Production (Render):**
- Go to Render dashboard
- Select your service
- Click "Logs" tab

### Common Issues

**Port in use:**
```bash
lsof -ti:3000 | xargs kill -9
```

**GCP authentication fails:**
- Check `.env` file exists and has valid JSON
- Verify `GCP_SERVICE_ACCOUNT_KEY` is set correctly

**API returns 500:**
- Check server logs for stack trace
- Verify GCP service account has correct permissions
- Test query directly in BigQuery console

**Hierarchy dropdown empty:**
- Check API endpoint returns 200
- Verify response is valid JSON array
- Check browser console for errors

## 🚀 Deployment

### To Production (Render)

```bash
git add .
git commit -m "Your commit message"
git push origin main
```

Render will automatically:
1. Detect the push
2. Run `npm install`
3. Run `npm start`
4. Deploy to production

### Environment Variables

Production environment variables are set in Render dashboard:
- `GCP_SERVICE_ACCOUNT_KEY` - GCP credentials (JSON string)
- `PORT` - Automatically set by Render
- `NODE_ENV` - Set to "production"

## 📊 Data Flow

### Hierarchy Data Flow

```
User clicks tab
    ↓
Tab click handler (pl-view.html)
    ↓
loadHierarchyOptions(hierarchyType)
    ↓
fetch('/api/storage/' + hierarchyType)
    ↓
API route handler (src/routes/api.js)
    ↓
Service method (src/services/storageService.js)
    ↓
GCP Storage API
    ↓
Parse & filter config file
    ↓
Return JSON array
    ↓
Update dropdown in UI
```

### BigQuery Data Flow

```
Page loads
    ↓
loadAvailableDates() (pl-view.html)
    ↓
fetch('/api/pl/dates')
    ↓
API route handler (src/routes/api.js)
    ↓
bigQueryService.getAvailableDates()
    ↓
Execute BigQuery query
    ↓
Return formatted results
    ↓
Populate month dropdown
```

## 🔒 Security Best Practices

1. **Never commit credentials**
   - Use `.gitignore` for `.env` and key files
   - Store credentials as environment variables

2. **Validate inputs**
   - Check query parameters
   - Sanitize user inputs

3. **Handle errors gracefully**
   - Don't expose internal errors to clients
   - Log detailed errors server-side

4. **Use least privilege**
   - GCP service account should have minimal permissions
   - Read-only access where possible

## 📚 Learning Resources

### GCP
- [Cloud Storage Node.js Docs](https://cloud.google.com/nodejs/docs/reference/storage/latest)
- [BigQuery Node.js Docs](https://cloud.google.com/nodejs/docs/reference/bigquery/latest)

### Express.js
- [Express.js Guide](https://expressjs.com/en/guide/routing.html)
- [Express.js API Reference](https://expressjs.com/en/4x/api.html)

### Node.js
- [Node.js Documentation](https://nodejs.org/docs/latest/api/)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)

## 🆘 Getting Help

1. **Check documentation** in `docs/` folder
2. **Review error logs** in terminal or Render dashboard
3. **Test API directly** using curl/Postman
4. **Check GCP console** for service account permissions
5. **Contact team** for additional support

---

**Last Updated:** January 2026

