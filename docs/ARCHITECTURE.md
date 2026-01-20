# Application Architecture

## Overview

This is a Node.js/Express web application deployed on Render, providing P&L reporting views and GCP Storage integration.

## Technology Stack

- **Runtime**: Node.js v18+
- **Framework**: Express.js
- **Cloud Platform**: Google Cloud Platform (GCP)
- **Deployment**: Render
- **Storage**: GCP Cloud Storage

## Project Structure

```
yona_render_site/
├── src/                          # Source code
│   ├── app.js                    # Application setup & configuration
│   ├── config/                   # Configuration modules
│   │   ├── express.js            # Express middleware configuration
│   │   └── gcp.js                # GCP client initialization
│   ├── routes/                   # Route definitions
│   │   ├── api.js                # API endpoints
│   │   └── views.js              # HTML view routes
│   ├── services/                 # Business logic layer
│   │   ├── storageService.js     # GCP Storage operations
│   │   ├── bigQueryService.js    # GCP BigQuery operations
│   │   ├── accountService.js     # Account hierarchy & rollup logic
│   │   └── pnlRenderService.js   # P&L HTML rendering
│   ├── middleware/               # Custom middleware (future)
│   └── utils/                    # Utility functions (future)
├── public/                       # Static files (HTML, CSS, JS)
│   ├── pl-view.html              # P&L reporting dashboard
│   └── storage-browser.html      # GCP Storage file browser
├── docs/                         # Documentation
│   ├── ARCHITECTURE.md           # This file
│   └── HIERARCHY_SYSTEM.md       # Hierarchy system documentation
├── server.js                     # Application entry point
├── package.json                  # Dependencies & scripts
├── render.yaml                   # Render deployment configuration
├── LOCAL_DEVELOPMENT.md          # Local dev setup guide
├── setup-local.sh                # Local setup script
├── restart.sh                    # Server restart script
└── README.md                     # Project overview

```

## Architecture Layers

### 1. Entry Point (`server.js`)
- Loads environment variables
- Creates Express application
- Starts HTTP server
- Handles graceful shutdown

### 2. Application Layer (`src/app.js`)
- Initializes services
- Configures middleware
- Registers routes
- Sets up error handling

### 3. Configuration Layer (`src/config/`)
- **express.js**: Middleware setup, static files, CORS
- **gcp.js**: GCP service initialization and authentication

### 4. Service Layer (`src/services/`)
- **storageService.js**: Business logic for GCP Storage
  - File listing with folder navigation
  - File download with streaming
  - Bucket operations
  - Hierarchy configuration parsing (districts, regions, departments)
  - Customer ID mapping for districts/tags
  - Internal ID lookups (region_internal_id, subsidiary_internal_id)
- **bigQueryService.js**: Business logic for BigQuery
  - Date range queries for P&L filters
  - P&L data queries (Month + YTD)
  - Parameterized queries by hierarchy (district/region/subsidiary)
  - Data transformation for P&L rendering
- **accountService.js**: Account hierarchy management
  - Parse account_config.json
  - Build parent-child relationships
  - Compute rollups (CRITICAL: includes displayExcluded accounts in totals)
  - Section configuration (Revenue, COGS, Expenses)
- **pnlRenderService.js**: P&L HTML generation
  - Format numbers and percentages
  - Render account rows with proper indentation
  - Generate headers for different entity types (District, Region, Subsidiary, Facility)
  - Handle multi-level reports (district summary + individual facilities)

### 5. Routes Layer (`src/routes/`)
- **api.js**: REST API endpoints
  - `/api/health` - Health check with service status
  - `/api/info` - Application metadata
  - `/api/storage/list` - List files in Cloud Storage bucket
  - `/api/storage/download/:filename` - Download file from Cloud Storage
  - `/api/storage/districts` - Get district hierarchy (districts + tags)
  - `/api/storage/regions` - Get region hierarchy (regions + tags)
  - `/api/storage/departments` - Get subsidiary hierarchy (departments + tags)
  - `/api/pl/dates` - Get available dates for P&L reporting
  - `/api/pl/data` - Get P&L HTML (Month + YTD, multi-level for districts)
- **views.js**: HTML page routes
  - `/` - P&L View dashboard (home page)
  - `/storage-browser` - File browser for Cloud Storage

### 6. Presentation Layer (`public/`)
- Static HTML files with embedded CSS/JS
- Self-contained, no build process required

## Data Flow

### API Request Flow
```
Client Request
    ↓
Express Middleware (logging, JSON parsing, CORS)
    ↓
Route Handler (src/routes/api.js)
    ↓
Service Layer (src/services/storageService.js)
    ↓
GCP API (Cloud Storage)
    ↓
Response to Client
```

### View Request Flow
```
Client Request
    ↓
Route Handler (src/routes/views.js)
    ↓
Serve Static HTML (public/*)
    ↓
Client renders page
    ↓
Client makes API calls for data
```

## Hierarchy System

### Overview
The application supports three hierarchical views for P&L reporting: Districts, Regions, and Subsidiaries. Users can toggle between these views via tabs in the UI.

### Architecture

**Frontend (public/pl-view.html)**
- Three hierarchy tabs: District, Region, Subsidiary
- Single searchable dropdown that dynamically changes content
- JavaScript handlers for tab switching and data loading

**Backend (src/services/storageService.js)**
- `getDistricts()` - Parses customer_config.json
- `getRegions()` - Parses region_config.json
- `getDepartments()` - Parses department_config.json

**API Endpoints (src/routes/api.js)**
- `GET /api/storage/districts` - Returns districts + tags
- `GET /api/storage/regions` - Returns regions + tags
- `GET /api/storage/departments` - Returns departments + tags

