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

  /**
   * Get districts from customer configuration
   * 
   * GET /api/storage/districts
   * 
   * Response:
   *   [
   *     {id: "1829", label: "District 121 - Ben Riegle (D)", type: "district"},
   *     {id: "tag_District 121", label: "District 121", type: "tag"},
   *     ...
   *   ]
   */
  router.get('/storage/districts', async (req, res) => {
    try {
      const districts = await storageService.getDistricts();
      res.json(districts);
    } catch (error) {
      console.error('Error fetching districts:', error);
      res.status(500).json({ 
        error: error.message,
        code: 'DISTRICTS_FETCH_ERROR'
      });
    }
  });

  /**
   * Get regions from region configuration
   * 
   * GET /api/storage/regions
   * 
   * Response:
   *   [
   *     {id: "101", label: "Region North", type: "region"},
   *     {id: "tag_Region1", label: "Region1", type: "tag"},
   *     ...
   *   ]
   */
  router.get('/storage/regions', async (req, res) => {
    try {
      const regions = await storageService.getRegions();
      res.json(regions);
    } catch (error) {
      console.error('Error fetching regions:', error);
      res.status(500).json({ 
        error: error.message,
        code: 'REGIONS_FETCH_ERROR'
      });
    }
  });

  /**
   * Get departments (subsidiaries) from department configuration
   * 
   * GET /api/storage/departments
   * 
   * Response:
   *   [
   *     {id: "201", label: "Department A", type: "department"},
   *     {id: "tag_Dept1", label: "Dept1", type: "tag"},
   *     ...
   *   ]
   */
  router.get('/storage/departments', async (req, res) => {
    try {
      const departments = await storageService.getDepartments();
      res.json(departments);
    } catch (error) {
      console.error('Error fetching departments:', error);
      res.status(500).json({ 
        error: error.message,
        code: 'DEPARTMENTS_FETCH_ERROR'
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
   * GET /api/pl/data?hierarchy=district&selectedId=101&date=2025-12-01
   * 
   * Query Parameters:
   *   - hierarchy: "district", "region", or "subsidiary"
   *   - selectedId: ID of the selected hierarchy item
   *   - date: Date in YYYY-MM-DD format
   * 
   * Response:
   *   Array of transaction rows with aggregated values
   */
  router.get('/pl/data', async (req, res) => {
    try {
      const { hierarchy, selectedId, date } = req.query;

      // Validate required parameters
      if (!hierarchy || !selectedId || !date) {
        return res.status(400).json({ 
          error: 'Missing required parameters',
          code: 'INVALID_PARAMETERS',
          required: ['hierarchy', 'selectedId', 'date']
        });
      }

      // Validate hierarchy type
      if (!['district', 'region', 'subsidiary'].includes(hierarchy)) {
        return res.status(400).json({ 
          error: 'Invalid hierarchy type',
          code: 'INVALID_HIERARCHY',
          allowed: ['district', 'region', 'subsidiary']
        });
      }

      console.log(`📊 Fetching P&L data: hierarchy=${hierarchy}, selectedId=${selectedId}, date=${date}`);

      let queryParams = { hierarchy, date };

      // Get the appropriate IDs based on hierarchy type
      if (hierarchy === 'district') {
        // Get customer IDs for this district or district tag
        const customerIds = await storageService.getCustomerIdsForDistrict(selectedId);
        
        if (customerIds.length === 0) {
          return res.status(404).json({ 
            error: 'No customers found for selected district',
            code: 'NO_CUSTOMERS_FOUND'
          });
        }
        
        queryParams.customerIds = customerIds;
        console.log(`   Found ${customerIds.length} customer IDs for district ${selectedId}`);
      } else if (hierarchy === 'region') {
        // Get region internal ID
        const regionId = await storageService.getRegionInternalId(selectedId);
        
        if (!regionId) {
          return res.status(404).json({ 
            error: 'Region not found',
            code: 'REGION_NOT_FOUND'
          });
        }
        
        queryParams.regionId = regionId;
        console.log(`   Using region_internal_id=${regionId}`);
      } else if (hierarchy === 'subsidiary') {
        // Get subsidiary internal ID
        const subsidiaryId = await storageService.getSubsidiaryInternalId(selectedId);
        
        if (!subsidiaryId) {
          return res.status(404).json({ 
            error: 'Subsidiary not found',
            code: 'SUBSIDIARY_NOT_FOUND'
          });
        }
        
        queryParams.subsidiaryId = subsidiaryId;
        console.log(`   Using subsidiary_internal_id=${subsidiaryId}`);
      }

      // Query BigQuery for P&L data
      const plData = await bigQueryService.getPLData(queryParams);

      res.json({
        hierarchy,
        selectedId,
        date,
        rowCount: plData.length,
        data: plData,
        queryParams: queryParams // Include query params for debugging
      });
    } catch (error) {
      console.error('Error fetching P&L data:', error);
      res.status(500).json({ 
        error: error.message,
        code: 'PL_DATA_ERROR'
      });
    }
  });

  return router;
}

module.exports = createApiRoutes;

