/**
 * Application Setup Module
 * 
 * Central module that initializes and configures the Express application.
 * Brings together all configuration, services, and routes.
 * 
 * @module app
 */

const express = require('express');
const { configureExpress } = require('./config/express');
const { initializeStorage, initializeBigQuery } = require('./config/gcp');
const StorageService = require('./services/storageService');
const BigQueryService = require('./services/bigQueryService');
const emailConfigService = require('./services/emailConfigService');
const emailService = require('./services/emailService');
const googleSheetsService = require('./services/googleSheetsService');
const createApiRoutes = require('./routes/api');
const emailConfigApiRoutes = require('./routes/emailConfigApi');
const createViewRoutes = require('./routes/views');

/**
 * Create and configure Express application
 * 
 * @returns {express.Application} Configured Express app
 */
async function createApp() {
  const app = express();

  // Configure Express middleware
  configureExpress(app);

  // Initialize services
  const storage = initializeStorage();
  const storageService = new StorageService(storage);
  
  const bigquery = initializeBigQuery();
  const bigQueryService = new BigQueryService(bigquery);

  // Initialize email service (SendGrid)
  emailService.initialize();

  // Initialize Google Sheets service
  googleSheetsService.initialize();

  // Initialize email config service (PostgreSQL)
  // Only initialize if DATABASE_URL is provided
  if (process.env.DATABASE_URL) {
    try {
      await emailConfigService.initialize();
    } catch (error) {
      console.warn('⚠️  Email config database not available:', error.message);
      console.warn('   Email configuration features will be disabled');
    }
  } else {
    console.warn('⚠️  DATABASE_URL not set - email configuration features disabled');
  }

  // Register routes
  app.use('/api', createApiRoutes(storageService, bigQueryService));
  app.use('/api', emailConfigApiRoutes); // Email config API routes
  app.use('/', createViewRoutes());

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ 
      error: 'Not Found',
      message: `Cannot ${req.method} ${req.url}`,
      code: 'ROUTE_NOT_FOUND'
    });
  });

  // Error handler
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: err.message,
      code: 'INTERNAL_ERROR'
    });
  });

  return app;
}

module.exports = createApp;

