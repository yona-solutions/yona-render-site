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
const createApiRoutes = require('./routes/api');
const createViewRoutes = require('./routes/views');

/**
 * Create and configure Express application
 * 
 * @returns {express.Application} Configured Express app
 */
function createApp() {
  const app = express();

  // Configure Express middleware
  configureExpress(app);

  // Initialize services
  const storage = initializeStorage();
  const storageService = new StorageService(storage);
  
  const bigquery = initializeBigQuery();
  const bigQueryService = new BigQueryService(bigquery);

  // Register routes
  app.use('/api', createApiRoutes(storageService, bigQueryService));
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

