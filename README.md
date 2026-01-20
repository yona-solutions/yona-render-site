# Yona Render Site

A Node.js web service designed for deployment on Render.

## Features

- Express.js web server
- Health check endpoint
- API endpoints for service information
- Production-ready configuration

## Local Development

1. Install dependencies:
```bash
npm install
```

2. Run the server:
```bash
npm start
```

The server will start on `http://localhost:3000`

## API Endpoints

- `GET /` - Main page
- `GET /api/health` - Health check endpoint
- `GET /api/info` - Service information

## Deployment on Render

This service is configured to deploy on Render with the following settings:

- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Environment**: Node.js
- **Port**: Automatically provided by Render via `PORT` environment variable

## Environment Variables

- `PORT` - Provided automatically by Render
- `NODE_ENV` - Set to `production` in Render

## Requirements

- Node.js >= 18.0.0
- npm

