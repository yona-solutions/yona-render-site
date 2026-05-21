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
const googleSheetsService = require('../services/googleSheetsService');
const censusService = require('../services/censusService');


function normalizeCensusMonth(date) {
  if (!date) return null;
  return `${date.substring(0, 7)}-01`;
}

function normalizeCensusService(service) {
  if (service == null) return null;
  const normalized = String(service).trim().toUpperCase();
  return normalized || null;
}

function getCustomerCodeFromLabel(label) {
  if (!label) return null;
  // Match uppercase letters followed by digits at the start (e.g. RED41, BAR91, FFB91)
  const match = String(label).match(/^([A-Z]{2,5}\d{2,3})\b/);
  if (match) return match[1];
  // Fallback: split on ' - '
  const parts = String(label).split(' - ');
  return parts.length > 0 ? parts[0].trim() : null;
}

function collectCustomerCodes(customers) {
  if (!Array.isArray(customers)) return [];
  const codeSet = new Set();
  for (const customer of customers) {
    const code = customer?.customer_code || getCustomerCodeFromLabel(customer?.label);
    if (code) codeSet.add(code);
  }
  return Array.from(codeSet);
}

function uniqueCustomersById(customers) {
  if (!Array.isArray(customers)) return [];
  const seen = new Set();
  const unique = [];
  for (const customer of customers) {
    const id = customer?.customer_internal_id;
    if (id == null) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(customer);
  }
  return unique;
}

function sumCensusForCodes(censusRecords, customerCodes, date, options = {}) {
  const month = normalizeCensusMonth(date);
  const serviceFilter = normalizeCensusService(options.service);
  if (!month || !censusRecords || censusRecords.length === 0 || !customerCodes || customerCodes.length === 0) {
    return { actual: null, budget: null, headcount: null };
  }

  const codeSet = new Set(customerCodes.filter(Boolean));
  let actualTotal = 0;
  let budgetTotal = 0;
  let headcountTotal = 0;
  let actualFound = false;
  let budgetFound = false;
  let headcountFound = false;

  for (const record of censusRecords) {
    if (!record || record.month !== month) continue;
    if (!codeSet.has(record.customerCode)) continue;
    if (serviceFilter && normalizeCensusService(record.service) !== serviceFilter) continue;
    if (record.type === 'Actuals') {
      actualTotal += Number(record.value) || 0;
      actualFound = true;
    } else if (record.type === 'Budget') {
      budgetTotal += Number(record.value) || 0;
      budgetFound = true;
    } else if (record.type === 'Headcount') {
      headcountTotal += Number(record.value) || 0;
      headcountFound = true;
    }
  }

  return {
    actual: actualFound ? actualTotal : null,
    budget: budgetFound ? budgetTotal : null,
    headcount: headcountFound ? headcountTotal : null
  };
}

function sumCensusForCustomers(censusRecords, customers, date, options = {}) {
  const codes = collectCustomerCodes(customers);
  return sumCensusForCodes(censusRecords, codes, date, options);
}

function sumSubsidiarySummaryCensus(censusRecords, customers, date, serviceLabel = null) {
  // When the Subsidiary page has no explicit service filter, default the
  // top-level census rollup to Dietary instead of combining EVS + Dietary.
  const effectiveService = serviceLabel || 'Dietary';
  return sumCensusForCustomers(censusRecords, customers, date, {
    service: effectiveService
  });
}

function isCustomerPnlHidden(customer) {
  return Boolean(customer?.customerPnlHidden);
}

function isNoCustomer(customer) {
  return customer?.customer_internal_id != null && Number(customer.customer_internal_id) === 0;
}

function isCustomerPnlCountExcluded(customer) {
  return isNoCustomer(customer) || Boolean(customer?.customerPnlCountExcluded);
}

function shouldCountDistrict(district) {
  return !district?.districtSummaryExcluded && !district?.districtPnlCountExcluded;
}

function shouldCountFacility(customer) {
  return !isCustomerPnlCountExcluded(customer);
}

function getOrgLabelFromQuery(query) {
  const rawValue = Array.isArray(query?.orgLabel) ? query.orgLabel[0] : query?.orgLabel;
  const orgLabel = rawValue == null ? '' : String(rawValue).trim();
  return orgLabel || null;
}

function parseBooleanQuery(value) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (rawValue == null) return false;
  return ['1', 'true', 'yes', 'on'].includes(String(rawValue).trim().toLowerCase());
}

function applyOrgLabel(meta, orgLabel) {
  if (orgLabel) {
    meta.orgLabel = orgLabel;
  }
  return meta;
}

async function generateCustomerSummaryAndFacilityReport({
  bigQueryService,
  accountConfig,
  childrenMap,
  sectionConfig,
  censusRecords,
  summaryTypeLabel,
  entityName,
  customers,
  customerIds,
  date,
  reportPlType,
  orgLabel,
  subsidiaryId = null,
  subsidiaryFilterName = null,
  summaryParentRegion = '',
  resolveFacilityContext
}) {
  console.log(`   Querying BigQuery for ${summaryTypeLabel.toLowerCase()} summary (Month + YTD)...`);
  const monthData = await bigQueryService.getPLData({
    hierarchy: 'district',
    customerIds,
    subsidiaryId,
    date,
    accountConfig,
    ytd: false
  });
  const ytdData = await bigQueryService.getPLData({
    hierarchy: 'district',
    customerIds,
    subsidiaryId,
    date,
    accountConfig,
    ytd: true
  });

  const summaryCensus = sumCensusForCustomers(censusRecords, customers, date);
  const summaryMeta = {
    typeLabel: summaryTypeLabel,
    entityName,
    monthLabel: date,
    facilityCount: 0,
    plType: reportPlType,
    parentRegion: summaryParentRegion || '',
    actualCensus: summaryCensus.actual,
    budgetCensus: summaryCensus.budget,
    headcount: summaryCensus.headcount
  };
  applyOrgLabel(summaryMeta, orgLabel);
  if (subsidiaryFilterName) {
    summaryMeta.subsidiaryFilterName = subsidiaryFilterName;
  }

  console.log(`   Generating ${summaryTypeLabel.toLowerCase()} summary P&L (header will be updated with actual counts)...`);
  const summaryResult = await pnlRenderService.generatePNLReport(
    monthData,
    ytdData,
    summaryMeta,
    accountConfig,
    childrenMap,
    sectionConfig
  );

  if (summaryResult.noRevenue) {
    return {
      html: '',
      noRevenue: true,
      facilityCount: 0,
      meta: summaryMeta
    };
  }

  console.log(`   ✅ Query complete - processing facility P&Ls in memory...`);
  const facilityReports = [];
  let facilityCount = 0;

  for (const customer of customers) {
    const facilityMonthData = accountService.filterDataByCustomers(monthData, [customer.customer_internal_id]);
    const facilityYtdData = accountService.filterDataByCustomers(ytdData, [customer.customer_internal_id]);

    const customerCode = customer.customer_code || getCustomerCodeFromLabel(customer.label);
    const census = sumCensusForCodes(censusRecords, customerCode ? [customerCode] : [], date);
    const facilityContext = typeof resolveFacilityContext === 'function'
      ? (resolveFacilityContext(customer) || {})
      : {};

    const facilityMeta = {
      typeLabel: 'Facility',
      entityName: customer.label,
      monthLabel: date,
      parentDistrict: facilityContext.parentDistrict || entityName,
      parentRegion: facilityContext.parentRegion || summaryParentRegion || '',
      plType: reportPlType,
      actualCensus: census.actual,
      budgetCensus: census.budget,
      headcount: census.headcount,
      startDateEst: customer.start_date_est
    };
    applyOrgLabel(facilityMeta, orgLabel);

    const facilityResult = await pnlRenderService.generatePNLReport(
      facilityMonthData,
      facilityYtdData,
      facilityMeta,
      accountConfig,
      childrenMap,
      sectionConfig
    );

    if (!facilityResult.noRevenue) {
      if (!isCustomerPnlHidden(customer)) {
        facilityReports.push(facilityResult.html);
      }
      if (shouldCountFacility(customer)) {
        facilityCount++;
      }
    }
  }

  summaryMeta.facilityCount = facilityCount;
  const updatedSummaryHeaderHtml = await pnlRenderService.generateHeader(summaryMeta);
  const parts = summaryResult.html.split('<hr class="pnl-divider">');
  const summaryContentHtml = parts[1] || '';
  const completeSummaryHtml = `    <div class="pnl-report-container page-break">
      ${updatedSummaryHeaderHtml}
      <hr class="pnl-divider">${summaryContentHtml}`;

  return {
    html: [completeSummaryHtml, ...facilityReports].join('\n\n'),
    noRevenue: false,
    facilityCount,
    meta: summaryMeta
  };
}

/**
 * Configure API routes
 * 
 * @param {StorageService} storageService - Storage service instance
 * @param {BigQueryService} bigQueryService - BigQuery service instance
 * @returns {Router} Configured Express router
 */
