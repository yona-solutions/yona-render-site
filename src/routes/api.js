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
const accountService = require('../services/accountService');
const pnlRenderService = require('../services/pnlRenderService');

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
   * Get P&L HTML for a specific hierarchy and period
   * 
   * GET /api/pl/data?hierarchy=district&selectedId=101&date=2025-12-01
   * 
   * Query Parameters:
   *   - hierarchy: "district", "region", or "subsidiary"
   *   - selectedId: ID of the selected hierarchy item (includes label in format "id - label")
   *   - date: Date in YYYY-MM-DD format
   * 
   * Response:
   *   {
   *     html: "<div>...</div>", // Rendered P&L HTML
   *     hierarchy: "district",
   *     selectedLabel: "District 122",
   *     date: "2025-12-01",
   *     noRevenue: false
   *   }
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

      console.log(`📊 Generating P&L report: hierarchy=${hierarchy}, selectedId=${selectedId}, date=${date}`);

      // Extract ID and label from selectedId (format: "id - label" or just "id")
      let actualId, selectedLabel;
      if (selectedId.includes(' - ')) {
        const parts = selectedId.split(' - ');
        actualId = parts[0];
        selectedLabel = parts.slice(1).join(' - ');
      } else {
        actualId = selectedId;
        selectedLabel = selectedId;
      }

      console.log(`   Using ID: ${actualId}, Label: ${selectedLabel}`);

      // Fetch account configuration from Cloud Storage
      console.log('   Fetching account configuration...');
      const accountConfig = await storageService.getFileAsJson('account_config.json');
      const childrenMap = accountService.buildChildrenMap(accountConfig);
      const sectionConfig = accountService.getSectionConfig();

      let queryParams = { hierarchy, date, accountConfig };

      // Get the appropriate IDs based on hierarchy type
      if (hierarchy === 'district') {
        // Get full customer details for this district or district tag
        const customers = await storageService.getCustomersForDistrict(actualId);
        
        if (customers.length === 0) {
          return res.status(404).json({ 
            error: 'No customers found for selected district',
            code: 'NO_CUSTOMERS_FOUND'
          });
        }
        
        const customerIds = customers.map(c => c.customer_internal_id);
        queryParams.customerIds = customerIds;
        queryParams.customers = customers; // Store full customer details for facility P&Ls
        console.log(`   Found ${customerIds.length} customer IDs for district`);
      } else if (hierarchy === 'region') {
        // Get region internal ID
        const regionId = await storageService.getRegionInternalId(actualId);
        
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
        const subsidiaryId = await storageService.getSubsidiaryInternalId(actualId);
        
        if (!subsidiaryId) {
          return res.status(404).json({ 
            error: 'Subsidiary not found',
            code: 'SUBSIDIARY_NOT_FOUND'
          });
        }
        
        queryParams.subsidiaryId = subsidiaryId;
        console.log(`   Using subsidiary_internal_id=${subsidiaryId}`);
      }

      // ============================================
      // Multi-Level P&L Rendering
      // ============================================
      // 
      // For DISTRICTS: Generate summary + individual facility reports
      // - District summary: Aggregate of all customers (facilities) in the district
      // - Facility reports: Individual P&L for each customer with revenue
      // 
      // For REGIONS/SUBSIDIARIES: Single-level P&L (no children)
      // 
      // Each report includes both Month and YTD columns
      // ============================================
      
      let htmlParts = [];
      let totalNoRevenue = false;
      
      if (hierarchy === 'district') {
        // 1. Generate district summary P&L (aggregate of all customers)
        console.log('   Querying BigQuery for district summary (Month + YTD)...');
        const districtData = await bigQueryService.getPLData({ ...queryParams, ytd: false });
        const districtYtdData = await bigQueryService.getPLData({ ...queryParams, ytd: true });
        
        const districtMeta = {
          typeLabel: 'District',
          entityName: selectedLabel,
          monthLabel: date,
          facilityCount: queryParams.customers.length,
          plType: 'Standard'
        };
        
        console.log('   Generating district summary P&L...');
        const districtResult = await pnlRenderService.generatePNLReport(
          districtData,
          districtYtdData,
          districtMeta,
          accountConfig,
          childrenMap,
          sectionConfig
        );
        
        htmlParts.push(districtResult.html);
        totalNoRevenue = districtResult.noRevenue;
        
        // 2. Generate facility P&L for each customer
        console.log(`   Generating ${queryParams.customers.length} facility P&Ls...`);
        for (const customer of queryParams.customers) {
          // Query for just this customer (Month + YTD)
          const facilityQueryParams = {
            hierarchy: 'district',
            customerIds: [customer.customer_internal_id],
            date,
            accountConfig
          };
          
          const facilityData = await bigQueryService.getPLData({ ...facilityQueryParams, ytd: false });
          const facilityYtdData = await bigQueryService.getPLData({ ...facilityQueryParams, ytd: true });
          
          const facilityMeta = {
            typeLabel: 'Facility',
            entityName: customer.label,
            monthLabel: date,
            parentDistrict: selectedLabel,
            plType: 'Standard'
          };
          
          const facilityResult = await pnlRenderService.generatePNLReport(
            facilityData,
            facilityYtdData,
            facilityMeta,
            accountConfig,
            childrenMap,
            sectionConfig
          );
          
          // Only include facilities with revenue
          if (!facilityResult.noRevenue) {
            htmlParts.push(facilityResult.html);
          }
        }
        
        console.log(`✅ Generated district summary + ${htmlParts.length - 1} facility P&Ls`);
        
        res.json({
          html: htmlParts.join('\n'),
          noRevenue: totalNoRevenue,
          hierarchy,
          selectedId,
          selectedLabel,
          date,
          facilityCount: htmlParts.length - 1,
          meta: districtMeta
        });
      } else {
        // For region and subsidiary, keep single-level for now
        console.log('   Querying BigQuery (Month + YTD)...');
        const monthData = await bigQueryService.getPLData({ ...queryParams, ytd: false });
        const ytdData = await bigQueryService.getPLData({ ...queryParams, ytd: true });

        const meta = {
          typeLabel: hierarchy === 'region' ? 'Region' : 'Subsidiary',
          entityName: selectedLabel,
          monthLabel: date,
          plType: 'Standard'
        };

        console.log('   Generating P&L HTML...');
        const result = await pnlRenderService.generatePNLReport(
          monthData,
          ytdData,
          meta,
          accountConfig,
          childrenMap,
          sectionConfig
        );

        console.log(`✅ P&L report generated successfully (noRevenue: ${result.noRevenue})`);

        res.json({
          html: result.html,
          noRevenue: result.noRevenue,
          hierarchy,
          selectedId,
          selectedLabel,
          date,
          meta
        });
      }
    } catch (error) {
      console.error('Error generating P&L report:', error);
      res.status(500).json({ 
        error: error.message,
        code: 'PL_GENERATION_ERROR',
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  return router;
}

module.exports = createApiRoutes;

