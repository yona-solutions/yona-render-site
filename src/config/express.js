/**
 * Express Configuration Module
 * 
 * Configures Express middleware and application settings.
 * 
 * @module config/express
 */

const express = require('express');
const path = require('path');

/**
 * Configure Express application with middleware
 * 
 * @param {express.Application} app - Express application instance
 */
function configureExpress(app) {
  // Parse JSON request bodies (with increased limit for large config files)
  app.use(express.json({ limit: '2mb' }));
  
  // Parse URL-encoded request bodies (with increased limit)
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  
  // Serve static files from public directory
  app.use(express.static(path.join(__dirname, '../../public')));
  
  // Request logging middleware
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });
  
  // CORS headers for API routes
  app.use('/api', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    next();
  });
}

module.exports = {
  configureExpress
};