function createApiRoutes(storageService, bigQueryService, pgPool) {
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
   * Get customer tags from customer configuration
   *
   * GET /api/storage/customer-tags
   */
  router.get('/storage/customer-tags', async (req, res) => {
    try {
      const customerTags = await storageService.getCustomerTags();
      res.json(customerTags);
    } catch (error) {
      console.error('Error fetching customer tags:', error);
      res.status(500).json({
        error: error.message,
        code: 'CUSTOMER_TAGS_FETCH_ERROR'
      });
    }
  });

  /**
   * Get services from customer configuration
   *
   * GET /api/storage/services
   */
  router.get('/storage/services', async (req, res) => {
    try {
      const services = await storageService.getServices();
      res.json(services);
    } catch (error) {
      console.error('Error fetching services:', error);
      res.status(500).json({ error: error.message, code: 'SERVICES_FETCH_ERROR' });
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
   * Get P&L HTML for subsidiary with Server-Sent Events for progress updates
   *
   * GET /api/pl/data-stream?hierarchy=subsidiary&selectedId=101&date=2025-12-01
   *
   * This endpoint streams progress updates while generating the P&L report.
   * Only supports subsidiary hierarchy; other hierarchies should use /api/pl/data
   *
   * SSE Events:
   *   - progress: { type: "progress", step: "step-id", message: "...", detail: "..." }
   *   - complete: { type: "complete", result: {...} }
   *   - error: { type: "error", error: "..." }
   */
  router.get('/pl/data-stream', async (req, res) => {
    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Helper to send SSE events
    const sendProgress = (step, message, detail = null) => {
      const data = { type: 'progress', step, message, detail };
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const sendComplete = (result) => {
      const data = { type: 'complete', result };
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      res.end();
    };

    const sendError = (error) => {
      const data = { type: 'error', error: error.message || error };
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      res.end();
    };

    try {
      const { hierarchy, selectedId, date, plType } = req.query;
      const orgLabel = getOrgLabelFromQuery(req.query);
      const applySubsidiaryFilterToDetail = parseBooleanQuery(req.query.applySubsidiaryFilterToDetail);

      // Validate required parameters
      if (!hierarchy || !selectedId || !date) {
        return sendError('Missing required parameters: hierarchy, selectedId, date');
      }

      // Only support subsidiary hierarchy for streaming
      if (hierarchy !== 'subsidiary') {
        return sendError('Streaming only supported for subsidiary hierarchy');
      }

      const reportPlType = plType === 'operational' ? 'Operational' : 'Standard';
      console.log(`📊 [SSE] Generating P&L report: hierarchy=${hierarchy}, selectedId=${selectedId}, date=${date}`);

      // Parse selectedId
      let actualId, selectedLabel;
      if (selectedId.startsWith('tag_')) {
        actualId = selectedId;
        selectedLabel = selectedId.substring(4);
      } else if (selectedId.includes(' - ')) {
        const parts = selectedId.split(' - ');
        actualId = parts[0];
        selectedLabel = parts.slice(1).join(' - ');
      } else {
        actualId = selectedId;
        selectedLabel = selectedId;
      }

      // Load configurations
      const accountConfig = await storageService.getFileAsJson('account_config.json');
      const childrenMap = accountService.buildChildrenMap(accountConfig);
      const sectionConfig = accountService.getSectionConfig();
      const censusRecords = censusService.isAvailable() ? await censusService.fetchCensusData() : [];

      // ============================================================================
      // SUBSIDIARY P&L QUERY HIERARCHY
      // ============================================================================
      // Each level queries BigQuery directly using its own dimension filter.
      // DO NOT substitute customer-level data for subsidiary or region summaries.
      //
      //   Subsidiary  →  WHERE subsidiary_internal_id = @subsidiaryId
      //   Region      →  WHERE region_internal_id = @regionId AND subsidiary_internal_id = @subsidiaryId
      //   District    →  WHERE customer_internal_id IN UNNEST(@customerIds)  (customers in district)
      //   Facility    →  WHERE customer_internal_id IN UNNEST(@customerIds)  (single customer)
      //
      // WHY: Formula accounts (Gross Profit, Net Income, etc.) exist in
      // fct_transactions_summary at both the subsidiary level and the customer
      // level. The per-customer formula values do NOT sum to the subsidiary-level
      // value. If we aggregate customer rows for the subsidiary summary, formula
      // accounts will be incorrect. The same applies to region summaries.
      //
      // The customer-level bulk query (allCustomersMonthData / allCustomersYtdData)
      // is ONLY used to derive district and facility breakdowns via client-side
      // filtering with filterDataByCustomers().
      // ============================================================================

      // Step 1: Get subsidiary internal ID(s)
      sendProgress('subsidiary-summary', 'Fetching subsidiary summary...');

      const subsidiaryResult = await storageService.getSubsidiaryInternalId(actualId);
      if (!subsidiaryResult) {
        return sendError(`Subsidiary not found: ${actualId}`);
      }

      const { subsidiaryIds, subsidiaryName, isTag } = subsidiaryResult;
      const subsidiaryId = subsidiaryIds.length === 1 ? subsidiaryIds[0] : subsidiaryIds;
      if (!selectedLabel || selectedLabel === actualId) {
        selectedLabel = subsidiaryName;
      }

      // Get customers in subsidiary
      let customersInSubsidiary = await bigQueryService.getCustomersInSubsidiary(subsidiaryIds);
      if (!customersInSubsidiary || customersInSubsidiary.length === 0) {
        return sendError(`No customers found for subsidiary: ${selectedLabel}`);
      }

      // Optional district tag filter (subsidiary hierarchy only)
      const districtTagFilter = req.query.districtTagFilter;
      const hasDistrictTagFilter = Boolean(districtTagFilter && districtTagFilter !== 'all');
      if (hasDistrictTagFilter) {
        const tagResult = await storageService.getCustomersForDistrict(districtTagFilter);
        const tagCustomerIds = new Set(tagResult.customers.map(c => c.customer_internal_id));
        customersInSubsidiary = customersInSubsidiary.filter(c => tagCustomerIds.has(c.customer_internal_id));

        if (customersInSubsidiary.length === 0) {
          return sendError('No customers found for selected district tag within subsidiary');
        }

        console.log(`   📎 Applying district tag filter: ${tagResult.districtName} (${customersInSubsidiary.length} customers)`);
      }

      // Optional service filter (subsidiary hierarchy only)
      const serviceFilter = req.query.serviceFilter;
      let serviceCustomerIds = null;
      let serviceLabel = null;
      if (serviceFilter && serviceFilter !== 'all') {
        const serviceResult = await storageService.getCustomersForService(serviceFilter);
        const serviceCustomerIdSet = new Set(serviceResult.customers.map(c => c.customer_internal_id));
        customersInSubsidiary = customersInSubsidiary.filter(c => serviceCustomerIdSet.has(c.customer_internal_id));
        if (customersInSubsidiary.length === 0) {
          return sendError('No customers found for selected service within subsidiary');
        }
        serviceCustomerIds = customersInSubsidiary.map(c => c.customer_internal_id);
        serviceLabel = serviceResult.serviceName;
        console.log(`   ⚙️ Applying service filter: ${serviceResult.serviceName} (${customersInSubsidiary.length} customers)`);
      }
      const hasServiceFilter = Boolean(serviceFilter && serviceFilter !== 'all');

      // Group customers by region and district
      const regionGroups = await storageService.groupCustomersByRegionAndDistrict(customersInSubsidiary);

      const allowedCustomerIds = Array.from(new Set(
        regionGroups.flatMap(region =>
          region.districts.flatMap(district =>
            district.customers.map(c => c.customer_internal_id)
          )
        )
      ));

      // Log subsidiary structure: regions and their customers
      console.log(`\n📋 Subsidiary structure: ${selectedLabel}`);
      const structureSummary = regionGroups.map(r => ({
        region: r.regionLabel,
        customers: r.districts.flatMap(d => d.customers.map(c => c.customer_internal_id))
      }));
      for (const r of structureSummary) {
        console.log(`   Region ${r.region}: ${r.customers.length} customers [${r.customers.join(', ')}]`);
      }

      const subsidiaryCensus = sumSubsidiarySummaryCensus(
        censusRecords,
        uniqueCustomersById(regionGroups.flatMap(r => r.districts.filter(d => !d.districtSummaryExcluded).flatMap(d => d.customers))),
        date,
        serviceLabel
      );

      // Step 2: Fetch subsidiary summary.
      // With service filter: use customer IDs (intentional — summary must reflect only service customers).
      // Without service filter: always query by subsidiary_internal_id (formula accounts are wrong when summed from customer level).
      sendProgress('subsidiary-summary', 'Fetching subsidiary data...');

      const subsidiaryMonthDataRaw = await bigQueryService.getPLData(
        hasServiceFilter
          ? { hierarchy: 'district', customerIds: serviceCustomerIds, date, accountConfig, ytd: false }
          : { hierarchy: 'subsidiary', subsidiaryId, date, accountConfig, ytd: false }
      );
      const subsidiaryYtdDataRaw = await bigQueryService.getPLData(
        hasServiceFilter
          ? { hierarchy: 'district', customerIds: serviceCustomerIds, date, accountConfig, ytd: true }
          : { hierarchy: 'subsidiary', subsidiaryId, date, accountConfig, ytd: true }
      );
      const subsidiaryMonthData = hasServiceFilter
        ? accountService.filterDataByCustomers(subsidiaryMonthDataRaw, serviceCustomerIds, null, subsidiaryId)
        : subsidiaryMonthDataRaw;
      const subsidiaryYtdData = hasServiceFilter
        ? accountService.filterDataByCustomers(subsidiaryYtdDataRaw, serviceCustomerIds, null, subsidiaryId)
        : subsidiaryYtdDataRaw;

      // Fetch all customer data — ONLY used for district and facility breakdowns.
      // Do NOT use this data for subsidiary or region summaries (see header comment).
      sendProgress('customer-data', 'Fetching facility data...');

      const allCustomerIds = allowedCustomerIds;

      const allCustomersMonthData = await bigQueryService.getPLData({
        hierarchy: 'district',
        customerIds: allCustomerIds,
        subsidiaryId: applySubsidiaryFilterToDetail ? subsidiaryId : null,
        date,
        accountConfig,
        ytd: false
      });
      const allCustomersYtdData = await bigQueryService.getPLData({
        hierarchy: 'district',
        customerIds: allCustomerIds,
        subsidiaryId: applySubsidiaryFilterToDetail ? subsidiaryId : null,
        date,
        accountConfig,
        ytd: true
      });

      // Step 3: Generate subsidiary report
      sendProgress('generating-subsidiary', 'Generating reports...');

      let totalRegionCount = 0;
      let totalDistrictCount = 0;
      let totalFacilityCount = 0;
      const totalFacilitySeen = new Set();
      const totalRevenueFacilitySeen = new Set();

      const subsidiaryMeta = {
        typeLabel: isTag ? 'Subsidiary Tag' : 'Subsidiary',
        entityName: hasServiceFilter ? `${selectedLabel} — Service: ${serviceLabel}` : selectedLabel,
        monthLabel: date,
        plType: reportPlType,
        regionCount: 0,
        districtCount: 0,
        facilityCount: 0,
        actualCensus: subsidiaryCensus.actual,
        budgetCensus: subsidiaryCensus.budget,
        headcount: subsidiaryCensus.headcount
      };
      applyOrgLabel(subsidiaryMeta, orgLabel);
      subsidiaryMeta.detailSubsidiaryFilterApplied = applySubsidiaryFilterToDetail;

      const subsidiaryResultReport = await pnlRenderService.generatePNLReport(
        subsidiaryMonthData,
        subsidiaryYtdData,
        subsidiaryMeta,
        accountConfig,
        childrenMap,
        sectionConfig
      );

      if (subsidiaryResultReport.noRevenue) {
        return sendComplete({
          html: subsidiaryResultReport.html,
          noRevenue: true,
          hierarchy,
          selectedId,
          selectedLabel,
          date,
          meta: subsidiaryMeta
        });
      }

      // Step 4: Process regions
      const regionReports = [];
      const totalRegions = regionGroups.length;

      for (let regionIdx = 0; regionIdx < regionGroups.length; regionIdx++) {
        const region = regionGroups[regionIdx];

        sendProgress('processing-regions', 'Processing regions...', `Region ${regionIdx + 1} of ${totalRegions}: ${region.regionLabel}`);

        const regionCustomerIds = region.districts.flatMap(district =>
          district.customers.map(c => c.customer_internal_id)
        );

        // Query region summary.
        // With service filter: use only the intersection of region customers and service customers.
        // Without service filter: query by region_internal_id (formula accounts are wrong when summed from customer level).
        const serviceCustomerIdSet = hasServiceFilter ? new Set(serviceCustomerIds) : null;
        const regionServiceCustomerIds = hasServiceFilter
          ? regionCustomerIds.filter(id => serviceCustomerIdSet.has(id))
          : null;
        const regionMonthDataRaw = await bigQueryService.getPLData(
          hasServiceFilter
            ? { hierarchy: 'district', customerIds: regionServiceCustomerIds, date, accountConfig, ytd: false }
            : { hierarchy: 'region', regionId: region.regionInternalId, subsidiaryId: subsidiaryId, date, accountConfig, ytd: false }
        );
        const regionYtdDataRaw = await bigQueryService.getPLData(
          hasServiceFilter
            ? { hierarchy: 'district', customerIds: regionServiceCustomerIds, date, accountConfig, ytd: true }
            : { hierarchy: 'region', regionId: region.regionInternalId, subsidiaryId: subsidiaryId, date, accountConfig, ytd: true }
        );
        const regionMonthData = hasServiceFilter
          ? accountService.filterDataByCustomers(regionMonthDataRaw, regionServiceCustomerIds, region.regionInternalId, subsidiaryId)
          : regionMonthDataRaw;
        const regionYtdData = hasServiceFilter
          ? accountService.filterDataByCustomers(regionYtdDataRaw, regionServiceCustomerIds, region.regionInternalId, subsidiaryId)
          : regionYtdDataRaw;

        const regionCustomers = uniqueCustomersById(
          region.districts.filter(d => !d.districtSummaryExcluded).flatMap(district => district.customers)
        );
        const regionCensus = sumCensusForCustomers(censusRecords, regionCustomers, date);

        const regionMeta = {
          typeLabel: 'Region',
          entityName: region.regionLabel,
          monthLabel: date,
          plType: reportPlType,
          districtCount: 0,
          facilityCount: 0,
          actualCensus: regionCensus.actual,
          budgetCensus: regionCensus.budget,
          headcount: regionCensus.headcount
        };
        applyOrgLabel(regionMeta, orgLabel);

        const regionResult = await pnlRenderService.generatePNLReport(
          regionMonthData,
          regionYtdData,
          regionMeta,
          accountConfig,
          childrenMap,
          sectionConfig
        );

        if (regionResult.noRevenue) {
          continue;
        }

        totalRegionCount++;
        let regionDistrictCount = 0;
        let regionFacilityCount = 0;
        const regionFacilitySeen = new Set();

        const districtReports = [];

        for (const district of region.districts) {
          const districtCustomerIds = district.customers.map(c => c.customer_internal_id);
          // Customer 0 spans all regions/subsidiaries in fct_transactions_summary;
          // pass the current context so only this report section's slice is included.
          const noCustomerRegionId = districtCustomerIds.includes(0) ? region.regionInternalId : null;
          const noCustomerSubsidiaryId = districtCustomerIds.includes(0) ? subsidiaryId : null;
          const districtMonthData = accountService.filterDataByCustomers(allCustomersMonthData, districtCustomerIds, noCustomerRegionId, noCustomerSubsidiaryId);
          const districtYtdData = accountService.filterDataByCustomers(allCustomersYtdData, districtCustomerIds, noCustomerRegionId, noCustomerSubsidiaryId);

        const districtCensus = sumCensusForCustomers(censusRecords, district.customers, date);

        const districtMeta = {
          typeLabel: 'District',
          entityName: district.districtLabel,
          monthLabel: date,
          plType: reportPlType,
          facilityCount: 0,
          parentRegion: district.districtRegion || region.regionLabel,
          actualCensus: districtCensus.actual,
          budgetCensus: districtCensus.budget,
          headcount: districtCensus.headcount
        };
        applyOrgLabel(districtMeta, orgLabel);

          const districtResult = await pnlRenderService.generatePNLReport(
            districtMonthData,
            districtYtdData,
            districtMeta,
            accountConfig,
            childrenMap,
            sectionConfig
          );
          
          if (districtResult.noRevenue) {
            continue;
          }
          
          if (shouldCountDistrict(district)) {
            totalDistrictCount++;
            regionDistrictCount++;
          }
          
          const facilityReports = [];
          let districtFacilityCount = 0;

          for (const customer of district.customers) {
            const facilityRegionId = customer.customer_internal_id === 0 ? region.regionInternalId : null;
            const facilitySubsidiaryId = customer.customer_internal_id === 0 ? subsidiaryId : null;
            const facilityMonthData = accountService.filterDataByCustomers(allCustomersMonthData, [customer.customer_internal_id], facilityRegionId, facilitySubsidiaryId);
            const facilityYtdData = accountService.filterDataByCustomers(allCustomersYtdData, [customer.customer_internal_id], facilityRegionId, facilitySubsidiaryId);

            const customerCode = customer.customer_code || getCustomerCodeFromLabel(customer.label);
            const census = sumCensusForCodes(censusRecords, customerCode ? [customerCode] : [], date);

            const facilityMeta = {
              typeLabel: 'Facility',
              entityName: customer.label,
              monthLabel: date,
              plType: reportPlType,
              actualCensus: census.actual,
              budgetCensus: census.budget,
              headcount: census.headcount,
              startDateEst: customer.start_date_est,
              parentDistrict: district.districtLabel,
              parentRegion: district.districtRegion || region.regionLabel
            };
            applyOrgLabel(facilityMeta, orgLabel);

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

            if (!isCustomerPnlHidden(customer)) {
              facilityReports.push(facilityResult.html);
            }
            totalRevenueFacilitySeen.add(customer.customer_internal_id);
            if (shouldCountFacility(customer)) {
              districtFacilityCount++;
            }
            if (!district.districtSummaryExcluded && shouldCountFacility(customer)) {
              if (!regionFacilitySeen.has(customer.customer_internal_id)) {
                regionFacilitySeen.add(customer.customer_internal_id);
                regionFacilityCount++;
              }
              if (!totalFacilitySeen.has(customer.customer_internal_id)) {
                totalFacilitySeen.add(customer.customer_internal_id);
                totalFacilityCount++;
              }
            }
          }

          if (!district.districtSummaryExcluded) {
            // Update district header with facility count
            districtMeta.facilityCount = districtFacilityCount;
            const updatedDistrictHeaderHtml = await pnlRenderService.generateHeader(districtMeta);

            const districtParts = districtResult.html.split('<hr class="pnl-divider">');
            const districtContentHtml = districtParts[1];
            const completeDistrictHtml = `    <div class="pnl-report-container page-break">
      ${updatedDistrictHeaderHtml}
      <hr class="pnl-divider">${districtContentHtml}`;

            districtReports.push(completeDistrictHtml);
          }
          districtReports.push(...facilityReports);
        }

        // Update region header
        regionMeta.districtCount = regionDistrictCount;
        regionMeta.facilityCount = regionFacilityCount;
        const updatedRegionHeaderHtml = await pnlRenderService.generateHeader(regionMeta);

        const regionParts = regionResult.html.split('<hr class="pnl-divider">');
        const regionContentHtml = regionParts[1];
        const completeRegionHtml = `    <div class="pnl-report-container page-break">
      ${updatedRegionHeaderHtml}
      <hr class="pnl-divider">${regionContentHtml}`;

        regionReports.push(completeRegionHtml);
        regionReports.push(...districtReports);
      }

      // Step 5: Finalize
      sendProgress('finalizing', 'Finalizing reports...');

      // Build region → customers structure filtered to only revenue-bearing facilities
      subsidiaryMeta.regionStructure = regionGroups.map(r => {
        const seen = new Set();
        const customers = [];
        for (const d of r.districts) {
          for (const c of d.customers) {
            const id = c.customer_internal_id;
            if (id != null && !seen.has(id) && totalRevenueFacilitySeen.has(id)) {
              seen.add(id);
              customers.push(c.label || id);
            }
          }
        }
        return { region: r.regionLabel, customers };
      }).filter(r => r.customers.length > 0);

      // Update subsidiary header
      subsidiaryMeta.regionCount = totalRegionCount;
      subsidiaryMeta.districtCount = totalDistrictCount;
      subsidiaryMeta.facilityCount = totalFacilityCount;
      const updatedSubsidiaryHeaderHtml = await pnlRenderService.generateHeader(subsidiaryMeta);

      const subsidiaryParts = subsidiaryResultReport.html.split('<hr class="pnl-divider">');
      const subsidiaryContentHtml = subsidiaryParts[1];
      const completeSubsidiaryHtml = `    <div class="pnl-report-container page-break">
      ${updatedSubsidiaryHeaderHtml}
      <hr class="pnl-divider">${subsidiaryContentHtml}`;

      const finalHtml = [completeSubsidiaryHtml, ...regionReports].join('\n\n');

      console.log(`✅ [SSE] Multi-level subsidiary P&L complete!`);
      console.log(`   Summary: ${totalRegionCount} regions, ${totalDistrictCount} districts, ${totalFacilityCount} facilities`);

      sendComplete({
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

    } catch (error) {
      console.error('[SSE] Error generating P&L report:', error);
      sendError(error.message || 'Failed to generate P&L report');
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
      const { hierarchy, selectedId, date, plType } = req.query;
      const orgLabel = getOrgLabelFromQuery(req.query);
      const applySubsidiaryFilterToDetail = parseBooleanQuery(req.query.applySubsidiaryFilterToDetail);

      // Validate required parameters
      if (!hierarchy || !selectedId || !date) {
        return res.status(400).json({ 
          error: 'Missing required parameters',
          code: 'INVALID_PARAMETERS',
          required: ['hierarchy', 'selectedId', 'date']
        });
      }
      
      // Get P&L Type (Standard or Operational), default to Standard
      const reportPlType = plType === 'operational' ? 'Operational' : 'Standard';
      console.log(`   📊 P&L Type: ${reportPlType}`);

      // Validate hierarchy type
      if (!['district', 'region', 'subsidiary', 'customer_tag'].includes(hierarchy)) {
        return res.status(400).json({ 
          error: 'Invalid hierarchy type',
          code: 'INVALID_HIERARCHY',
          allowed: ['district', 'region', 'subsidiary', 'customer_tag']
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

      const censusRecords = censusService.isAvailable() ? await censusService.fetchCensusData() : [];

      let queryParams = { hierarchy, date, accountConfig };

      // Get the appropriate IDs based on hierarchy type
      if (hierarchy === 'district') {
        // Get full customer details for this district or district tag
        // Tags are treated as districts - they just aggregate multiple districts' customers
        const districtResult = await storageService.getCustomersForDistrict(actualId);
        let { customers, districtName, isTag, districtRegion } = districtResult;

        if (customers.length === 0) {
          return res.status(404).json({
            error: 'No customers found for selected district',
            code: 'NO_CUSTOMERS_FOUND'
          });
        }

        // Check for optional subsidiary filter
        const subsidiaryFilter = req.query.subsidiaryFilter;

        if (subsidiaryFilter && subsidiaryFilter !== 'all') {
          const subsidiaryResult = await storageService.getSubsidiaryInternalId(subsidiaryFilter);

          if (!subsidiaryResult) {
            return res.status(404).json({
              error: 'Subsidiary not found',
              code: 'SUBSIDIARY_NOT_FOUND'
            });
          }

          const subsidiaryIds = subsidiaryResult.subsidiaryIds;
          console.log(`   Using subsidiary filter: subsidiary_internal_id=${JSON.stringify(subsidiaryIds)}`);

          // Query dim_customers to find which of these customers belong to the filtered subsidiary.
          // The subsidiary dimension is stored as an array on dim_customers, so we need
          // to check containment rather than compare the array column directly.
          const customerInternalIds = customers.map(c => c.customer_internal_id);
          const subsidiaryWhereClause = subsidiaryIds.length === 1
            ? '@subsidiaryId IN UNNEST(subsidiary_internal_id)'
            : 'EXISTS (SELECT 1 FROM UNNEST(subsidiary_internal_id) AS sid WHERE sid IN UNNEST(@subsidiaryIds))';
          const subsidiaryQueryParams = subsidiaryIds.length === 1
            ? { customerIds: customerInternalIds, subsidiaryId: subsidiaryIds[0] }
            : { customerIds: customerInternalIds, subsidiaryIds };
          const [rows] = await bigQueryService.bigquery.query({
            query: `
              SELECT customer_id
              FROM \`yona-solutions-poc.dbt_production.dim_customers\`
              WHERE customer_id IN UNNEST(@customerIds)
                AND ${subsidiaryWhereClause}
            `,
            location: 'US',
            params: subsidiaryQueryParams
          });

          const validCustomerIds = new Set(rows.map(r => r.customer_id));
          customers = customers.filter(c => validCustomerIds.has(c.customer_internal_id));
          console.log(`   Filtered to ${customers.length} customers after subsidiary filter`);

          if (customers.length === 0) {
            return res.status(404).json({
              error: 'No customers found for selected district/subsidiary combination',
              code: 'NO_CUSTOMERS_FOUND'
            });
          }

          queryParams.subsidiaryId = subsidiaryIds.length === 1 ? subsidiaryIds[0] : subsidiaryIds;
          queryParams.subsidiaryFilterName = subsidiaryResult.subsidiaryName;
        }

        // Update selectedLabel to use the district display name
        selectedLabel = districtName;

        const customerIds = customers.map(c => c.customer_internal_id);
        queryParams.customerIds = customerIds;
        queryParams.customers = customers; // Store full customer details for facility P&Ls
        queryParams.isTag = isTag; // Store whether this is a tag for header generation
        queryParams.districtRegion = districtRegion || '';
        console.log(`   Found ${customerIds.length} customer IDs for ${isTag ? 'tag' : 'district'}: ${districtName}`);
      } else if (hierarchy === 'customer_tag') {
        const customerTagResult = await storageService.getCustomersForCustomerTag(actualId);
        const { customers, customerTagName } = customerTagResult;

        if (customers.length === 0) {
          return res.status(404).json({
            error: 'No customers found for selected customer tag',
            code: 'NO_CUSTOMERS_FOUND'
          });
        }

        selectedLabel = customerTagName;

        const customerIds = customers.map(c => c.customer_internal_id);
        queryParams.customerIds = customerIds;
        queryParams.customers = customers;
        console.log(`   Found ${customerIds.length} customer IDs for customer tag: ${customerTagName}`);
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
          
          subsidiaryId = subsidiaryResult.subsidiaryIds.length === 1
            ? subsidiaryResult.subsidiaryIds[0]
            : subsidiaryResult.subsidiaryIds;
          queryParams.subsidiaryFilterName = subsidiaryResult.subsidiaryName;
          console.log(`   Using subsidiary filter: subsidiary_internal_id=${JSON.stringify(subsidiaryId)}`);
        }
        
        // Get customers in this region from dim_customers (optionally filtered by subsidiary)
        let customersInRegion = await bigQueryService.getCustomersInRegion(regionId, subsidiaryId);
        
        if (customersInRegion.length === 0) {
          return res.status(404).json({ 
            error: 'No customers found for selected region/subsidiary combination',
            code: 'NO_CUSTOMERS_FOUND'
          });
        }

        // Optional customer tag filter (region hierarchy only)
        const customerTagFilter = req.query.customerTagFilter;
        if (customerTagFilter && customerTagFilter !== 'all') {
          const customerTagResult = await storageService.getCustomersForCustomerTag(customerTagFilter);
          const tagCustomerIds = new Set(customerTagResult.customers.map(c => c.customer_internal_id));
          customersInRegion = customersInRegion.filter(c => tagCustomerIds.has(c.customer_internal_id));

          if (customersInRegion.length === 0) {
            return res.status(404).json({
              error: 'No customers found for selected customer tag within region',
              code: 'NO_CUSTOMERS_FOUND'
            });
          }

          queryParams.customerTagFilter = customerTagFilter;
          queryParams.customerTagFilterName = customerTagResult.customerTagName;
          console.log(`   🏷️ Applying customer tag filter: ${customerTagResult.customerTagName} (${customersInRegion.length} customers)`);
        }
        
        // Group customers by their parent district
        const districtGroups = await storageService.groupCustomersByDistrict(customersInRegion);
        const allowedCustomerIds = Array.from(new Set(
          districtGroups.flatMap(group =>
            group.customers.map(c => c.customer_internal_id)
          )
        ));
        const exclusionsApplied = allowedCustomerIds.length !== customersInRegion.length;
        
        queryParams.regionId = regionId;
        queryParams.subsidiaryId = subsidiaryId; // Will be null if not filtered
        queryParams.customersInRegion = customersInRegion;
        queryParams.districtGroups = districtGroups;
        queryParams.allowedCustomerIds = allowedCustomerIds;
        queryParams.exclusionsApplied = exclusionsApplied;
        
        const filterDesc = subsidiaryId 
          ? `region_internal_id=${regionId} AND subsidiary_internal_id=${subsidiaryId}`
          : `region_internal_id=${regionId}`;
        console.log(`   Using filters: ${filterDesc}`);
        console.log(`   Found ${customersInRegion.length} customers in ${districtGroups.length} districts`);
        if (exclusionsApplied) {
          console.log(`   ⚠️  District reporting exclusions applied: ${allowedCustomerIds.length} customers included`);
        }
      } else if (hierarchy === 'subsidiary') {
        // Get subsidiary internal ID(s) and name
        // Handles both single subsidiaries and subsidiary tags (multiple subsidiaries)
        const subsidiaryResult = await storageService.getSubsidiaryInternalId(actualId);
        
        if (!subsidiaryResult) {
          return res.status(404).json({ 
            error: 'Subsidiary not found',
            code: 'SUBSIDIARY_NOT_FOUND'
          });
        }
        
        const { subsidiaryIds, subsidiaryName, isTag } = subsidiaryResult;
        selectedLabel = subsidiaryName; // Use the subsidiary name or tag name in the header
        
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
        
        // Get customers in subsidiary/subsidiaries from dim_customers
        // For tags, this will fetch customers from ALL subsidiaries with that tag
        console.log(`   Fetching customers from dim_customers...`);
        let customersInSubsidiary = await bigQueryService.getCustomersInSubsidiary(subsidiaryIds, regionId);

        // Optional district tag filter (subsidiary hierarchy only)
        const districtTagFilter = req.query.districtTagFilter;
        if (districtTagFilter && districtTagFilter !== 'all') {
          const tagResult = await storageService.getCustomersForDistrict(districtTagFilter);
          const tagCustomerIds = new Set(tagResult.customers.map(c => c.customer_internal_id));
          customersInSubsidiary = customersInSubsidiary.filter(c => tagCustomerIds.has(c.customer_internal_id));

          if (customersInSubsidiary.length === 0) {
            return res.status(404).json({
              error: 'No customers found for selected district tag within subsidiary',
              code: 'NO_CUSTOMERS_FOUND'
            });
          }

          queryParams.districtTagFilter = districtTagFilter;
          queryParams.districtTagLabel = tagResult.districtName;
          console.log(`   📎 Applying district tag filter: ${tagResult.districtName} (${customersInSubsidiary.length} customers)`);
        }

        // Optional service filter (subsidiary hierarchy only)
        const serviceFilter = req.query.serviceFilter;
        if (serviceFilter && serviceFilter !== 'all') {
          const serviceResult = await storageService.getCustomersForService(serviceFilter);
          const serviceCustomerIdSet = new Set(serviceResult.customers.map(c => c.customer_internal_id));
          customersInSubsidiary = customersInSubsidiary.filter(c => serviceCustomerIdSet.has(c.customer_internal_id));
          if (customersInSubsidiary.length === 0) {
            return res.status(404).json({ error: 'No customers found for selected service within subsidiary', code: 'NO_CUSTOMERS_FOUND' });
          }
          queryParams.serviceFilter = true;
          queryParams.serviceCustomerIds = customersInSubsidiary.map(c => c.customer_internal_id);
          queryParams.serviceLabel = serviceResult.serviceName;
          console.log(`   ⚙️ Applying service filter: ${serviceResult.serviceName} (${customersInSubsidiary.length} customers)`);
        }

        // Group customers by region, then by district
        const regionGroups = await storageService.groupCustomersByRegionAndDistrict(customersInSubsidiary);

        const allowedCustomerIds = Array.from(new Set(
          regionGroups.flatMap(region =>
            region.districts.flatMap(district =>
              district.customers.map(c => c.customer_internal_id)
            )
          )
        ));
        const exclusionsApplied = allowedCustomerIds.length !== customersInSubsidiary.length;
        
        // For BigQuery queries, pass the array of subsidiary IDs
        // Single subsidiaries will have array length of 1, tags will have multiple
        queryParams.subsidiaryId = subsidiaryIds.length === 1 ? subsidiaryIds[0] : subsidiaryIds;
        queryParams.regionGroups = regionGroups;
        queryParams.isTag = isTag; // Store whether this is a tag for header generation
        queryParams.customersInSubsidiary = customersInSubsidiary;
        queryParams.allowedCustomerIds = allowedCustomerIds;
        queryParams.exclusionsApplied = exclusionsApplied;
        queryParams.applySubsidiaryFilterToDetail = applySubsidiaryFilterToDetail;
        
        const filterDesc = regionId 
          ? `subsidiary_internal_id IN [${subsidiaryIds.join(', ')}] AND region_internal_id=${regionId}`
          : `subsidiary_internal_id IN [${subsidiaryIds.join(', ')}]`;
        console.log(`   Using filters: ${filterDesc}`);
        console.log(`   Found ${customersInSubsidiary.length} customers in ${regionGroups.length} regions`);
        console.log(`   ${isTag ? 'Tag' : 'Single subsidiary'}: ${subsidiaryName}`);
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
        const districtReport = await generateCustomerSummaryAndFacilityReport({
          bigQueryService,
          accountConfig,
          childrenMap,
          sectionConfig,
          censusRecords,
          summaryTypeLabel: queryParams.isTag ? 'District Tag' : 'District',
          entityName: selectedLabel,
          customers: queryParams.customers,
          customerIds: queryParams.customerIds,
          date,
          reportPlType,
          orgLabel,
          subsidiaryId: queryParams.subsidiaryId || null,
          subsidiaryFilterName: queryParams.subsidiaryFilterName || null,
          summaryParentRegion: queryParams.districtRegion || '',
          resolveFacilityContext: () => ({
            parentDistrict: selectedLabel,
            parentRegion: queryParams.districtRegion || ''
          })
        });

        totalNoRevenue = districtReport.noRevenue;

        console.log(`✅ Generated district summary + ${districtReport.facilityCount} facility P&Ls`);

        res.json({
          html: districtReport.html,
          noRevenue: totalNoRevenue,
          hierarchy,
          selectedId,
          selectedLabel,
          date,
          facilityCount: districtReport.facilityCount,
          meta: districtReport.meta
        });
      } else if (hierarchy === 'customer_tag') {
        const customerTagReport = await generateCustomerSummaryAndFacilityReport({
          bigQueryService,
          accountConfig,
          childrenMap,
          sectionConfig,
          censusRecords,
          summaryTypeLabel: 'Customer Tag',
          entityName: selectedLabel,
          customers: queryParams.customers,
          customerIds: queryParams.customerIds,
          date,
          reportPlType,
          orgLabel,
          resolveFacilityContext: customer => ({
            parentDistrict: customer.parentDistrictLabel || selectedLabel,
            parentRegion: customer.parentRegion || ''
          })
        });

        totalNoRevenue = customerTagReport.noRevenue;

        console.log(`✅ Generated customer tag summary + ${customerTagReport.facilityCount} facility P&Ls`);

        res.json({
          html: customerTagReport.html,
          noRevenue: totalNoRevenue,
          hierarchy,
          selectedId,
          selectedLabel,
          date,
          facilityCount: customerTagReport.facilityCount,
          meta: customerTagReport.meta
        });
      } else if (hierarchy === 'region') {
        // Multi-level region rendering: Region Summary -> District Summaries -> Facility P&Ls
        //
        // QUERY HIERARCHY (same principle as subsidiary tab — see header comment above):
        //   Region   →  WHERE region_internal_id = @regionId [AND subsidiary_internal_id = @subsidiaryId]
        //             or customer_internal_id IN UNNEST(@customerIds) when customer-tag filtered
        //   District →  WHERE customer_internal_id IN UNNEST(@customerIds)
        //   Facility →  WHERE customer_internal_id IN UNNEST(@customerIds)
        //
        // Without a customer-tag filter, query region summary directly by
        // region_internal_id. With a customer-tag filter, intentionally switch
        // to customer-level queries so the summary reflects only the tagged subset.

        const hasCustomerTagFilter = Boolean(queryParams.customerTagFilterName);
        const regionCustomerIds = queryParams.allowedCustomerIds;

        // 1. Generate region summary P&L
        console.log('   Querying BigQuery for region summary (Month + YTD)...');
        const regionDataRaw = await bigQueryService.getPLData(
          hasCustomerTagFilter
            ? {
                hierarchy: 'district',
                customerIds: regionCustomerIds,
                subsidiaryId: queryParams.subsidiaryId || null,
                date,
                accountConfig,
                ytd: false
              }
            : {
                hierarchy: 'region',
                regionId: queryParams.regionId,
                subsidiaryId: queryParams.subsidiaryId,
                date,
                accountConfig,
                ytd: false
              }
        );
        const regionYtdDataRaw = await bigQueryService.getPLData(
          hasCustomerTagFilter
            ? {
                hierarchy: 'district',
                customerIds: regionCustomerIds,
                subsidiaryId: queryParams.subsidiaryId || null,
                date,
                accountConfig,
                ytd: true
              }
            : {
                hierarchy: 'region',
                regionId: queryParams.regionId,
                subsidiaryId: queryParams.subsidiaryId,
                date,
                accountConfig,
                ytd: true
              }
        );
        const regionData = hasCustomerTagFilter
          ? accountService.filterDataByCustomers(
              regionDataRaw,
              regionCustomerIds,
              queryParams.regionId,
              queryParams.subsidiaryId
            )
          : regionDataRaw;
        const regionYtdData = hasCustomerTagFilter
          ? accountService.filterDataByCustomers(
              regionYtdDataRaw,
              regionCustomerIds,
              queryParams.regionId,
              queryParams.subsidiaryId
            )
          : regionYtdDataRaw;
        
        const regionCustomersForCensus = uniqueCustomersById(
          queryParams.districtGroups.flatMap(group => group.customers)
        );
        const regionCensus = sumCensusForCustomers(censusRecords, regionCustomersForCensus, date);

        // Region summaries include census rollup
        const regionMeta = {
          typeLabel: 'Region',
          entityName: selectedLabel,
          monthLabel: date,
          districtCount: 0, // Will be updated after processing
          facilityCount: 0, // Will be updated after processing
          plType: reportPlType,
          actualCensus: regionCensus.actual,
          budgetCensus: regionCensus.budget,
          headcount: regionCensus.headcount
        };
        applyOrgLabel(regionMeta, orgLabel);
        if (queryParams.subsidiaryFilterName) {
          regionMeta.subsidiaryFilterName = queryParams.subsidiaryFilterName;
        }
        if (queryParams.customerTagFilterName) {
          regionMeta.customerTagFilterName = queryParams.customerTagFilterName;
        }
        
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
        console.log(`   Querying BigQuery for all ${queryParams.allowedCustomerIds.length} customers (Month + YTD)...`);
        const allCustomerIds = queryParams.allowedCustomerIds;
        const allCustomersQueryParams = {
          hierarchy: 'district',
          customerIds: allCustomerIds,
          subsidiaryId: queryParams.subsidiaryId || null,
          date,
          accountConfig
        };
        
        const allCustomersData = await bigQueryService.getPLData({ ...allCustomersQueryParams, ytd: false });
        const allCustomersYtdData = await bigQueryService.getPLData({ ...allCustomersQueryParams, ytd: true });
        
        console.log(`   ✅ Retrieved data for all customers. Now filtering in memory...`);
        
        // 3. Generate district summaries and facility P&Ls by filtering the data in memory
        console.log(`   Generating P&Ls for ${queryParams.districtGroups.length} groups (tags + districts)...`);
        let totalFacilityCount = 0;
        const totalFacilitySeen = new Set();
        let totalDistrictCount = 0; // Track districts/tags that pass the visibility rule
        
        for (const districtGroup of queryParams.districtGroups) {
          const districtCustomerIds = districtGroup.customers.map(c => c.customer_internal_id);
          
          // 3a. Filter data for this district/tag (in memory, no BigQuery call)
          const groupType = districtGroup.isTag ? 'District Tag' : 'District';
          console.log(`   - ${groupType}: ${districtGroup.districtLabel} (${districtCustomerIds.length} customers)`);
          const districtData = accountService.filterDataByCustomers(allCustomersData, districtCustomerIds);
          const districtYtdData = accountService.filterDataByCustomers(allCustomersYtdData, districtCustomerIds);
          
          const districtCensus = sumCensusForCustomers(censusRecords, districtGroup.customers, date);

          // Create district meta with placeholder facility count (will be corrected after processing)
          const districtMeta = {
            typeLabel: groupType,
            entityName: districtGroup.districtLabel,
            monthLabel: date,
            facilityCount: 0, // Will be updated with actual count
            plType: reportPlType,
            parentRegion: districtGroup.districtRegion || selectedLabel,
            actualCensus: districtCensus.actual,
            budgetCensus: districtCensus.budget,
            headcount: districtCensus.headcount
          };
          applyOrgLabel(districtMeta, orgLabel);
          
          const districtResult = await pnlRenderService.generatePNLReport(
            districtData,
            districtYtdData,
            districtMeta,
            accountConfig,
            childrenMap,
            sectionConfig
          );
          
          // Only include district if it passes the summary visibility rule
          if (!districtResult.noRevenue) {
            let districtHtmlIndex = null;
            if (!districtGroup.districtSummaryExcluded) {
              districtHtmlIndex = htmlParts.length; // Remember position for later update
              htmlParts.push(districtResult.html); // Temporary placeholder
              if (shouldCountDistrict(districtGroup)) {
                totalDistrictCount++; // Count this district (visible summary)
              }
            }
            
            // 3b. Generate facility P&Ls for customers in this district (filter in memory)
            let districtFacilityCount = 0;
            for (const customer of districtGroup.customers) {
              const facilityData = accountService.filterDataByCustomers(allCustomersData, [customer.customer_internal_id]);
              const facilityYtdData = accountService.filterDataByCustomers(allCustomersYtdData, [customer.customer_internal_id]);
              
              const customerCode = customer.customer_code || getCustomerCodeFromLabel(customer.label);
              const census = sumCensusForCodes(censusRecords, customerCode ? [customerCode] : [], date);
              
              const facilityMeta = {
                typeLabel: 'Facility',
                entityName: customer.label,
                monthLabel: date,
                parentDistrict: districtGroup.districtLabel,
                parentRegion: districtGroup.districtRegion || selectedLabel,
                plType: reportPlType,
                actualCensus: census.actual,
                budgetCensus: census.budget,
                headcount: census.headcount,
                startDateEst: customer.start_date_est
              };
              applyOrgLabel(facilityMeta, orgLabel);
              
              const facilityResult = await pnlRenderService.generatePNLReport(
                facilityData,
                facilityYtdData,
                facilityMeta,
                accountConfig,
                childrenMap,
                sectionConfig
              );
              
              // Only include facilities that pass the visibility rule
              if (!facilityResult.noRevenue) {
                if (!isCustomerPnlHidden(customer)) {
                  htmlParts.push(facilityResult.html);
                }
                if (shouldCountFacility(customer)) {
                  districtFacilityCount++;
                }
                if (shouldCountFacility(customer) && !totalFacilitySeen.has(customer.customer_internal_id)) {
                  totalFacilitySeen.add(customer.customer_internal_id);
                  totalFacilityCount++;
                }
              }
            }
            
            console.log(`     ✓ Generated district summary + ${districtFacilityCount} facility P&Ls`);
            // totalFacilityCount updated via unique facility tracking
            
            if (districtHtmlIndex !== null) {
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
            }
          } else {
            console.log(`     ⊘ District did not meet visibility rule, skipping`);
          }
        }
        
        console.log(`✅ Generated region summary + ${totalDistrictCount} districts + ${totalFacilityCount} facility P&Ls`);
        console.log(`   🚀 Performance: Used only 4 BigQuery queries instead of ${2 + queryParams.districtGroups.length * 2 + queryParams.customersInRegion.length * 2}`);
        
        // Regenerate region header with actual counts (only visible districts/facilities)
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
        // ============================================================================
        // Multi-Level Subsidiary P&L Rendering
        // ============================================================================
        //
        // QUERY HIERARCHY — each level queries BigQuery by its own dimension filter.
        // DO NOT substitute customer-level data for subsidiary or region summaries.
        //
        //   Subsidiary →  WHERE subsidiary_internal_id = @subsidiaryId
        //   Region     →  WHERE region_internal_id = @regionId AND subsidiary_internal_id = @subsidiaryId
        //   District   →  WHERE customer_internal_id IN UNNEST(@customerIds)
        //   Facility   →  WHERE customer_internal_id IN UNNEST(@customerIds)
        //
        // WHY: Formula accounts (Gross Profit, Net Income, etc.) exist in
        // fct_transactions_summary at both the subsidiary level and the customer
        // level. The per-customer formula values do NOT sum to the subsidiary-level
        // value. The same applies to region summaries.
        //
        // The customer-level bulk query (allCustomersMonthData / allCustomersYtdData)
        // is ONLY used to derive district and facility breakdowns.
        // ============================================================================
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
        const hasDistrictTagFilter = Boolean(queryParams.districtTagFilter);
        const hasServiceFilter = Boolean(queryParams.serviceFilter);
        const serviceCustomerIds = queryParams.serviceCustomerIds || null;
        const serviceCustomerIdSet = hasServiceFilter ? new Set(serviceCustomerIds) : null;
        const hasReportingExclusions = Boolean(queryParams.exclusionsApplied);

        // Query 1 & 2: Subsidiary Summary (Month + YTD)
        // With service filter: use customer IDs (intentional — summary must reflect only service customers).
        // Without service filter: always query by subsidiary_internal_id — formula accounts are wrong when summed from customer level.
        console.log('\n📊 Step 1/4: Querying BigQuery for subsidiary summary...');
        const subsidiaryMonthDataRaw = await bigQueryService.getPLData(
          hasServiceFilter
            ? { hierarchy: 'district', customerIds: serviceCustomerIds, date, accountConfig, ytd: false }
            : { hierarchy: 'subsidiary', subsidiaryId, date, accountConfig, ytd: false }
        );
        const subsidiaryYtdDataRaw = await bigQueryService.getPLData(
          hasServiceFilter
            ? { hierarchy: 'district', customerIds: serviceCustomerIds, date, accountConfig, ytd: true }
            : { hierarchy: 'subsidiary', subsidiaryId, date, accountConfig, ytd: true }
        );
        const subsidiaryMonthData = hasServiceFilter
          ? accountService.filterDataByCustomers(subsidiaryMonthDataRaw, serviceCustomerIds, null, subsidiaryId)
          : subsidiaryMonthDataRaw;
        const subsidiaryYtdData = hasServiceFilter
          ? accountService.filterDataByCustomers(subsidiaryYtdDataRaw, serviceCustomerIds, null, subsidiaryId)
          : subsidiaryYtdDataRaw;
        
        // Query 3 & 4: All customers in subsidiary (Month + YTD)
        console.log('\n📊 Step 2/4: Querying BigQuery for all customers in subsidiary...');
        const allCustomerIds = queryParams.allowedCustomerIds;
        
        console.log(`   Querying for ${allCustomerIds.length} customers...`);
        const allCustomersMonthData = await bigQueryService.getPLData({ 
          hierarchy: 'district', 
          customerIds: allCustomerIds, 
          subsidiaryId: queryParams.applySubsidiaryFilterToDetail ? subsidiaryId : null,
          date, 
          accountConfig, 
          ytd: false 
        });
        const allCustomersYtdData = await bigQueryService.getPLData({ 
          hierarchy: 'district', 
          customerIds: allCustomerIds, 
          subsidiaryId: queryParams.applySubsidiaryFilterToDetail ? subsidiaryId : null,
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
        const totalFacilitySeen = new Set();
        
        const subsidiaryCustomersForCensus = uniqueCustomersById(
          regionGroups.flatMap(region =>
            region.districts.filter(d => !d.districtSummaryExcluded).flatMap(district => district.customers)
          )
        );
        const subsidiaryCensus = sumSubsidiarySummaryCensus(
          censusRecords,
          subsidiaryCustomersForCensus,
          date,
          queryParams.serviceLabel || null
        );

        // Subsidiary summaries include census rollup
        const subsidiaryMeta = {
          typeLabel: queryParams.isTag ? 'Subsidiary Tag' : 'Subsidiary',
          entityName: hasServiceFilter ? `${selectedLabel} — Service: ${queryParams.serviceLabel}` : selectedLabel,
          monthLabel: date,
          plType: reportPlType,
          regionCount: 0,  // Will be updated after processing
          districtCount: 0,
          facilityCount: 0,
          actualCensus: subsidiaryCensus.actual,
          budgetCensus: subsidiaryCensus.budget,
          headcount: subsidiaryCensus.headcount
        };
        applyOrgLabel(subsidiaryMeta, orgLabel);
        subsidiaryMeta.detailSubsidiaryFilterApplied = queryParams.applySubsidiaryFilterToDetail;
        
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

          // Get all customer IDs for this region (used for district/facility filtering)
          const regionCustomerIds = region.districts.flatMap(d =>
            d.customers.map(c => c.customer_internal_id)
          );

          // Query region summary.
          // With service filter: use only the intersection of region customers and service customers.
          // Without service filter: query by region_internal_id (formula accounts are wrong when summed from customer level).
          console.log(`      Querying BigQuery for region summary (region_internal_id=${region.regionInternalId}, subsidiary_internal_id=${Array.isArray(subsidiaryId) ? subsidiaryId.join(',') : subsidiaryId})...`);
          const regionServiceCustomerIds = hasServiceFilter
            ? regionCustomerIds.filter(id => serviceCustomerIdSet.has(id))
            : null;
          const regionMonthDataRaw = await bigQueryService.getPLData(
            hasServiceFilter
              ? { hierarchy: 'district', customerIds: regionServiceCustomerIds, date, accountConfig, ytd: false }
              : { hierarchy: 'region', regionId: region.regionInternalId, subsidiaryId: subsidiaryId, date, accountConfig, ytd: false }
          );
          const regionYtdDataRaw = await bigQueryService.getPLData(
            hasServiceFilter
              ? { hierarchy: 'district', customerIds: regionServiceCustomerIds, date, accountConfig, ytd: true }
              : { hierarchy: 'region', regionId: region.regionInternalId, subsidiaryId: subsidiaryId, date, accountConfig, ytd: true }
          );
          const regionMonthData = hasServiceFilter
            ? accountService.filterDataByCustomers(regionMonthDataRaw, regionServiceCustomerIds, region.regionInternalId, subsidiaryId)
            : regionMonthDataRaw;
          const regionYtdData = hasServiceFilter
            ? accountService.filterDataByCustomers(regionYtdDataRaw, regionServiceCustomerIds, region.regionInternalId, subsidiaryId)
            : regionYtdDataRaw;

          const regionCustomers = uniqueCustomersById(
            region.districts.filter(d => !d.districtSummaryExcluded).flatMap(district => district.customers)
          );
          const regionCensus = sumCensusForCustomers(censusRecords, regionCustomers, date);

          // Region summaries include census rollup
          const regionMeta = {
            typeLabel: 'Region',
            entityName: region.regionLabel,
            monthLabel: date,
            plType: reportPlType,
            districtCount: 0,  // Will be updated
            facilityCount: 0,
            actualCensus: regionCensus.actual,
            budgetCensus: regionCensus.budget,
            headcount: regionCensus.headcount
          };
          applyOrgLabel(regionMeta, orgLabel);
          
          const regionResult = await pnlRenderService.generatePNLReport(
            regionMonthData,
            regionYtdData,
            regionMeta,
            accountConfig,
            childrenMap,
            sectionConfig
          );
          
          if (regionResult.noRevenue) {
            console.log(`      ⚠️  Region "${region.regionLabel}" did not meet visibility rule - skipping`);
            continue;
          }

          totalRegionCount++;
          let regionDistrictCount = 0;
          let regionFacilityCount = 0;
          const regionFacilitySeen = new Set();

          let regionHeaderHtml = regionResult.html.split('<div class="pnl-content">')[0];
          const districtReports = [];

          // Generate district and facility reports for this region
          for (const district of region.districts) {
            console.log(`      Processing District: ${district.districtLabel} (${district.customers.length} customers)`);

            const districtCustomerIds = district.customers.map(c => c.customer_internal_id);
            // Customer 0 spans all regions/subsidiaries; pass the current context so only
            // this section's transactions appear in the district/facility breakdown.
            const noCustomerRegionId = districtCustomerIds.includes(0) ? region.regionInternalId : null;
            const noCustomerSubsidiaryId = districtCustomerIds.includes(0) ? subsidiaryId : null;
            const districtMonthData = accountService.filterDataByCustomers(allCustomersMonthData, districtCustomerIds, noCustomerRegionId, noCustomerSubsidiaryId);
            const districtYtdData = accountService.filterDataByCustomers(allCustomersYtdData, districtCustomerIds, noCustomerRegionId, noCustomerSubsidiaryId);
            
            const districtCensus = sumCensusForCustomers(censusRecords, district.customers, date);

            // Generate district summary
            const districtMeta = {
              typeLabel: 'District',
              entityName: district.districtLabel,
              monthLabel: date,
              plType: reportPlType,
              facilityCount: 0,  // Will be updated
              parentRegion: district.districtRegion || region.regionLabel,
              actualCensus: districtCensus.actual,
              budgetCensus: districtCensus.budget,
              headcount: districtCensus.headcount
            };
            applyOrgLabel(districtMeta, orgLabel);
            
          const districtResult = await pnlRenderService.generatePNLReport(
            districtMonthData,
            districtYtdData,
            districtMeta,
            accountConfig,
            childrenMap,
            sectionConfig
          );
          
          if (districtResult.noRevenue) {
            console.log(`         ⚠️  District "${district.districtLabel}" did not meet visibility rule - skipping`);
            continue;
          }
          
          if (shouldCountDistrict(district)) {
            totalDistrictCount++;
            regionDistrictCount++;
          }
          let districtHeaderHtml = districtResult.html.split('<div class="pnl-content">')[0];
          const facilityReports = [];
          let districtFacilityCount = 0;
            
            // Generate facility reports for this district
            for (const customer of district.customers) {
              const facilityRegionId = customer.customer_internal_id === 0 ? region.regionInternalId : null;
              const facilitySubsidiaryId = customer.customer_internal_id === 0 ? subsidiaryId : null;
              const facilityMonthData = accountService.filterDataByCustomers(allCustomersMonthData, [customer.customer_internal_id], facilityRegionId, facilitySubsidiaryId);
              const facilityYtdData = accountService.filterDataByCustomers(allCustomersYtdData, [customer.customer_internal_id], facilityRegionId, facilitySubsidiaryId);

              const customerCode = customer.customer_code || getCustomerCodeFromLabel(customer.label);
              const census = sumCensusForCodes(censusRecords, customerCode ? [customerCode] : [], date);

              const facilityMeta = {
                typeLabel: 'Facility',
                entityName: customer.label,
                monthLabel: date,
                plType: reportPlType,
                actualCensus: census.actual,
                budgetCensus: census.budget,
                headcount: census.headcount,
                startDateEst: customer.start_date_est,
                parentDistrict: district.districtLabel,
                parentRegion: district.districtRegion || region.regionLabel
              };
              applyOrgLabel(facilityMeta, orgLabel);
              
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
              
              if (!isCustomerPnlHidden(customer)) {
                facilityReports.push(facilityResult.html);
              }
              if (shouldCountFacility(customer)) {
                districtFacilityCount++;
              }
              if (!district.districtSummaryExcluded && shouldCountFacility(customer)) {
                if (!regionFacilitySeen.has(customer.customer_internal_id)) {
                  regionFacilitySeen.add(customer.customer_internal_id);
                  regionFacilityCount++;
                }
                if (!totalFacilitySeen.has(customer.customer_internal_id)) {
                  totalFacilitySeen.add(customer.customer_internal_id);
                  totalFacilityCount++;
                }
              }
            }

            if (!district.districtSummaryExcluded) {
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
            }
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
      const config = await storageService.getFileAsJson('subsidiary_config.json');
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
   * Get scenario configuration
   * 
   * GET /api/config/scenario
   */
  router.get('/config/scenario', async (req, res) => {
    try {
      const config = await storageService.getFileAsJson('scenario_config.json');
      res.json(config);
    } catch (error) {
      if (error.message === 'File not found') {
        return res.json({});
      }
      console.error('Error fetching scenario config:', error);
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
   * GET /api/customers/explorer
   *
   * Get customers with region/subsidiary mapping for explorer view
   */
  router.get('/customers/explorer', async (req, res) => {
    try {
      const customers = await bigQueryService.getCustomerExplorerData();
      res.json(customers);
    } catch (error) {
      console.error('Error fetching customer explorer data:', error);
      res.status(500).json({
        error: 'Failed to fetch customer explorer data',
        code: 'CUSTOMERS_EXPLORER_FETCH_ERROR'
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
      const validDimensions = ['account', 'customer', 'department', 'region', 'vendor', 'scenario'];
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

      const filenameMap = { department: 'subsidiary' };
      const fileKey = filenameMap[dimension] || dimension;
      const filename = `${fileKey}_config.json`;
      await storageService.saveFileAsJson(filename, config);

      console.log(`✅ Saved ${filename} to GCS`);

      if (dimension === 'scenario') {
        const SYSTEM_SCENARIOS = new Set(['Actuals', 'Census Actuals', 'Census Budget']);

        // Stamp is_system and auto-assign scenario_internal_id where missing.
        // Use a _meta.lastAssignedId watermark so deleted IDs are never recycled.
        const meta = config._meta || {};
        const existingIds = Object.entries(config)
          .filter(([k]) => k !== '_meta')
          .map(([, n]) => n.scenario_internal_id)
          .filter(id => id != null)
          .map(Number);
        const highWatermark = Math.max(meta.lastAssignedId || 0, existingIds.length > 0 ? Math.max(...existingIds) : 0);
        let nextId = highWatermark + 1;
        let needsPersist = false;
        for (const [key, node] of Object.entries(config)) {
          if (key === '_meta') continue;
          const shouldBeSystem = SYSTEM_SCENARIOS.has(node.label);
          if (node.is_system !== shouldBeSystem) {
            node.is_system = shouldBeSystem;
            needsPersist = true;
          }
          if (node.scenario_internal_id == null) {
            node.scenario_internal_id = nextId++;
            needsPersist = true;
          }
        }
        // Always persist the watermark so it survives deletions
        const newWatermark = nextId - 1;
        if (!config._meta || config._meta.lastAssignedId !== newWatermark) {
          config._meta = { lastAssignedId: newWatermark };
          needsPersist = true;
        }
        if (needsPersist) {
          await storageService.saveFileAsJson(filename, config);
          console.log('✅ Persisted scenario metadata to GCS');
        }
        const count = await bigQueryService.syncScenarios(config);
        console.log(`✅ BQ scenario sync complete: ${count} rows`);
        return res.json({ success: true });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error saving config:', error);
      res.status(500).json({ 
        error: 'Failed to save configuration',
        code: 'CONFIG_SAVE_ERROR'
      });
    }
  });

  /**
   * Get all unique regions from BigQuery (for mapping dropdown)
   * 
   * GET /api/bq/regions
   */
  router.get('/bq/regions', async (req, res) => {
    try {
      const regions = await bigQueryService.getRegions();
      res.json(regions);
    } catch (error) {
      console.error('Error fetching regions:', error);
      res.status(500).json({
        error: 'Failed to fetch regions',
        message: error.message
      });
    }
  });

  /**
   * Get all unique subsidiaries from BigQuery (for mapping dropdown)
   * 
   * GET /api/bq/subsidiaries
   */
  router.get('/bq/subsidiaries', async (req, res) => {
    try {
      const subsidiaries = await bigQueryService.getSubsidiaries();
      res.json(subsidiaries);
    } catch (error) {
      console.error('Error fetching subsidiaries:', error);
      res.status(500).json({
        error: 'Failed to fetch subsidiaries',
        message: error.message
      });
    }
  });

  /**
   * Get unmapped accounts (accounts in BigQuery not in config)
   * 
   * GET /api/bq/unmapped-accounts
   */
  router.get('/bq/unmapped-accounts', async (req, res) => {
    try {
      // Fetch all accounts from BigQuery
      const allAccounts = await bigQueryService.getAllAccounts();
      
      // Fetch account config
      const accountConfig = await storageService.getFileAsJson('account_config.json');
      
      // Create a set of mapped account IDs from config (stringify to avoid type mismatch
      // between config strings and BigQuery integer account_ids)
      const mappedAccountIds = new Set();
      Object.values(accountConfig).forEach(account => {
        if (account.account_internal_id != null) {
          mappedAccountIds.add(String(account.account_internal_id));
        }
      });

      // Filter to only unmapped accounts
      const unmappedAccounts = allAccounts.filter(account =>
        !mappedAccountIds.has(String(account.account_id))
      );
      
      res.json({
        total: allAccounts.length,
        mapped: mappedAccountIds.size,
        unmapped: unmappedAccounts.length,
        accounts: unmappedAccounts
      });
    } catch (error) {
      console.error('Error fetching unmapped accounts:', error);
      res.status(500).json({
        error: 'Failed to fetch unmapped accounts',
        message: error.message
      });
    }
  });

  /**
   * Get unmapped customers (customers in BigQuery not in config)
   * Sorted by start_date_est descending (most recent first)
   * 
   * GET /api/bq/unmapped-customers
   */
  router.get('/bq/unmapped-customers', async (req, res) => {
    try {
      // Fetch all customers from BigQuery
      const allCustomers = await bigQueryService.getAllCustomers();
      
      // Fetch customer config
      const customerConfig = await storageService.getFileAsJson('customer_config.json');
      
      // Create a set of mapped customer IDs from config
      const mappedCustomerIds = new Set();
      Object.values(customerConfig).forEach(customer => {
        if (customer.customer_internal_id || customer.customer_id) {
          const customerId = customer.customer_internal_id || customer.customer_id;
          mappedCustomerIds.add(customerId);
        }
      });
      
      // Filter to only unmapped customers
      let unmappedCustomers = allCustomers.filter(customer => 
        !mappedCustomerIds.has(customer.customer_id)
      );
      
      // Sort by start_date_est descending (most recent first), nulls at bottom
      unmappedCustomers.sort((a, b) => {
        // Extract date values (handle BigQuery DATE type {value: "YYYY-MM-DD"})
        let dateValueA = a.start_date_est;
        let dateValueB = b.start_date_est;
        
        if (dateValueA && typeof dateValueA === 'object' && dateValueA.value) {
          dateValueA = dateValueA.value;
        }
        if (dateValueB && typeof dateValueB === 'object' && dateValueB.value) {
          dateValueB = dateValueB.value;
        }
        
        // Nulls go to bottom
        if (!dateValueA && !dateValueB) return 0;
        if (!dateValueA) return 1;  // a goes after b
        if (!dateValueB) return -1; // b goes after a
        
        // Both have dates - sort descending (most recent first)
        const dateA = new Date(dateValueA);
        const dateB = new Date(dateValueB);
        return dateB - dateA;
      });
      
      res.json({
        total: allCustomers.length,
        mapped: mappedCustomerIds.size,
        unmapped: unmappedCustomers.length,
        customers: unmappedCustomers
      });
    } catch (error) {
      console.error('Error fetching unmapped customers:', error);
      res.status(500).json({
        error: 'Failed to fetch unmapped customers',
        message: error.message
      });
    }
  });

  /**
   * Test endpoint: Read data from Google Sheets
   * 
   * GET /api/sheets/test?spreadsheetId=xxx&range=Sheet1!A1:Z100
   * 
   * Example:
   * GET /api/sheets/test?spreadsheetId=1P4uAVda140WUwGf6L5-oJqklhqHhWGUJ3XPawYa4GpE&range=Sheet1!A1:Z100
   */
  router.get('/sheets/test', async (req, res) => {
    try {
      if (!googleSheetsService.isAvailable()) {
        return res.status(503).json({
          error: 'Google Sheets service not available',
          message: 'Service not initialized properly'
        });
      }

      const { spreadsheetId, range } = req.query;

      if (!spreadsheetId || !range) {
        return res.status(400).json({
          error: 'Missing required parameters',
          required: ['spreadsheetId', 'range'],
          example: '/api/sheets/test?spreadsheetId=1P4uAVda140WUwGf6L5-oJqklhqHhWGUJ3XPawYa4GpE&range=Sheet1!A1:Z100'
        });
      }

      const rows = await googleSheetsService.readRange(spreadsheetId, range);
      
      // Convert to objects if first row looks like headers
      const hasHeaders = rows.length > 0 && rows[0].every(cell => typeof cell === 'string');
      const data = hasHeaders ? googleSheetsService.rowsToObjects(rows) : rows;

      res.json({
        success: true,
        spreadsheetId,
        range,
        rowCount: rows.length,
        hasHeaders,
        data
      });

    } catch (error) {
      console.error('Error reading Google Sheet:', error);
      res.status(500).json({
        error: 'Failed to read from Google Sheet',
        message: error.message
      });
    }
  });

  /**
   * Get Google Sheet info
   * 
   * GET /api/sheets/info?spreadsheetId=xxx
   */
  router.get('/sheets/info', async (req, res) => {
    try {
      if (!googleSheetsService.isAvailable()) {
        return res.status(503).json({
          error: 'Google Sheets service not available'
        });
      }

      const { spreadsheetId } = req.query;

      if (!spreadsheetId) {
        return res.status(400).json({
          error: 'Missing spreadsheetId parameter'
        });
      }

      const info = await googleSheetsService.getSpreadsheetInfo(spreadsheetId);
      
      res.json({
        success: true,
        ...info
      });

    } catch (error) {
      console.error('Error getting sheet info:', error);
      res.status(500).json({
        error: 'Failed to get sheet info',
        message: error.message
      });
    }
  });

  /**
   * Test endpoint: Get all census data
   * 
   * GET /api/census/all?refresh=true
   */
  router.get('/census/all', async (req, res) => {
    try {
      if (!censusService.isAvailable()) {
        return res.status(503).json({
          error: 'Census service not available',
          message: 'Google Sheets service not initialized'
        });
      }

      const forceRefresh = req.query.refresh === 'true';
      const data = await censusService.fetchCensusData(forceRefresh);

      res.json({
        success: true,
        count: data.length,
        customers: [...new Set(data.map(r => r.customerCode))].length,
        types: [...new Set(data.map(r => r.type))],
        data
      });

    } catch (error) {
      console.error('Error fetching census data:', error);
      res.status(500).json({
        error: 'Failed to fetch census data',
        message: error.message
      });
    }
  });

  /**
   * Test endpoint: Get census for specific customer and month
   * 
   * GET /api/census/customer?customerCode=ARM51&month=2025-01-01
   */
  router.get('/census/customer', async (req, res) => {
    try {
      if (!censusService.isAvailable()) {
        return res.status(503).json({
          error: 'Census service not available'
        });
      }

      const { customerCode, month } = req.query;

      if (!customerCode || !month) {
        return res.status(400).json({
          error: 'Missing required parameters',
          required: ['customerCode', 'month'],
          example: '/api/census/customer?customerCode=ARM51&month=2025-01-01'
        });
      }

      const census = await censusService.getCensusForCustomer(customerCode, month);

      res.json({
        success: true,
        customerCode,
        month,
        census
      });

    } catch (error) {
      console.error('Error fetching census:', error);
      res.status(500).json({
        error: 'Failed to fetch census',
        message: error.message
      });
    }
  });

  // ==================== GCS Import ====================

  const GCS_FUNCTION_URL = 'https://gcs-to-bigquery-abdw3vfmia-uc.a.run.app';

  // In-memory state for tracking the import job
  let gcsImportState = {
    running: false,
    stage: 'idle',       // idle | loading | cleanup | transform | done | failed
    startedAt: null,
    completedAt: null,
    result: null,
    error: null,
  };

  async function fetchCloudRunImportStatus() {
    // Read status directly from GCS instead of calling the Cloud Function,
    // so this never blocks on the running sync (maxInstanceRequestConcurrency=1).
    const { Storage } = require('@google-cloud/storage');
    const gcpKey = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY);
    const storage = new Storage({ credentials: gcpKey, projectId: gcpKey.project_id });
    const file = storage.bucket('yona-csv-uploads').file('__gcs_import_status.json');
    const [exists] = await file.exists();
    if (!exists) return null;
    const [contents] = await file.download();
    return JSON.parse(contents.toString('utf8'));
  }

  /**
   * Get GCS import status
   *
   * GET /api/gcs-import/status
   */
  router.get('/gcs-import/status', async (req, res) => {
    const diagnostics = {
      source: 'local',
      cloudStatusFetched: false,
      cloudStatusError: null,
    };

    // Always check Cloud Run for the latest persisted status
    // (even while running — the cloud function writes stage updates to GCS)
    try {
      const cloudStatus = await fetchCloudRunImportStatus();
      if (cloudStatus && typeof cloudStatus === 'object') {
        diagnostics.source = 'cloud';
        diagnostics.cloudStatusFetched = true;

        // Always adopt the cloud state as the source of truth
        gcsImportState = {
          ...gcsImportState,
          ...cloudStatus,
        };
      }
    } catch (error) {
      // If Cloud Run is unreachable, fall back to local state
      diagnostics.cloudStatusError = error.message;
      console.warn('Failed to fetch Cloud Run status:', error.message);
    }

    // Fetch last_synced_at from DB
    let lastSyncedAt = null;
    if (pgPool) {
      try {
        const { rows } = await pgPool.query(`SELECT value FROM sync_metadata WHERE key = 'last_synced_at'`);
        if (rows.length > 0) lastSyncedAt = rows[0].value;
      } catch (_) {}
    }

    res.json({ ...gcsImportState, lastSyncedAt, diagnostics });
  });

  /**
   * Trigger GCS-to-BigQuery import (non-blocking)
   *
   * POST /api/gcs-import/run
   */
  router.post('/gcs-import/run', async (req, res) => {
    if (gcsImportState.running) {
      return res.status(409).json({
        success: false,
        error: 'Import is already running',
        stage: gcsImportState.stage,
      });
    }

    // Reset and mark as running
    gcsImportState = {
      running: true,
      stage: 'loading',
      startedAt: new Date().toISOString(),
      completedAt: null,
      result: null,
      error: null,
    };

    // Return immediately — run the function in the background
    res.json({ success: true, message: 'Import started' });

    // Background execution
    try {
      const { GoogleAuth } = require('google-auth-library');
      const gcpKey = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY);

      const auth = new GoogleAuth({ credentials: gcpKey });
      const client = await auth.getIdTokenClient(GCS_FUNCTION_URL);
      const response = await client.request({
        url: GCS_FUNCTION_URL,
        method: 'GET',
        timeout: 3600000, // 60 minutes — match cloud function timeout
      });

      const data = response.data;

      if (data.success) {
        gcsImportState.stage = 'done';
        gcsImportState.result = data;
      } else {
        gcsImportState.stage = 'failed';
        gcsImportState.error = data.error || 'Unknown error';
        gcsImportState.result = data;
      }
    } catch (error) {
      console.error('GCS import error:', error);
      gcsImportState.stage = 'failed';
      gcsImportState.error = error.message;
    } finally {
      gcsImportState.running = false;
      gcsImportState.completedAt = new Date().toISOString();
    }
  });

  /**
   * Get GCS import run history
   *
   * GET /api/gcs-import/logs?page=1&limit=20
   */
  router.get('/gcs-import/logs', async (req, res) => {
    if (!pgPool) {
      return res.status(503).json({ error: 'Database not available' });
    }

    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
      const offset = (page - 1) * limit;

      const [logsResult, countResult] = await Promise.all([
        pgPool.query(
          'SELECT * FROM gcs_import_logs ORDER BY started_at DESC LIMIT $1 OFFSET $2',
          [limit, offset]
        ),
        pgPool.query('SELECT COUNT(*) FROM gcs_import_logs'),
      ]);

      res.json({
        logs: logsResult.rows,
        total: parseInt(countResult.rows[0].count),
        page,
        limit,
      });
    } catch (error) {
      console.error('Error fetching GCS import logs:', error);
      res.status(500).json({ error: 'Failed to fetch import logs' });
    }
  });

  // ============================================================
  // Global App Settings
  // ============================================================

  router.get('/app-settings/:key', async (req, res) => {
    if (!pgPool) return res.status(503).json({ error: 'Database not available' });
    try {
      const { rows } = await pgPool.query(
        'SELECT value FROM global_settings WHERE key = $1',
        [req.params.key]
      );
      if (!rows.length) return res.status(404).json({ error: 'Setting not found' });
      res.json({ key: req.params.key, value: rows[0].value });
    } catch (error) {
      console.error('Error fetching app setting:', error);
      res.status(500).json({ error: 'Failed to fetch setting' });
    }
  });

  router.put('/app-settings/:key', async (req, res) => {
    if (!pgPool) return res.status(503).json({ error: 'Database not available' });
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ error: 'value is required' });
    try {
      await pgPool.query(
        `INSERT INTO global_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [req.params.key, String(value)]
      );
      res.json({ key: req.params.key, value: String(value) });
    } catch (error) {
      console.error('Error saving app setting:', error);
      res.status(500).json({ error: 'Failed to save setting' });
    }
  });

  return router;
}

module.exports = createApiRoutes;
