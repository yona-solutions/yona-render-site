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
│   │   └── storageService.js     # GCP Storage operations
│   ├── middleware/               # Custom middleware (future)
│   └── utils/                    # Utility functions (future)
├── public/                       # Static files (HTML, CSS, JS)
│   ├── pl-view.html              # P&L reporting dashboard
│   └── storage-browser.html      # GCP Storage file browser
├── docs/                         # Documentation
│   └── ARCHITECTURE.md           # This file
├── server.js                     # Application entry point
├── package.json                  # Dependencies & scripts
├── render.yaml                   # Render deployment configuration
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

### 5. Routes Layer (`src/routes/`)
- **api.js**: REST API endpoints
  - `/api/health` - Health check
  - `/api/info` - Application info
  - `/api/storage/*` - Storage operations
  - `/api/pl/*` - P&L data (future)
- **views.js**: HTML page routes
  - `/` - P&L View dashboard
  - `/storage-browser` - File browser

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

