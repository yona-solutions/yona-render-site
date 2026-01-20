/**
 * API Routes Module
 * 
 * Defines all API endpoints for the application.
 * Routes are organized by feature/domain.
 * 
 * @module routes/api
 */

const express = require('express');
const router = express.Router();

/**
 * Configure API routes
 * 
 * @param {StorageService} storageService - Storage service instance
 * @param {BigQueryService} bigQueryService - BigQuery service instance
 * @returns {Router} Configured Express router
 */
function createApiRoutes(storageService, bigQueryService) {
  // Health check endpoint
  router.get('/health', (req, res) => {
    res.json({ 
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        storage: storageService.isAvailable(),
        bigquery: bigQueryService.isAvailable()
      }
    });
  });

  // Application info endpoint
  router.get('/info', (req, res) => {
    res.json({
      name: 'Yona Render Site',
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      node_version: process.version
    });
  });

  // ============================================
  // GCP Storage API Endpoints
  // ============================================

  /**
   * List files in storage bucket
   * 
   * GET /api/storage/list?prefix=folder/
   * 
   * Query Parameters:
   *   - prefix (optional): Filter files by prefix/folder
   * 
   * Response:
   *   {
   *     prefix: string,
   *     folders: string[],
   *     files: Array<{name, size, updated, contentType}>
   *   }
   */
  router.get('/storage/list', async (req, res) => {
    try {
      const prefix = req.query.prefix || '';
      const result = await storageService.listFiles(prefix);
      res.json(result);
    } catch (error) {
      console.error('Error listing files:', error);
      res.status(500).json({ 
        error: error.message,
        code: 'STORAGE_LIST_ERROR'
      });
    }
  });

  /**
   * Download a file from storage bucket
   * 
   * GET /api/storage/download/:filename
   * 
   * Parameters:
   *   - filename: Full path to file in bucket (supports nested paths)
   * 
   * Response:
   *   File stream with appropriate content-type and disposition headers
   */
  router.get('/storage/download/:filename(*)', async (req, res) => {
    try {
      const fileName = req.params.filename;
      const { exists, file, metadata } = await storageService.getFile(fileName);
      
      if (!exists) {
        return res.status(404).json({ 
          error: 'File not found',
          code: 'FILE_NOT_FOUND'
        });
      }
      
      // Set response headers
      res.setHeader('Content-Type', metadata.contentType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName.split('/').pop()}"`);
      
      // Stream the file
      const readStream = storageService.createReadStream(file);
      readStream
        .on('error', (error) => {
          console.error('Error streaming file:', error);
          if (!res.headersSent) {
            res.status(500).json({ 
              error: error.message,
              code: 'STREAM_ERROR'
            });
          }
        })
        .pipe(res);
    } catch (error) {
      console.error('Error downloading file:', error);
      res.status(500).json({ 
        error: error.message,
        code: 'DOWNLOAD_ERROR'
      });
    }
  });

  // ============================================
  // P&L API Endpoints
  // ============================================

  /**
   * Get available dates for the date filter
   * 
   * GET /api/pl/dates
   * 
   * Response:
   *   [
   *     {time: "2025-12-01", formatted: "2025-12-01"},
   *     {time: "2025-11-01", formatted: "2025-11-01"},
   *     ...
   *   ]
   */
  router.get('/pl/dates', async (req, res) => {
    try {
      const dates = await bigQueryService.getAvailableDates();
      res.json(dates);
    } catch (error) {
      console.error('Error fetching dates:', error);
      res.status(500).json({ 
        error: error.message,
        code: 'DATES_FETCH_ERROR'
      });
    }
  });

  /**
   * Get P&L data for a specific hierarchy and period
   * 
   * GET /api/pl/data?hierarchy=district&id=101&month=2025-12-01&type=standard
   * 
   * TODO: Implement P&L data fetching logic
   */
  router.get('/pl/data', (req, res) => {
    res.status(501).json({ 
      error: 'Not implemented',
      message: 'P&L data endpoint will be implemented in next phase'
    });
  });

  return router;
}

module.exports = createApiRoutes;