### Data Sources

All configuration files stored in GCP Storage bucket: `dimension_configurations`

1. **customer_config.json** - District configurations
   - Filter: `isDistrict === true && !districtReportingExcluded && !displayExcluded`
   - Returns: 44 districts + 9 tag values

2. **region_config.json** - Region configurations
   - Filter: `parent === '2' && !displayExcluded && !operationalExcluded`
   - Returns: 12 regions (leaf nodes only)

3. **department_config.json** - Subsidiary configurations
   - Filter: `parent === '2' && !displayExcluded && !operationalExcluded`
   - Returns: 7 departments (leaf nodes only)

### Tag System

Tags are string values in the `tags` field of config entries. They represent groupings that can span multiple hierarchy items.

- Tags are extracted from ALL entries in config files
- Deduplicated using Set()
- Added to dropdown with `tag_` ID prefix
- Currently only districts have tag values (9 tags)

### Response Format

All hierarchy endpoints return:
```json
[
  {
    "id": "1971",
    "label": "District 101 - John Miller",
    "type": "district"
  },
  {
    "id": "tag_District 121",
    "label": "District 121",
    "type": "tag"
  }
]
```

See [HIERARCHY_SYSTEM.md](./HIERARCHY_SYSTEM.md) for detailed documentation.

## Key Design Decisions

### 1. Modular Architecture
- **Why**: Separation of concerns, easier testing, maintainability
- **How**: Each layer has a single responsibility (config, routes, services, views)

### 2. Service Layer Pattern
- **Why**: Business logic separated from routes, reusable across endpoints
- **How**: StorageService encapsulates all GCP operations

### 3. No Build Process
- **Why**: Simplicity, faster development, easier debugging
- **How**: Static HTML with embedded CSS/JS, served directly by Express

### 4. Environment-based Configuration
- **Why**: Different settings for dev/prod, secure credential management
- **How**: dotenv for local, Render environment variables for production

### 5. Graceful Shutdown
- **Why**: Proper cleanup, avoid data loss, handle SIGTERM from Render
- **How**: Process signal handlers in server.js

### 6. Account Rollup Logic (CRITICAL)
- **Why**: Accurate financial reporting requires proper parent-child aggregation
- **How**: `accountService.computeRollups()` recursively sums account values
- **Key Insight**: `displayExcluded` accounts MUST be included in rollups
  - Example: "40000 Revenue" has `displayExcluded=true` but its value must roll into "Income"
  - `displayExcluded` only affects rendering (hide from display), not calculations
  - Without this, parent accounts would show incorrect totals (e.g., Income = $0 despite having revenue)

### 7. YTD (Year-to-Date) Reporting
- **Why**: Financial analysis requires both month and year-to-date comparisons
- **How**: Two BigQuery queries per request:
  - Month: `WHERE time_date = @date`
  - YTD: `WHERE time_date <= @date AND time_date >= DATE_TRUNC(@date, YEAR)`
- **Display**: Side-by-side columns (Month Actual/Budget | YTD Actual/Budget)

### 8. Multi-Level District Rendering
- **Why**: Districts need both aggregate view and individual facility breakdowns
- **How**: 
  - Generate district summary P&L (sum of all facilities)
  - Iterate through each facility and generate individual P&Ls
  - Only include facilities with revenue (Income > 0)
  - All HTML concatenated into single response

## Security Considerations

1. **GCP Credentials**: Stored as environment variables, never committed to git
2. **CORS**: Configured for API routes only, not for views
3. **Error Handling**: Generic error messages to clients, detailed logs server-side
4. **Input Validation**: Required for future endpoints (P&L API)

## Scalability Considerations

1. **Stateless Design**: No session storage, can scale horizontally
2. **Service Layer**: Easy to extract into microservices if needed
3. **GCP Integration**: Cloud-native, scales with GCP infrastructure
4. **Caching**: Can add Redis/memory cache layer in future

## Future Enhancements

1. **P&L Data Integration**: Connect to data source (BigQuery, DB, etc.)
2. **Authentication**: User login, role-based access control
3. **Caching Layer**: Cache P&L reports, storage file lists
4. **Testing**: Unit tests, integration tests, E2E tests
5. **Build Process**: Optional TypeScript, bundling for production
6. **API Documentation**: OpenAPI/Swagger specification
7. **Monitoring**: APM, error tracking (Sentry, DataDog, etc.)

## Development Workflow

1. **Local Development**: Use `.env` file, npm start, test at localhost:3000
2. **Git Commit**: Commit changes to main branch
3. **Auto Deploy**: Render automatically deploys on push to main
4. **Production**: Live at https://yona-render-site.onrender.com

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `NODE_ENV` | No | Environment (development/production) |
| `GCP_SERVICE_ACCOUNT_KEY` | Yes | GCP service account JSON (as string) |

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `STORAGE_LIST_ERROR` | 500 | Failed to list files in storage |
| `FILE_NOT_FOUND` | 404 | Requested file doesn't exist |
| `DOWNLOAD_ERROR` | 500 | Failed to download file |
| `STREAM_ERROR` | 500 | Error streaming file to client |
| `ROUTE_NOT_FOUND` | 404 | Requested endpoint doesn't exist |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## Performance

- **Cold Start**: ~2-3 seconds on Render free tier
- **API Response**: <500ms for storage list operations
- **File Download**: Streaming, no memory limits
- **Concurrent Users**: Handles 100+ simultaneous requests

## Monitoring

### Health Check
```bash
curl https://yona-render-site.onrender.com/api/health
```

### Logs
- Available in Render dashboard
- Console logs include timestamps and request details

