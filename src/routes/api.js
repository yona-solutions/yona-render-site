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
      // Parse selectedId to extract actual ID and display label
      // 
      // Three formats:
      // 1. Tag IDs: "tag_District 121 - Ben Riegel"
      //    - Keep full ID (tag value may contain " - ")
      //    - Label: Remove "tag_" prefix
      // 
      // 2. IDs with labels: "1971 - District Name"
      //    - ID: First part before " - "
      //    - Label: Everything after " - "
      // 
      // 3. Plain IDs: "1971"
      //    - ID and Label are the same
      let actualId, selectedLabel;
      if (selectedId.startsWith('tag_')) {
        // Tags: Keep full ID, remove "tag_" prefix for display
        actualId = selectedId;
        selectedLabel = selectedId.substring(4);
      } else if (selectedId.includes(' - ')) {
        // ID with label: Split on " - "
        const parts = selectedId.split(' - ');
        actualId = parts[0];
        selectedLabel = parts.slice(1).join(' - ');
      } else {
        // Plain ID: Use as-is
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
        // Tags are treated as districts - they just aggregate multiple districts' customers
        const districtResult = await storageService.getCustomersForDistrict(actualId);
        const { customers, districtName, isTag } = districtResult;
        
        if (customers.length === 0) {
          return res.status(404).json({ 
            error: 'No customers found for selected district',
            code: 'NO_CUSTOMERS_FOUND'
          });
        }
        
        // Update selectedLabel to use the district display name
        selectedLabel = districtName;
        
        const customerIds = customers.map(c => c.customer_internal_id);
        queryParams.customerIds = customerIds;
        queryParams.customers = customers; // Store full customer details for facility P&Ls
        queryParams.isTag = isTag; // Store whether this is a tag for header generation
        console.log(`   Found ${customerIds.length} customer IDs for ${isTag ? 'tag' : 'district'}: ${districtName}`);
      } else if (hierarchy === 'region') {
        // Get region internal ID and name
        const regionResult = await storageService.getRegionInternalId(actualId);
        
        if (!regionResult) {
          return res.status(404).json({ 
            error: 'Region not found',
            code: 'REGION_NOT_FOUND'
          });
        }
        
        const { regionId, regionName } = regionResult;
        selectedLabel = regionName; // Use the region name in the header
        
        // Check for optional subsidiary filter
        let subsidiaryId = null;
        const subsidiaryFilter = req.query.subsidiaryFilter;
        
        if (subsidiaryFilter && subsidiaryFilter !== 'all') {
          const subsidiaryResult = await storageService.getSubsidiaryInternalId(subsidiaryFilter);
          
          if (!subsidiaryResult) {
            return res.status(404).json({ 
              error: 'Subsidiary not found',
              code: 'SUBSIDIARY_NOT_FOUND'
            });
          }
          
          subsidiaryId = subsidiaryResult.subsidiaryId;
          console.log(`   Using subsidiary filter: subsidiary_internal_id=${subsidiaryId}`);
        }
        
        // Get customers in this region from dim_customers (optionally filtered by subsidiary)
        const customersInRegion = await bigQueryService.getCustomersInRegion(regionId, subsidiaryId);
        
        if (customersInRegion.length === 0) {
          return res.status(404).json({ 
            error: 'No customers found for selected region/subsidiary combination',
            code: 'NO_CUSTOMERS_FOUND'
          });
        }
        
        // Group customers by their parent district
        const districtGroups = await storageService.groupCustomersByDistrict(customersInRegion);
        
        queryParams.regionId = regionId;
        queryParams.subsidiaryId = subsidiaryId; // Will be null if not filtered
        queryParams.customersInRegion = customersInRegion;
        queryParams.districtGroups = districtGroups;
        
        const filterDesc = subsidiaryId 
          ? `region_internal_id=${regionId} AND subsidiary_internal_id=${subsidiaryId}`
          : `region_internal_id=${regionId}`;
        console.log(`   Using filters: ${filterDesc}`);
        console.log(`   Found ${customersInRegion.length} customers in ${districtGroups.length} districts`);
      } else if (hierarchy === 'subsidiary') {
        // Get subsidiary internal ID and name
        const subsidiaryResult = await storageService.getSubsidiaryInternalId(actualId);
        
        if (!subsidiaryResult) {
          return res.status(404).json({ 
            error: 'Subsidiary not found',
            code: 'SUBSIDIARY_NOT_FOUND'
          });
        }
        
        const { subsidiaryId, subsidiaryName } = subsidiaryResult;
        selectedLabel = subsidiaryName; // Use the subsidiary name in the header
        
        // Check for optional region filter
        let regionId = null;
        const regionFilter = req.query.regionFilter;
        
        if (regionFilter && regionFilter !== 'all') {
          const regionResult = await storageService.getRegionInternalId(regionFilter);
          
          if (!regionResult) {
            return res.status(404).json({ 
              error: 'Region not found',
              code: 'REGION_NOT_FOUND'
            });
          }
          
          regionId = regionResult.regionId;
          console.log(`   📎 Applying region filter: ${regionFilter} (internal ID: ${regionId})`);
        }
        
        // Get customers in subsidiary from dim_customers
        console.log(`   Fetching customers from dim_customers...`);
        const customersInSubsidiary = await bigQueryService.getCustomersInSubsidiary(subsidiaryId, regionId);
        
        // Group customers by region, then by district
        const regionGroups = await storageService.groupCustomersByRegionAndDistrict(customersInSubsidiary);
        
        queryParams.subsidiaryId = subsidiaryId;
        queryParams.regionGroups = regionGroups;
        
        const filterDesc = regionId 
          ? `subsidiary_internal_id=${subsidiaryId} AND region_internal_id=${regionId}`
          : `subsidiary_internal_id=${subsidiaryId}`;
        console.log(`   Using filters: ${filterDesc}`);
        console.log(`   Found ${customersInSubsidiary.length} customers in ${regionGroups.length} regions`);
      }

      // ============================================
      // Multi-Level P&L Rendering
      // ============================================
      // 
      // For DISTRICTS: Generate summary + individual facility reports
      // - District summary: Aggregate of all customers (facilities) in the district
      // - Facility reports: Individual P&L for each customer with revenue
      // - Note: Tags are treated as districts - they aggregate all customers from multiple districts
      // 
      // For REGIONS: Generate summary + district summaries + facility reports
      // - Region summary: Aggregate of all customers in the region
      // - District summaries: Aggregate for each district in the region
      // - Facility reports: Individual P&L for each customer with revenue
      // 
      // For SUBSIDIARIES: Generate summary + region summaries + district summaries + facility reports
      // - Subsidiary summary: Aggregate of all customers in the subsidiary
      // - Region summaries: Aggregate for each region in the subsidiary
      // - District summaries: Aggregate for each district in each region
      // - Facility reports: Individual P&L for each customer with revenue
      // 
      // Each report includes both Month and YTD columns
      // ============================================
      
      let htmlParts = [];
      let totalNoRevenue = false;
      
      if (hierarchy === 'district') {
        // District rendering: District -> Facilities
        // (Tags are treated as districts - they just aggregate multiple districts' customers)
        // OPTIMIZED: Only 4 BigQuery queries total (District Month/YTD + All Customers Month/YTD)
        
        const allCustomerIds = queryParams.customerIds;
        
        // Query 1 & 2: District Summary (Month + YTD)
        console.log('   Querying BigQuery for district summary (Month + YTD)...');
        const districtData = await bigQueryService.getPLData({ ...queryParams, ytd: false });
        const districtYtdData = await bigQueryService.getPLData({ ...queryParams, ytd: true });
        
        const districtMeta = {
          typeLabel: queryParams.isTag ? 'District Tag' : 'District',
          entityName: selectedLabel,
          monthLabel: date,
          facilityCount: 0, // Will be updated after processing
          plType: 'Standard'
        };
        
        console.log('   Generating district summary P&L (header will be updated with actual counts)...');
        const districtResult = await pnlRenderService.generatePNLReport(
          districtData,
          districtYtdData,
          districtMeta,
          accountConfig,
          childrenMap,
          sectionConfig
        );
        
        totalNoRevenue = districtResult.noRevenue;
        
        // Query 3 & 4: All customers in district (Month + YTD)
        console.log(`\n   Querying BigQuery for all ${allCustomerIds.length} customers (Month + YTD)...`);
        const allCustomersMonthData = await bigQueryService.getPLData({ 
          hierarchy: 'district', 
          customerIds: allCustomerIds, 
          date, 
          accountConfig, 
          ytd: false 
        });
        const allCustomersYtdData = await bigQueryService.getPLData({ 
          hierarchy: 'district', 
          customerIds: allCustomerIds, 
          date, 
          accountConfig, 
          ytd: true 
        });
        
        console.log('   ✅ Query complete - processing facility P&Ls in memory...');
        
        // Generate facility P&L for each customer by filtering in memory
        const facilityReports = [];
        let facilityCount = 0;
        
        for (const customer of queryParams.customers) {
          const facilityMonthData = accountService.filterDataByCustomers(allCustomersMonthData, [customer.customer_internal_id]);
          const facilityYtdData = accountService.filterDataByCustomers(allCustomersYtdData, [customer.customer_internal_id]);
          
          const facilityMeta = {
            typeLabel: 'Facility',
            entityName: customer.label,
            monthLabel: date,
            parentDistrict: selectedLabel,
            plType: 'Standard'
          };
          
          const facilityResult = await pnlRenderService.generatePNLReport(
            facilityMonthData,
            facilityYtdData,
            facilityMeta,
            accountConfig,
            childrenMap,
            sectionConfig
          );
          
          // Only include facilities with revenue
          if (!facilityResult.noRevenue) {
            facilityReports.push(facilityResult.html);
            facilityCount++;
          }
        }
        
        // Update district header with actual facility count
        districtMeta.facilityCount = facilityCount;
        const updatedDistrictHeaderHtml = await pnlRenderService.generateHeader(districtMeta);
        
        // Combine updated header with district content (split on <hr class="pnl-divider">)
        const parts = districtResult.html.split('<hr class="pnl-divider">');
        const districtContentHtml = parts[1]; // Everything after the header and divider
        
        // Reconstruct with new header: opening tag + new header + divider + rest of content
        const completeDistrictHtml = `    <div class="pnl-report-container page-break">
      ${updatedDistrictHeaderHtml}
      <hr class="pnl-divider">${districtContentHtml}`;
        
        // Combine all reports
        const finalHtml = [completeDistrictHtml, ...facilityReports].join('\n\n');
        
        console.log(`✅ Generated district summary + ${facilityCount} facility P&Ls`);
        console.log(`   🚀 Performance: Used only 4 BigQuery queries instead of ${2 + (queryParams.customers.length * 2)}`);
        
        res.json({
          html: finalHtml,
          noRevenue: totalNoRevenue,
          hierarchy,
          selectedId,
          selectedLabel,
          date,
          facilityCount: facilityCount,
          meta: districtMeta
        });
      } else if (hierarchy === 'region') {
        // Multi-level region rendering: Region Summary -> District Summaries -> Facility P&Ls
        // OPTIMIZED: Only 4 BigQuery queries total (Region Month/YTD + All Customers Month/YTD)
        
        // 1. Generate region summary P&L (filtered by region_internal_id)
        console.log('   Querying BigQuery for region summary (Month + YTD)...');
        const regionData = await bigQueryService.getPLData({ ...queryParams, ytd: false });
        const regionYtdData = await bigQueryService.getPLData({ ...queryParams, ytd: true });
        
        const regionMeta = {
          typeLabel: 'Region',
          entityName: selectedLabel,
          monthLabel: date,
          districtCount: 0, // Will be updated after processing
          facilityCount: 0, // Will be updated after processing
          plType: 'Standard'
        };
        
        console.log('   Generating region summary P&L (header will be updated with actual counts)...');
        const regionResult = await pnlRenderService.generatePNLReport(
          regionData,
          regionYtdData,
          regionMeta,
          accountConfig,
          childrenMap,
          sectionConfig
        );
        
        // Note: We'll regenerate the region header after we know the actual counts
        const regionHtmlIndex = htmlParts.length; // Remember where to insert corrected region HTML
        htmlParts.push(regionResult.html); // Temporary placeholder
        totalNoRevenue = regionResult.noRevenue;
        
        // 2. Query ALL customer data ONCE (all customers in region, all their transactions)
        // This includes transactions outside the region - customers' full P&L
        console.log(`   Querying BigQuery for all ${queryParams.customersInRegion.length} customers (Month + YTD)...`);
        const allCustomerIds = queryParams.customersInRegion.map(c => c.customer_internal_id);
        const allCustomersQueryParams = {
          hierarchy: 'district',
          customerIds: allCustomerIds,
          date,
          accountConfig
        };
        
        const allCustomersData = await bigQueryService.getPLData({ ...allCustomersQueryParams, ytd: false });
        const allCustomersYtdData = await bigQueryService.getPLData({ ...allCustomersQueryParams, ytd: true });
        
        console.log(`   ✅ Retrieved data for all customers. Now filtering in memory...`);
        
        // 3. Generate district summaries and facility P&Ls by filtering the data in memory
        console.log(`   Generating P&Ls for ${queryParams.districtGroups.length} districts...`);
        let totalFacilityCount = 0;
        let totalDistrictCount = 0; // Track districts with revenue
        
        for (const districtGroup of queryParams.districtGroups) {
          const districtCustomerIds = districtGroup.customers.map(c => c.customer_internal_id);
          
          // 3a. Filter data for this district (in memory, no BigQuery call)
          console.log(`   - District: ${districtGroup.districtLabel} (${districtCustomerIds.length} customers)`);
          const districtData = accountService.filterDataByCustomers(allCustomersData, districtCustomerIds);
          const districtYtdData = accountService.filterDataByCustomers(allCustomersYtdData, districtCustomerIds);
          
          // Create district meta with placeholder facility count (will be corrected after processing)
          const districtMeta = {
            typeLabel: 'District',
            entityName: districtGroup.districtLabel,
            monthLabel: date,
            facilityCount: 0, // Will be updated with actual count
            plType: 'Standard'
          };
          
          const districtResult = await pnlRenderService.generatePNLReport(
            districtData,
            districtYtdData,
            districtMeta,
            accountConfig,
            childrenMap,
            sectionConfig
          );
          
          // Only include district if it has revenue
          if (!districtResult.noRevenue) {
            const districtHtmlIndex = htmlParts.length; // Remember position for later update
            htmlParts.push(districtResult.html); // Temporary placeholder
            totalDistrictCount++; // Count this district (has revenue)
            
            // 3b. Generate facility P&Ls for customers in this district (filter in memory)
            let districtFacilityCount = 0;
            for (const customer of districtGroup.customers) {
              const facilityData = accountService.filterDataByCustomers(allCustomersData, [customer.customer_internal_id]);
              const facilityYtdData = accountService.filterDataByCustomers(allCustomersYtdData, [customer.customer_internal_id]);
              
              const facilityMeta = {
                typeLabel: 'Facility',
                entityName: customer.label,
                monthLabel: date,
                parentDistrict: districtGroup.districtLabel,
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
                districtFacilityCount++;
              }
            }
            
            console.log(`     ✓ Generated district summary + ${districtFacilityCount} facility P&Ls`);
            totalFacilityCount += districtFacilityCount;
            
            // Regenerate district header with actual facility count
            districtMeta.facilityCount = districtFacilityCount;
            const correctedDistrictResult = await pnlRenderService.generatePNLReport(
              districtData,
              districtYtdData,
              districtMeta,
              accountConfig,
              childrenMap,
              sectionConfig
            );
            
            // Replace district HTML with corrected version
            htmlParts[districtHtmlIndex] = correctedDistrictResult.html;
          } else {
            console.log(`     ⊘ District has no revenue, skipping`);
          }
        }
        
        console.log(`✅ Generated region summary + ${totalDistrictCount} districts + ${totalFacilityCount} facility P&Ls`);
        console.log(`   🚀 Performance: Used only 4 BigQuery queries instead of ${2 + queryParams.districtGroups.length * 2 + queryParams.customersInRegion.length * 2}`);
        
        // Regenerate region header with actual counts (only districts/facilities with revenue)
        regionMeta.districtCount = totalDistrictCount;
        regionMeta.facilityCount = totalFacilityCount;
        
        console.log(`   🔄 Regenerating region header with actual counts: ${totalDistrictCount} districts, ${totalFacilityCount} facilities`);
        const correctedRegionResult = await pnlRenderService.generatePNLReport(
          regionData,
          regionYtdData,
          regionMeta,
          accountConfig,
          childrenMap,
          sectionConfig
        );
        
        // Replace the region HTML with the corrected version
        htmlParts[regionHtmlIndex] = correctedRegionResult.html;
        
        res.json({
          html: htmlParts.join('\n'),
          noRevenue: totalNoRevenue,
          hierarchy,
          selectedId,
          selectedLabel,
          date,
          districtCount: totalDistrictCount,
          facilityCount: totalFacilityCount,
          meta: regionMeta
        });
      } else if (hierarchy === 'subsidiary') {
        // ============================================
        // Multi-Level Subsidiary P&L Rendering
        // ============================================
        // 
        // Structure: Subsidiary -> Regions -> Districts -> Facilities
        // 
        // Process:
        // 1. Query BigQuery for subsidiary summary (2 queries: Month + YTD)
        // 2. Query BigQuery for ALL customers in subsidiary (2 queries: Month + YTD)
        // 3. Filter data in memory for each region, district, and facility
        // 4. Regenerate headers with actual counts after processing
        // 
        // Performance: Only 4 BigQuery queries total, regardless of number of customers
        // 
        // Optional Region Filter:
        // - If regionFilter is provided, filters both subsidiary summary and customer list
        // - Filters by subsidiary_internal_id AND region_internal_id
        // 
        console.log('\n🏗️  Multi-Level Subsidiary P&L Generation');
        console.log('   Structure: Subsidiary -> Regions -> Districts -> Facilities');
        
        const subsidiaryId = queryParams.subsidiaryId;
        const regionGroups = queryParams.regionGroups;
        
        // Query 1 & 2: Subsidiary Summary (Month + YTD)
        console.log('\n📊 Step 1/4: Querying BigQuery for subsidiary summary...');
        const subsidiaryMonthData = await bigQueryService.getPLData({ 
          hierarchy: 'subsidiary', 
          subsidiaryId, 
          date, 
          accountConfig, 
          ytd: false 
        });
        const subsidiaryYtdData = await bigQueryService.getPLData({ 
          hierarchy: 'subsidiary', 
          subsidiaryId, 
          date, 
          accountConfig, 
          ytd: true 
        });
        
        // Query 3 & 4: All customers in subsidiary (Month + YTD)
        console.log('\n📊 Step 2/4: Querying BigQuery for all customers in subsidiary...');
        const allCustomerIds = regionGroups.flatMap(region => 
          region.districts.flatMap(district => 
            district.customers.map(c => c.customer_internal_id)
          )
        );
        
        console.log(`   Querying for ${allCustomerIds.length} customers...`);
        const allCustomersMonthData = await bigQueryService.getPLData({ 
          hierarchy: 'district', 
          customerIds: allCustomerIds, 
          date, 
          accountConfig, 
          ytd: false 
        });
        const allCustomersYtdData = await bigQueryService.getPLData({ 
          hierarchy: 'district', 
          customerIds: allCustomerIds, 
          date, 
          accountConfig, 
          ytd: true 
        });
        
        console.log('   ✅ Query complete - processing results in memory...');
        
        // Step 3/4: Generate subsidiary summary
        console.log('\n📝 Step 3/4: Generating subsidiary summary HTML...');
        let totalRegionCount = 0;
        let totalDistrictCount = 0;
        let totalFacilityCount = 0;
        
        const subsidiaryMeta = {
          typeLabel: 'Subsidiary',
          entityName: selectedLabel,
          monthLabel: date,
          plType: 'Standard',
          regionCount: 0,  // Will be updated after processing
          districtCount: 0,
          facilityCount: 0
        };
        
        const subsidiaryResult = await pnlRenderService.generatePNLReport(
          subsidiaryMonthData,
          subsidiaryYtdData,
          subsidiaryMeta,
          accountConfig,
          childrenMap,
          sectionConfig
        );
        
        if (subsidiaryResult.noRevenue) {
          console.log('   ⚠️  Subsidiary has no revenue - skipping multi-level rendering');
          return res.json({
            html: subsidiaryResult.html,
            noRevenue: true,
            hierarchy,
            selectedId,
            selectedLabel,
            date,
            meta: subsidiaryMeta
          });
        }
        
        let subsidiaryHeaderHtml = subsidiaryResult.html.split('<div class="pnl-content">')[0];
        
        // Step 4/4: Generate region, district, and facility reports
        console.log('\n📝 Step 4/4: Generating region, district, and facility reports...');
        const regionReports = [];
        
        for (const region of regionGroups) {
          console.log(`\n   Processing Region: ${region.regionLabel}`);
          
          // Get all customer IDs for this region
          const regionCustomerIds = region.districts.flatMap(d => 
            d.customers.map(c => c.customer_internal_id)
          );
          
          // Filter data for this region
          const regionMonthData = accountService.filterDataByCustomers(allCustomersMonthData, regionCustomerIds);
          const regionYtdData = accountService.filterDataByCustomers(allCustomersYtdData, regionCustomerIds);
          
          // Generate region summary
          const regionMeta = {
            typeLabel: 'Region',
            entityName: region.regionLabel,
            monthLabel: date,
            plType: 'Standard',
            districtCount: 0,  // Will be updated
            facilityCount: 0
          };
          
          const regionResult = await pnlRenderService.generatePNLReport(
            regionMonthData,
            regionYtdData,
            regionMeta,
            accountConfig,
            childrenMap,
            sectionConfig
          );
          
          if (regionResult.noRevenue) {
            console.log(`      ⚠️  Region "${region.regionLabel}" has no revenue - skipping`);
            continue;
          }
          
          totalRegionCount++;
          let regionDistrictCount = 0;
          let regionFacilityCount = 0;
          
          let regionHeaderHtml = regionResult.html.split('<div class="pnl-content">')[0];
          const districtReports = [];
          
          // Generate district and facility reports for this region
          for (const district of region.districts) {
            console.log(`      Processing District: ${district.districtLabel} (${district.customers.length} customers)`);
            
            const districtCustomerIds = district.customers.map(c => c.customer_internal_id);
            
            // Filter data for this district
            const districtMonthData = accountService.filterDataByCustomers(allCustomersMonthData, districtCustomerIds);
            const districtYtdData = accountService.filterDataByCustomers(allCustomersYtdData, districtCustomerIds);
            
            // Generate district summary
            const districtMeta = {
              typeLabel: 'District',
              entityName: district.districtLabel,
              monthLabel: date,
              plType: 'Standard',
              facilityCount: 0  // Will be updated
            };
            
            const districtResult = await pnlRenderService.generatePNLReport(
              districtMonthData,
              districtYtdData,
              districtMeta,
              accountConfig,
              childrenMap,
              sectionConfig
            );
            
            if (districtResult.noRevenue) {
              console.log(`         ⚠️  District "${district.districtLabel}" has no revenue - skipping`);
              continue;
            }
            
            totalDistrictCount++;
            regionDistrictCount++;
            let districtHeaderHtml = districtResult.html.split('<div class="pnl-content">')[0];
            const facilityReports = [];
            let districtFacilityCount = 0;
            
            // Generate facility reports for this district
            for (const customer of district.customers) {
              const facilityMonthData = accountService.filterDataByCustomers(allCustomersMonthData, [customer.customer_internal_id]);
              const facilityYtdData = accountService.filterDataByCustomers(allCustomersYtdData, [customer.customer_internal_id]);
              
              const facilityMeta = {
                typeLabel: 'Facility',
                entityName: customer.label,
                monthLabel: date,
                plType: 'Standard'
              };
              
              const facilityResult = await pnlRenderService.generatePNLReport(
                facilityMonthData,
                facilityYtdData,
                facilityMeta,
                accountConfig,
                childrenMap,
                sectionConfig
              );
              
              if (facilityResult.noRevenue) {
                continue;
              }
              
              facilityReports.push(facilityResult.html);
              districtFacilityCount++;
              regionFacilityCount++;
              totalFacilityCount++;
            }
            
            // Update district header with facility count
            districtMeta.facilityCount = districtFacilityCount;
            const updatedDistrictHeaderHtml = await pnlRenderService.generateHeader(districtMeta);
            
            // Reconstruct district HTML with updated header
            const districtParts = districtResult.html.split('<hr class="pnl-divider">');
            const districtContentHtml = districtParts[1];
            const completeDistrictHtml = `    <div class="pnl-report-container page-break">
      ${updatedDistrictHeaderHtml}
      <hr class="pnl-divider">${districtContentHtml}`;
            
            districtReports.push(completeDistrictHtml);
            districtReports.push(...facilityReports);
            
            console.log(`         ✅ District complete: ${districtFacilityCount} facilities with revenue`);
          }
          
          // Update region header with district and facility counts
          regionMeta.districtCount = regionDistrictCount;
          regionMeta.facilityCount = regionFacilityCount;
          const updatedRegionHeaderHtml = await pnlRenderService.generateHeader(regionMeta);
          
          // Reconstruct region HTML with updated header
          const regionParts = regionResult.html.split('<hr class="pnl-divider">');
          const regionContentHtml = regionParts[1];
          const completeRegionHtml = `    <div class="pnl-report-container page-break">
      ${updatedRegionHeaderHtml}
      <hr class="pnl-divider">${regionContentHtml}`;
          
          regionReports.push(completeRegionHtml);
          regionReports.push(...districtReports);
          
          console.log(`      ✅ Region complete: ${regionDistrictCount} districts, ${regionFacilityCount} facilities`);
        }
        
        // Update subsidiary header with region, district, and facility counts
        subsidiaryMeta.regionCount = totalRegionCount;
        subsidiaryMeta.districtCount = totalDistrictCount;
        subsidiaryMeta.facilityCount = totalFacilityCount;
        const updatedSubsidiaryHeaderHtml = await pnlRenderService.generateHeader(subsidiaryMeta);
        
        // Reconstruct subsidiary HTML with updated header
        const subsidiaryParts = subsidiaryResult.html.split('<hr class="pnl-divider">');
        const subsidiaryContentHtml = subsidiaryParts[1];
        const completeSubsidiaryHtml = `    <div class="pnl-report-container page-break">
      ${updatedSubsidiaryHeaderHtml}
      <hr class="pnl-divider">${subsidiaryContentHtml}`;
        
        const finalHtml = [completeSubsidiaryHtml, ...regionReports].join('\n\n');
        
        console.log(`\n✅ Multi-level subsidiary P&L complete!`);
        console.log(`   Summary: ${totalRegionCount} regions, ${totalDistrictCount} districts, ${totalFacilityCount} facilities`);
        console.log(`   Total BigQuery queries: 4 (2 for subsidiary summary + 2 for all customers)`);
        
        res.json({
          html: finalHtml,
          noRevenue: false,
          hierarchy,
          selectedId,
          selectedLabel,
          date,
          regionCount: totalRegionCount,
          districtCount: totalDistrictCount,
          facilityCount: totalFacilityCount,
          meta: subsidiaryMeta
        });
      } else {
        return res.status(400).json({ 
          error: 'Invalid hierarchy type',
          code: 'INVALID_HIERARCHY'
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

  // ============================================
  // Dimension Configuration API Endpoints
  // ============================================

  /**
   * Get account configuration
   * 
   * GET /api/config/account
   * 
   * Response:
   *   {
   *     "node_id": {
   *       "parent": "parent_id_or_null",
   *       "label": "Account Name",
   *       "account_internal_id": 123,
   *       ...
   *     }
   *   }
   */
  router.get('/config/account', async (req, res) => {
    try {
      const config = await storageService.getFileAsJson('account_config.json');
      res.json(config);
    } catch (error) {
      console.error('Error fetching account config:', error);
      res.status(500).json({ 
        error: error.message,
        code: 'CONFIG_FETCH_ERROR'
      });
    }
  });

  /**
   * Get customer configuration
   * 
   * GET /api/config/customer
   */
  router.get('/config/customer', async (req, res) => {
    try {
      const config = await storageService.getFileAsJson('customer_config.json');
      res.json(config);
    } catch (error) {
      console.error('Error fetching customer config:', error);
      res.status(500).json({ 
        error: error.message,
        code: 'CONFIG_FETCH_ERROR'
      });
    }
  });

  /**
   * Get department configuration
   * 
   * GET /api/config/department
   */
  router.get('/config/department', async (req, res) => {
    try {
      const config = await storageService.getFileAsJson('department_config.json');
      res.json(config);
    } catch (error) {
      console.error('Error fetching department config:', error);
      res.status(500).json({ 
        error: error.message,
        code: 'CONFIG_FETCH_ERROR'
      });
    }
  });

  /**
   * Get region configuration
   * 
   * GET /api/config/region
   */
  router.get('/config/region', async (req, res) => {
    try {
      const config = await storageService.getFileAsJson('region_config.json');
      res.json(config);
    } catch (error) {
      console.error('Error fetching region config:', error);
      res.status(500).json({ 
        error: error.message,
        code: 'CONFIG_FETCH_ERROR'
      });
    }
  });

  /**
   * Get vendor configuration
   * 
   * GET /api/config/vendor
   */
  router.get('/config/vendor', async (req, res) => {
    try {
      const config = await storageService.getFileAsJson('vendor_config.json');
      res.json(config);
    } catch (error) {
      console.error('Error fetching vendor config:', error);
      res.status(500).json({ 
        error: error.message,
        code: 'CONFIG_FETCH_ERROR'
      });
    }
  });

  /**
   * GET /api/accounts
   * 
   * Get all accounts from dim_accounts table
   * 
   * Response: Array of {account_internal_id, display_name}
   */
  router.get('/accounts', async (req, res) => {
    try {
      const accounts = await bigQueryService.getAccounts();
      res.json(accounts);
    } catch (error) {
      console.error('Error fetching accounts:', error);
      res.status(500).json({ 
        error: 'Failed to fetch accounts',
        code: 'ACCOUNTS_FETCH_ERROR'
      });
    }
  });

  /**
   * GET /api/customers
   * 
   * Get all customers from dim_customers table
   * 
   * Response: Array of {customer_id, display_name, display_name_with_id}
   */
  router.get('/customers', async (req, res) => {
    try {
      const customers = await bigQueryService.getCustomers();
      res.json(customers);
    } catch (error) {
      console.error('Error fetching customers:', error);
      res.status(500).json({ 
        error: 'Failed to fetch customers',
        code: 'CUSTOMERS_FETCH_ERROR'
      });
    }
  });

  /**
   * PUT /api/config/:dimension
   * 
   * Save configuration for a specific dimension
   * 
   * Request body: Complete configuration object
   * Response: { success: true }
   */
  router.put('/config/:dimension', async (req, res) => {
    try {
      const { dimension } = req.params;
      const config = req.body;
      
      // Validate dimension
      const validDimensions = ['account', 'customer', 'department', 'region', 'vendor'];
      if (!validDimensions.includes(dimension)) {
        return res.status(400).json({ 
          error: 'Invalid dimension',
          code: 'INVALID_DIMENSION'
        });
      }
      
      // Validate config is an object
      if (!config || typeof config !== 'object') {
        return res.status(400).json({ 
          error: 'Invalid configuration data',
          code: 'INVALID_CONFIG'
        });
      }
      
      const filename = `${dimension}_config.json`;
      await storageService.saveFileAsJson(filename, config);
      
      console.log(`✅ Saved ${filename} to GCS`);
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error saving config:', error);
      res.status(500).json({ 
        error: 'Failed to save configuration',
        code: 'CONFIG_SAVE_ERROR'
      });
    }
  });

  return router;
}

module.exports = createApiRoutes;

