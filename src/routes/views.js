/**
 * View Routes Module
 * 
 * Defines routes that serve HTML pages (views).
 * Separates view routing from API routing for clarity.
 * 
 * @module routes/views
 */

const express = require('express');
const path = require('path');
const router = express.Router();

/**
 * Configure view routes
 * 
 * @returns {Router} Configured Express router
 */
function createViewRoutes() {
  const publicPath = path.join(__dirname, '../../public');

  /**
   * Home page - P&L View
   * 
   * GET /
   */
  router.get('/', (req, res) => {
    res.sendFile(path.join(publicPath, 'pl-view.html'));
  });

  /**
   * Storage Browser page
   * 
   * GET /storage-browser
   */
  router.get('/storage-browser', (req, res) => {
    res.sendFile(path.join(publicPath, 'storage-browser.html'));
  });

  /**
   * Dimension Configuration page
   * 
   * GET /dimension-config
   */
  router.get('/dimension-config', (req, res) => {
    res.sendFile(path.join(publicPath, 'dimension-config.html'));
  });

  /**
   * Email Configuration page
   *
   * GET /email-config
   */
  router.get('/email-config', (req, res) => {
    res.sendFile(path.join(publicPath, 'email-config.html'));
  });

  /**
   * Customer Explorer page
   *
   * GET /customer-explorer
   */
  router.get('/customer-explorer', (req, res) => {
    res.sendFile(path.join(publicPath, 'customer-explorer.html'));
  });

  /**
   * P&L Logic Overview page
   *
   * GET /pl-logic
   */
  router.get('/pl-logic', (req, res) => {
    res.sendFile(path.join(publicPath, 'pl-logic.html'));
  });

  /**
   * Run Log page
   *
   * GET /run-log
   */
  router.get('/run-log', (req, res) => {
    res.sendFile(path.join(publicPath, 'run-log.html'));
  });

  /**
   * GCS Import page
   *
   * GET /gcs-import
   */
  router.get('/gcs-import', (req, res) => {
    res.sendFile(path.join(publicPath, 'gcs-import.html'));
  });

  // Future routes can be added here:
  // router.get('/reports', ...) 
  // router.get('/settings', ...)

  return router;
}

module.exports = createViewRoutes;
