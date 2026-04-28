/**
 * GCP Storage Service
 * 
 * Provides business logic for interacting with Google Cloud Storage.
 * Handles file listing, downloading, and bucket operations.
 * 
 * @module services/storageService
 */

const BUCKET_NAME = 'dimension_configurations';

function getDistrictTags(config) {
  return Array.isArray(config?.districtTags) ? config.districtTags : [];
}

function getCustomerTags(config) {
  const rawTags = Array.isArray(config?.customerTags)
    ? config.customerTags
    : (Array.isArray(config?.tags) ? config.tags : []);

  return rawTags
    .map(tag => String(tag || '').trim())
    .filter(Boolean);
}

function getDimensionDisplayOrder(id, config) {
  if (config?.order !== undefined && config.order !== null) {
    return config.order;
  }

  const numericId = Number(id);
  return Number.isNaN(numericId) ? id : numericId;
}

function compareDimensionOrderValues(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }

  return String(a).localeCompare(String(b));
}

function buildConfigOrderIndex(configData) {
  const configOrder = {};
  let orderIdx = 0;
  for (const configId of Object.keys(configData)) {
    configOrder[configId] = orderIdx++;
  }
  return configOrder;
}

function compareConfigIdsByDisplayOrder(configData, configOrder, aId, bId) {
  const orderCompare = compareDimensionOrderValues(
    getDimensionDisplayOrder(aId, configData[aId]),
    getDimensionDisplayOrder(bId, configData[bId])
  );

  if (orderCompare !== 0) {
    return orderCompare;
  }

  const aConfigOrder = configOrder[aId] ?? Infinity;
  const bConfigOrder = configOrder[bId] ?? Infinity;
  if (aConfigOrder !== bConfigOrder) {
    if (!Number.isFinite(aConfigOrder) && !Number.isFinite(bConfigOrder)) {
      return String(aId).localeCompare(String(bId));
    }
    return aConfigOrder - bConfigOrder;
  }

  return 0;
}

function getConfigDisplayPath(configData, configOrder, id, cache = {}) {
  if (cache[id]) {
    return cache[id];
  }

  const config = configData[id];
  if (!config) {
    cache[id] = [{ id, order: getDimensionDisplayOrder(id, null), configOrderIndex: configOrder[id] ?? Infinity }];
    return cache[id];
  }

  const ownPathItem = {
    id,
    order: getDimensionDisplayOrder(id, config),
    configOrderIndex: configOrder[id] ?? Infinity
  };

  if (config.parent != null && configData[config.parent]) {
    cache[id] = [...getConfigDisplayPath(configData, configOrder, config.parent, cache), ownPathItem];
  } else {
    cache[id] = [ownPathItem];
  }

  return cache[id];
}

function compareConfigIdsByDisplayPath(configData, configOrder, aId, bId, pathCache = {}) {
  const aPath = getConfigDisplayPath(configData, configOrder, aId, pathCache);
  const bPath = getConfigDisplayPath(configData, configOrder, bId, pathCache);
  const max = Math.min(aPath.length, bPath.length);

  for (let i = 0; i < max; i++) {
    const orderCompare = compareDimensionOrderValues(aPath[i].order, bPath[i].order);
    if (orderCompare !== 0) {
      return orderCompare;
    }

    const aConfigOrder = aPath[i].configOrderIndex;
    const bConfigOrder = bPath[i].configOrderIndex;
    if (aConfigOrder !== bConfigOrder) {
      if (!Number.isFinite(aConfigOrder) && !Number.isFinite(bConfigOrder)) {
        return String(aPath[i].id).localeCompare(String(bPath[i].id));
      }
      return aConfigOrder - bConfigOrder;
    }
  }

  return aPath.length - bPath.length;
}

function compareCustomersByDisplayOrder(configData, configOrder, a, b, { groupIsTag = false, pathCache = {} } = {}) {
  if (groupIsTag) {
    const aParent = a.parentDistrictId || configData[a.configId]?.parent;
    const bParent = b.parentDistrictId || configData[b.configId]?.parent;

    if (aParent && bParent && aParent !== bParent) {
      const parentCompare = compareConfigIdsByDisplayPath(configData, configOrder, aParent, bParent, pathCache);
      if (parentCompare !== 0) {
        return parentCompare;
      }
    }
  }

  return compareConfigIdsByDisplayOrder(configData, configOrder, a.configId, b.configId);
}

/**
 * Storage Service Class
 * 
 * Encapsulates all GCP Storage operations for the application.
 */
class StorageService {
  /**
   * @param {Storage} storage - GCP Storage client instance
   */
  constructor(storage) {
    this.storage = storage;
    this.bucketName = BUCKET_NAME;
  }

  /**
   * Check if storage is initialized
   * 
   * @returns {boolean} True if storage is available
   */
  isAvailable() {
    return this.storage !== null && this.storage !== undefined;
  }

  /**
   * List files and folders in a bucket with optional prefix
   * 
   * @param {string} prefix - Optional prefix to filter files (e.g., 'folder/')
   * @returns {Promise<{prefix: string, folders: string[], files: Array}>} List of folders and files
   * @throws {Error} If storage is not initialized or operation fails
   */
  async listFiles(prefix = '') {
    if (!this.isAvailable()) {
      throw new Error('GCP Storage not initialized');
    }

    const bucket = this.storage.bucket(this.bucketName);
    
    const [files] = await bucket.getFiles({
      prefix: prefix,
      delimiter: '/'
    });
    
    // Separate folders and files
    const folders = new Set();
    const fileList = [];
    
    files.forEach(file => {
      const relativePath = file.name.substring(prefix.length);
      const parts = relativePath.split('/');
      
      if (parts.length > 1 && parts[0]) {
        // This is a folder
        folders.add(prefix + parts[0] + '/');
      } else if (parts[0]) {
        // This is a file
        fileList.push({
          name: file.name,
          size: parseInt(file.metadata.size),
          updated: file.metadata.updated,
          contentType: file.metadata.contentType
        });
      }
    });
    
    return {
      prefix: prefix,
      folders: Array.from(folders).sort(),
      files: fileList.sort((a, b) => a.name.localeCompare(b.name))
    };
  }

  /**
   * Get a file from the bucket
   * 
   * @param {string} fileName - Full path to the file in the bucket
   * @returns {Promise<{exists: boolean, file: File, metadata: object}>} File object and metadata
   * @throws {Error} If storage is not initialized
   */
  async getFile(fileName) {
    if (!this.isAvailable()) {
      throw new Error('GCP Storage not initialized');
    }

    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(fileName);
    
    const [exists] = await file.exists();
    
    if (!exists) {
      return { exists: false, file: null, metadata: null };
    }
    
    const [metadata] = await file.getMetadata();
    
    return {
      exists: true,
      file: file,
      metadata: metadata
    };
  }

  /**
   * Create a read stream for a file
   * 
   * @param {File} file - GCP Storage File object
   * @returns {ReadStream} Read stream for the file
   */
  createReadStream(file) {
    return file.createReadStream();
  }

  /**
   * Get file contents as JSON
   * 
   * @param {string} fileName - Full path to the file in the bucket
   * @returns {Promise<object>} Parsed JSON content
   * @throws {Error} If file doesn't exist or isn't valid JSON
   */
  async getFileAsJson(fileName) {
    if (!this.isAvailable()) {
      throw new Error('GCP Storage not initialized');
    }

    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(fileName);
    
    const [exists] = await file.exists();
    if (!exists) {
      throw new Error('File not found');
    }
    
    // Download file contents
    const [contents] = await file.download();
    
    // Parse as JSON
    return JSON.parse(contents.toString('utf8'));
  }

  /**
   * Save JSON data to a file in GCS
   * 
   * @param {string} fileName - Name of file in GCS bucket
   * @param {Object} data - JavaScript object to save as JSON
   * @returns {Promise<void>}
   */
  async saveFileAsJson(fileName, data) {
    if (!this.isAvailable()) {
      throw new Error('GCP Storage not initialized');
    }

    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(fileName);
    
    // Convert to JSON string with pretty formatting
    const jsonString = JSON.stringify(data, null, 2);
    
    // Upload to GCS
    await file.save(jsonString, {
      contentType: 'application/json',
      metadata: {
        cacheControl: 'no-cache',
      }
    });
    
    console.log(`✅ Saved ${fileName} to GCS bucket ${this.bucketName}`);
  }

  /**
   * Get districts and district tags from customer configuration file
   * 
   * Returns both individual districts and unique tag values.
   * Individual districts with districtReportingExcluded are excluded.
   * Tag values are extracted from the 'districtTags' field on district entries.
   * 
   * @returns {Promise<Array<{id: string, label: string, type: string}>>} Array of districts and tags
   * @throws {Error} If storage is not initialized or file cannot be parsed
   */
  async getDistricts() {
    const configData = await this.getFileAsJson('customer_config.json');
    
    const items = [];
    const uniqueTags = new Set();
    
    // First pass: collect individual districts and tag values
    for (const [id, config] of Object.entries(configData)) {
      // Include individual districts (exclude if districtReportingExcluded or displayExcluded)
      if (config.isDistrict && !config.districtReportingExcluded && !config.displayExcluded) {
        items.push({
          id: id,
          label: config.label,
          type: 'district'
        });
      }
      
      // Collect all unique district tag values from visible districts.
      if (config.isDistrict && !config.displayExcluded) {
        getDistrictTags(config).forEach(tag => uniqueTags.add(tag));
      }
    }
    
    // Add unique tag values as selectable items
    uniqueTags.forEach(tag => {
      items.push({
        id: `tag_${tag}`, // Use a prefix to distinguish tags from district IDs
        label: tag,
        type: 'tag'
      });
    });
    
    // Sort all items alphabetically by label
    items.sort((a, b) => a.label.localeCompare(b.label));
    
    return items;
  }

  /**
   * Get customer tags from customer configuration file
   *
   * Returns unique customer tag values from customer entries only.
   * These are used as a dedicated selector source for customer-tag P&Ls.
   *
   * @returns {Promise<Array<{id: string, label: string, type: string}>>}
   */
  async getCustomerTags() {
    const configData = await this.getFileAsJson('customer_config.json');

    const items = [];
    const uniqueTags = new Set();

    for (const config of Object.values(configData)) {
      if (config.customer_internal_id != null && !config.displayExcluded) {
        getCustomerTags(config).forEach(tag => uniqueTags.add(tag));
      }
    }

    uniqueTags.forEach(tag => {
      items.push({
        id: `tag_${tag}`,
        label: tag,
        type: 'tag'
      });
    });

    items.sort((a, b) => a.label.localeCompare(b.label));

    return items;
  }

  /**
   * Get regions and region tags from region configuration file
   * 
   * Returns both individual regions and unique tag values.
   * Regions are identified by having a parent (excluding root nodes).
   * Entries with displayExcluded or operationalExcluded are filtered out.
   * Tag values are extracted from the 'tags' field across all entries.
   * 
   * @returns {Promise<Array<{id: string, label: string, type: string}>>} Array of regions and tags
   * @throws {Error} If storage is not initialized or file cannot be parsed
   */
  async getRegions() {
    const configData = await this.getFileAsJson('region_config.json');
    
    const items = [];
    const uniqueTags = new Set();
    
    // First pass: collect individual regions (leaf nodes only) and tag values
    for (const [id, config] of Object.entries(configData)) {
      // Include only leaf nodes (parent === '2')
      // This excludes root "Region" (parent null) and "All Regions" (parent '1')
      if (config.parent === '2' && !config.displayExcluded && !config.operationalExcluded) {
        items.push({
          id: id,
          label: config.label,
          type: 'region'
        });
      }
      
      // Collect all unique tag values from the tags field
      const tags = config.tags || [];
      tags.forEach(tag => uniqueTags.add(tag));
    }
    
    // Add unique tag values as selectable items
    uniqueTags.forEach(tag => {
      items.push({
        id: `tag_${tag}`,
        label: tag,
        type: 'tag'
      });
    });
    
    // Sort all items alphabetically by label
    items.sort((a, b) => a.label.localeCompare(b.label));
    
    return items;
  }

  /**
   * Get departments (subsidiaries) and department tags from department configuration file
   * 
   * Returns both individual departments and unique tag values.
   * Departments are identified by having a parent (excluding root nodes).
   * Entries with displayExcluded or operationalExcluded are filtered out.
   * Tag values are extracted from the 'tags' field across all entries.
   * 
   * @returns {Promise<Array<{id: string, label: string, type: string}>>} Array of departments and tags
   * @throws {Error} If storage is not initialized or file cannot be parsed
   */
  async getDepartments() {
    const configData = await this.getFileAsJson('subsidiary_config.json');

    const items = [];
    const uniqueTags = new Set();

    // First pass: collect individual departments (leaf nodes only) and tag values
    for (const [id, config] of Object.entries(configData)) {
      // Include only leaf nodes (parent === '2')
      // This excludes root "Department" (parent null) and "All Departments" (parent '1')
      if (config.parent === '2' && !config.displayExcluded && !config.operationalExcluded && !config.filterExcluded) {
        items.push({
          id: id,
          label: config.label,
          type: 'department'
        });
      }

      // Collect tags only from entries not excluded from filter
      if (!config.filterExcluded) {
        const tags = config.tags || [];
        tags.forEach(tag => uniqueTags.add(tag));
      }
    }
    
    // Add unique tag values as selectable items
    uniqueTags.forEach(tag => {
      items.push({
        id: `tag_${tag}`,
        label: tag,
        type: 'tag'
      });
    });
    
    // Sort all items alphabetically by label
    items.sort((a, b) => a.label.localeCompare(b.label));
    
    return items;
  }

  /**
   * Get customer internal IDs for a district or district tag
   * 
   * For a district: Returns customer_internal_id from all children of that district
   * For a district tag: Returns customer_internal_id from all children of all districts with that tag
   * 
   * The hierarchy is:
   * - District (isDistrict=true)
   *   - Customer 1 (parent = district_id, has customer_internal_id)
   *   - Customer 2 (parent = district_id, has customer_internal_id)
   *   - ...
   * 
   * @param {string} districtId - District ID or tag ID (format: "tag_TagName")
   * @returns {Promise<Array<number>>} Array of customer internal IDs
   * @throws {Error} If storage is not initialized or file cannot be parsed
   */
  async getCustomerIdsForDistrict(districtId) {
    const configData = await this.getFileAsJson('customer_config.json');
    const customerIds = new Set(); // Use Set to avoid duplicates
    
    // Check if this is a tag selection
    const isTag = districtId.startsWith('tag_');
    const searchValue = isTag ? districtId.substring(4) : districtId;
    
    console.log(`🔍 Finding customers for district: ${districtId} (isTag: ${isTag})`);
    
    // Find the district IDs to search for children
    const districtIdsToSearch = [];
    
    if (isTag) {
      // Tag selection: Find all districts with this tag
      for (const [id, config] of Object.entries(configData)) {
        if (config.isDistrict && !config.displayExcluded) {
          const tags = getDistrictTags(config);
          if (tags.includes(searchValue)) {
            districtIdsToSearch.push(id);
            console.log(`   Found district with tag: ${id} (${config.label})`);
          }
        }
      }
    } else {
      // Direct district selection
      districtIdsToSearch.push(districtId);
      const districtConfig = configData[districtId];
      if (districtConfig) {
        console.log(`   District: ${districtConfig.label}`);
      }
    }
    
    console.log(`   Searching for children of ${districtIdsToSearch.length} district(s)`);
    
    // Now find all children (customers) of these districts
    for (const [id, config] of Object.entries(configData)) {
      // Check if this entry's parent is one of our districts
      if (config.parent && districtIdsToSearch.includes(config.parent)) {
        // This is a child of one of our districts
        if (config.customer_internal_id != null) {
          customerIds.add(config.customer_internal_id);
          console.log(`   ✓ Customer found: ${config.label} (customer_internal_id: ${config.customer_internal_id})`);
        } else {
          console.warn(`   ⚠ Child ${id} (${config.label}) has no customer_internal_id`);
        }
      }
    }
    
    const finalCustomerIds = Array.from(customerIds);
    console.log(`   📊 Total unique customer IDs: ${finalCustomerIds.length}`);
    
    return finalCustomerIds;
  }

  /**
   * Get full customer details for a district or district tag
   * Returns customer objects with label and ID for facility P&L generation
   * 
   * @param {string} districtId - District ID or tag ID (format: "tag_TagName")
   * @returns {Promise<Array<Object>>} Array of customer objects with {customer_internal_id, label, configId}
   * @throws {Error} If storage is not initialized or file cannot be parsed
   */
  /**
   * Get all customers for a district or district tag
   * 
   * Handles both direct district selection and tag-based selection:
   * - Direct district: Returns all customers whose parent is the specified district
   * - Tag selection: Returns all customers from ALL districts that have the specified tag
   * 
   * IMPORTANT: For tag selections, districtReportingExcluded is ignored because district tags
   * represent logical groupings that supersede individual district exclusions.
   * 
   * @param {string} districtId - District ID or tag ID (prefixed with "tag_")
   * @returns {Promise<Array>} Array of customer objects with customer_internal_id, label, configId
   */
  async getCustomersForDistrict(districtId) {
    const configData = await this.getFileAsJson('customer_config.json');
    const configOrder = buildConfigOrderIndex(configData);
    const customers = [];
    const seenIds = new Set(); // Avoid duplicates
    let districtDisplayName = districtId; // Default to ID if not found
    let districtRegionLabel = null;
    
    // Check if this is a tag selection (IDs starting with "tag_" are tags)
    const isTag = districtId.startsWith('tag_');
    const searchValue = isTag ? districtId.substring(4) : districtId;
    
    // Find the district IDs to search for children
    const districtIdsToSearch = [];
    
    if (isTag) {
      // Tag selection: Find all districts with this tag
      // For tags, we include ALL districts with the tag, even if districtReportingExcluded is true
      // The tag represents a logical grouping that supersedes individual district exclusions
      districtDisplayName = searchValue; // For tags, display name is the tag itself
      for (const [id, config] of Object.entries(configData)) {
        if (config.isDistrict && !config.displayExcluded) {
          const tags = getDistrictTags(config);
          if (tags.includes(searchValue)) {
            districtIdsToSearch.push(id);
          }
        }
      }
    } else {
      // Direct district selection
      districtIdsToSearch.push(districtId);
      
      // Get the district's display name (label)
      const districtConfig = configData[districtId];
      if (districtConfig) {
        if (districtConfig.label) {
          districtDisplayName = districtConfig.label;
        }
        districtRegionLabel = districtConfig.districtRegion || districtConfig.region_label || null;
      }
    }
    
    // Find all customers whose parent is one of the selected districts
    for (const [id, config] of Object.entries(configData)) {
      if (config.parent && districtIdsToSearch.includes(config.parent)) {
        if (config.customer_internal_id && !seenIds.has(config.customer_internal_id)) {
          seenIds.add(config.customer_internal_id);
          
          // Extract customer_code from label — prefer direct field, then regex, then dash split
          let customerCode = config.customer_code;
          if (!customerCode && config.label) {
            const match = config.label.match(/^([A-Z]{2,5}\d{2,3})\b/);
            customerCode = match ? match[1] : config.label.split(' - ')[0]?.trim();
          }
          
          customers.push({
            customer_internal_id: config.customer_internal_id,
            customer_code: customerCode,
            label: config.label,
            configId: id,
            parentDistrictId: config.parent,
            start_date_est: config.start_date_est,
            customerPnlHidden: Boolean(config.customerPnlHidden),
            customerPnlCountExcluded: Boolean(config.customerPnlCountExcluded)
          });
        }
      }
    }

    const pathCache = {};
    customers.sort((a, b) => compareCustomersByDisplayOrder(configData, configOrder, a, b, {
      groupIsTag: isTag,
      pathCache
    }));
    
    return {
      customers,
      districtName: districtDisplayName,
      districtRegion: districtRegionLabel,
      isTag
    };
  }

  /**
   * Get all customers for a customer tag.
   *
   * Customer tags are always tag-based groupings, so the selector accepts the
   * same tag-prefixed ID format used elsewhere in the app.
   *
   * @param {string} customerTagId - Tag ID, typically prefixed with "tag_"
   * @returns {Promise<{customers: Array, customerTagName: string, isTag: boolean}>}
   */
  async getCustomersForCustomerTag(customerTagId) {
    const configData = await this.getFileAsJson('customer_config.json');
    const configOrder = buildConfigOrderIndex(configData);
    const customers = [];
    const seenIds = new Set();
    const isTag = String(customerTagId || '').startsWith('tag_');
    const searchValue = isTag ? String(customerTagId).substring(4) : String(customerTagId || '');
    const pathCache = {};

    for (const [id, config] of Object.entries(configData)) {
      if (config.customer_internal_id == null || config.displayExcluded) {
        continue;
      }

      const tags = getCustomerTags(config);
      if (!tags.includes(searchValue) || seenIds.has(config.customer_internal_id)) {
        continue;
      }

      seenIds.add(config.customer_internal_id);

      const parentDistrictConfig = config.parent ? configData[config.parent] : null;

      let customerCode = config.customer_code;
      if (!customerCode && config.label) {
        const match = config.label.match(/^([A-Z]{2,5}\d{2,3})\b/);
        customerCode = match ? match[1] : config.label.split(' - ')[0]?.trim();
      }

      customers.push({
        customer_internal_id: config.customer_internal_id,
        customer_code: customerCode,
        label: config.label,
        configId: id,
        parentDistrictId: config.parent,
        parentDistrictLabel: parentDistrictConfig?.label || config.parent || '',
        parentRegion: parentDistrictConfig?.districtRegion || parentDistrictConfig?.region_label || null,
        start_date_est: config.start_date_est,
        customerPnlHidden: Boolean(config.customerPnlHidden),
        customerPnlCountExcluded: Boolean(config.customerPnlCountExcluded)
      });
    }

    customers.sort((a, b) => compareCustomersByDisplayOrder(configData, configOrder, a, b, {
      groupIsTag: true,
      pathCache
    }));

    return {
      customers,
      customerTagName: searchValue,
      isTag: true
    };
  }

  /**
   * Get all service nodes from customer configuration
   *
   * @returns {Promise<Array>} Array of {id, label} objects sorted by label
   */
  async getServices() {
    const configData = await this.getFileAsJson('customer_config.json');
    const services = [];
    for (const [id, config] of Object.entries(configData)) {
      if (config.isService && !config.displayExcluded) {
        services.push({ id, label: config.label });
      }
    }
    return services.sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * Get all customers belonging to a service node (via its district children)
   *
   * @param {string} serviceId - Service node ID
   * @returns {Promise<{customers: Array, serviceName: string}>}
   */
  async getCustomersForService(serviceId) {
    const configData = await this.getFileAsJson('customer_config.json');
    const serviceConfig = configData[serviceId];
    const serviceName = serviceConfig?.label || serviceId;

    // Step 1: find all district children of this service
    const districtIds = new Set();
    for (const [id, config] of Object.entries(configData)) {
      if (config.parent === serviceId && config.isDistrict) {
        districtIds.add(id);
      }
    }

    // Step 2: find all customer children of those districts
    const customers = [];
    const seenIds = new Set();
    for (const [id, config] of Object.entries(configData)) {
      if (config.parent && districtIds.has(config.parent) && config.customer_internal_id != null && !seenIds.has(config.customer_internal_id)) {
        seenIds.add(config.customer_internal_id);
        customers.push({
          customer_internal_id: config.customer_internal_id,
          label: config.label,
          configId: id,
          customerPnlHidden: Boolean(config.customerPnlHidden),
          customerPnlCountExcluded: Boolean(config.customerPnlCountExcluded)
        });
      }
    }
    return { customers, serviceName };
  }

  /**
   * Get region internal ID from region configuration
   * 
   * @param {string} regionId - Region ID
   * @returns {Promise<number|null>} Region internal ID or null if not found
   * @throws {Error} If storage is not initialized or file cannot be parsed
   */
  async getRegionInternalId(regionId) {
    const configData = await this.getFileAsJson('region_config.json');
    const regionConfig = configData[regionId];
    
    if (regionConfig && regionConfig.region_internal_id) {
      return {
        regionId: parseInt(regionConfig.region_internal_id),
        regionName: regionConfig.label || regionId
      };
    }
    
    return null;
  }

  /**
   * Get subsidiary internal ID from department configuration
   * 
   * Handles both direct subsidiary selection and tag-based selection:
   * - Direct subsidiary: Returns single subsidiary_internal_id
   * - Tag selection: Returns array of all subsidiary_internal_ids that have the specified tag
   * 
   * @param {string} departmentId - Department/subsidiary ID or tag ID (prefixed with "tag_")
   * @returns {Promise<Object|null>} Object with subsidiaryIds (array), subsidiaryName, and isTag flag
   * @throws {Error} If storage is not initialized or file cannot be parsed
   */
  async getSubsidiaryInternalId(departmentId) {
    const configData = await this.getFileAsJson('subsidiary_config.json');
    
    // Check if this is a tag selection (IDs starting with "tag_" are tags)
    const isTag = departmentId.startsWith('tag_');
    const searchValue = isTag ? departmentId.substring(4) : departmentId;
    
    if (isTag) {
      // Tag selection: Find all departments/subsidiaries with this tag
      const subsidiaryIds = [];
      
      for (const [id, config] of Object.entries(configData)) {
        if (config.subsidiary_internal_id && !config.displayExcluded) {
          const tags = config.tags || [];
          if (tags.includes(searchValue)) {
            subsidiaryIds.push(parseInt(config.subsidiary_internal_id));
          }
        }
      }
      
      if (subsidiaryIds.length === 0) {
        return null;
      }
      
      return {
        subsidiaryIds: subsidiaryIds, // Array of IDs
        subsidiaryName: searchValue, // Tag name
        isTag: true
      };
    } else {
      // Direct subsidiary selection
      const deptConfig = configData[departmentId];
      
      if (deptConfig && deptConfig.subsidiary_internal_id) {
        return {
          subsidiaryIds: [parseInt(deptConfig.subsidiary_internal_id)], // Single ID in array for consistency
          subsidiaryName: deptConfig.label || departmentId,
          isTag: false
        };
      }
      
      return null;
    }
  }

  /**
   * Group customers by their parent district
   * 
   * Takes a list of customers (with customer_internal_id) and groups them by their parent district
   * from customer_config.json. Customers inside each group follow the dimension-config display order.
   * 
   * @param {Array<Object>} customers - Array of customer objects with customer_internal_id
   * @returns {Promise<Array<Object>>} Array of district objects with {districtId, districtLabel, customers: []}
   * @throws {Error} If storage is not initialized or file cannot be parsed
   */
  async groupCustomersByDistrict(customers) {
    const configData = await this.getFileAsJson('customer_config.json');
    const configOrder = buildConfigOrderIndex(configData);

    // Build reverse lookup: customer_internal_id -> config entry
    const customerIdToConfig = {};
    for (const [configId, config] of Object.entries(configData)) {
      if (config.customer_internal_id != null) {
        customerIdToConfig[config.customer_internal_id] = {
          configId,
          configOrderIndex: configOrder[configId],
          ...config
        };
      }
    }

    // Collect all unique district tags and districts.
    const districtTags = new Set();
    const districtConfigs = {};

    for (const [configId, config] of Object.entries(configData)) {
      if (config.isDistrict && !config.displayExcluded) {
        districtConfigs[configId] = {
          ...config,
          configOrderIndex: configOrder[configId]
        };
        getDistrictTags(config).forEach(tag => districtTags.add(tag));
      }
    }

    // Build map of tag -> district IDs
    const tagToDistricts = {};
    for (const tag of districtTags) {
      tagToDistricts[tag] = [];
      for (const [districtId, config] of Object.entries(districtConfigs)) {
        const tags = getDistrictTags(config);
        if (tags.includes(tag)) {
          tagToDistricts[tag].push(districtId);
        }
      }
    }

    console.log(`📊 Found ${Object.keys(districtConfigs).length} districts, ${districtTags.size} unique tags`);

    // Build groups (tags + individual districts not in any tag)
    const groups = [];

    // First, create groups for district tags.
    for (const [tag, districtIds] of Object.entries(tagToDistricts)) {
      // Keep the first district config position available for existing consumers/debugging.
      const minOrder = Math.min(...districtIds.map(id => districtConfigs[id]?.configOrderIndex ?? Infinity));
      groups.push({
        districtId: `tag_${tag}`,
        districtLabel: tag,
        isTag: true,
        districtIds: districtIds,
        customers: [],
        configOrderIndex: minOrder
      });
    }

    // Then, create groups for individual districts (even if in a tag), unless excluded from reporting
    for (const [districtId, config] of Object.entries(districtConfigs)) {
      if (!config.districtReportingExcluded) {
        groups.push({
          districtId: districtId,
          districtLabel: config.label,
          isTag: false,
          districtIds: [districtId],
          customers: [],
          configOrderIndex: config.configOrderIndex,
          districtRegion: config.districtRegion || config.region_label || null,
          districtSummaryExcluded: Boolean(config.districtSummaryExcluded),
          districtPnlCountExcluded: Boolean(config.districtPnlCountExcluded)
        });
      }
    }
    
    console.log(`📊 Created ${groups.length} groups (${Object.keys(tagToDistricts).length} tags + ${groups.length - Object.keys(tagToDistricts).length} individual districts)`);
    
      // Assign customers to groups
      for (const customer of customers) {
        const customerId = customer.customer_internal_id;
        const customerConfig = customerIdToConfig[customerId];
      
      if (!customerConfig) {
        console.warn(`⚠ Customer ${customerId} (${customer.label}) not found in customer_config.json`);
        continue;
      }
      
      const parentDistrictId = customerConfig.parent;
      
      if (!parentDistrictId) {
        console.warn(`⚠ Customer ${customerId} (${customer.label}) has no parent district`);
        continue;
      }
      
      // Check if parent is a district
      const parentConfig = configData[parentDistrictId];
      if (!parentConfig?.isDistrict) {
        console.warn(`⚠ Customer ${customerId} parent ${parentDistrictId} is not a district`);
        continue;
      }
      
      // Assign to all matching groups (tag groups + individual district group)
      const matchingGroups = groups.filter(g => g.districtIds.includes(parentDistrictId));
      
      if (matchingGroups.length > 0) {
        matchingGroups.forEach(group => {
          group.customers.push({
            ...customer,
            label: customerConfig.label || customer.label,
            configId: customerConfig.configId,
            parentDistrictId,
            configOrderIndex: customerConfig.configOrderIndex,
            customerPnlHidden: Boolean(customerConfig.customerPnlHidden),
            customerPnlCountExcluded: Boolean(customerConfig.customerPnlCountExcluded)
          });
        });
      } else {
        console.warn(`⚠ Customer ${customerId} parent district ${parentDistrictId} not in any group (likely excluded)`);
      }
      }

    // Sort customers within each group the same way the dimension config tree displays them.
    // District tags flatten multiple districts, so they sort by parent district path first.
    const pathCache = {};
    for (const group of groups) {
      group.customers.sort((a, b) => compareCustomersByDisplayOrder(configData, configOrder, a, b, {
        groupIsTag: group.isTag,
        pathCache
      }));
    }

    // Filter out groups with no customers and sort alphabetically by district label
    const result = groups
      .filter(group => group.customers.length > 0)
      .sort((a, b) => {
        const aLabel = String(a.districtLabel || '').toLowerCase();
        const bLabel = String(b.districtLabel || '').toLowerCase();
        return aLabel.localeCompare(bLabel);
      });

    console.log(`✅ Grouped ${customers.length} customers into ${result.length} groups (tags + districts)`);
    result.forEach(district => {
      console.log(`   - ${district.districtLabel}: ${district.customers.length} customers`);
    });

    return result;
  }

  /**
   * Group customers by region, then by district within each region
   * Returns a two-level hierarchy: Region -> Districts -> Customers
   */
  async groupCustomersByRegionAndDistrict(customers) {
    const customerConfig = await this.getFileAsJson('customer_config.json');
    const regionConfig = await this.getFileAsJson('region_config.json');
    const configOrder = buildConfigOrderIndex(customerConfig);

    // Build reverse lookup: customer_internal_id -> config entry
    const customerIdToConfig = {};
    for (const [configId, config] of Object.entries(customerConfig)) {
      if (config.customer_internal_id != null) {
        customerIdToConfig[config.customer_internal_id] = {
          configId,
          configOrderIndex: configOrder[configId],
          ...config
        };
      }
    }
    
    // Build reverse lookup: region_internal_id -> region config
    const regionInternalIdToConfig = {};
    for (const [configId, config] of Object.entries(regionConfig)) {
      if (config.region_internal_id != null) {
        regionInternalIdToConfig[config.region_internal_id] = {
          configId,
          ...config
        };
      }
    }
    
    // Build region map: regionInternalId -> { label, districts: [], order }
    const regionMap = {};
    
    // First pass: Group customers by region_internal_id
    for (const customer of customers) {
      const regionId = customer.region_internal_id;
      
      if (regionId == null) {
        console.warn(`⚠ Customer ${customer.customer_internal_id} has no region_internal_id`);
        continue;
      }
      
      if (!regionMap[regionId]) {
        const regionConfigEntry = regionInternalIdToConfig[regionId];
        if (!regionConfigEntry) {
          console.warn(`⚠ Region ${regionId} not found in region_config.json`);
          continue;
        }
        
        regionMap[regionId] = {
          regionInternalId: regionId,
          regionLabel: regionConfigEntry.label,
          regionConfigId: regionConfigEntry.configId,
          customers: [],
          districts: {}
        };
      }
      
      regionMap[regionId].customers.push(customer);
    }
    
    // Second pass: Within each region, group customers by district (with tag support)
    // District tags aggregate multiple districts into a single group
    // Same logic as groupCustomersByDistrict() for consistency
    for (const [regionId, regionData] of Object.entries(regionMap)) {
      // Collect all unique district tags and districts
      const districtTags = new Set();
      const districtConfigs = {};

      for (const [configId, config] of Object.entries(customerConfig)) {
        if (config.isDistrict && !config.displayExcluded) {
          districtConfigs[configId] = config;
          getDistrictTags(config).forEach(tag => districtTags.add(tag));
        }
      }

      // Build map of tag -> district IDs
      const tagToDistricts = {};
      for (const tag of districtTags) {
        tagToDistricts[tag] = [];
        for (const [districtId, config] of Object.entries(districtConfigs)) {
          const tags = getDistrictTags(config);
          if (tags.includes(tag)) {
            tagToDistricts[tag].push(districtId);
          }
        }
      }

    // Build groups (tags + individual districts not in any tag)
    const groups = [];
    let orderIndex = 0;

      // First, create groups for district tags
      for (const [tag, districtIds] of Object.entries(tagToDistricts)) {
        groups.push({
          districtId: `tag_${tag}`,
          districtLabel: tag,
          isTag: true,
          districtIds: districtIds, // Array of district IDs in this tag
          customers: [],
          order: orderIndex++
        });
      }

    // Then, create groups for individual districts (even if in a tag)
    // These should respect districtReportingExcluded
    for (const [districtId, config] of Object.entries(districtConfigs)) {
      if (!config.districtReportingExcluded) {
        groups.push({
          districtId: districtId,
          districtLabel: config.label,
          isTag: false,
          districtIds: [districtId], // Single district
          customers: [],
          order: orderIndex++,
          districtRegion: config.districtRegion || config.region_label || null,
          districtSummaryExcluded: Boolean(config.districtSummaryExcluded),
          districtPnlCountExcluded: Boolean(config.districtPnlCountExcluded)
        });
      }
    }

      // Assign customers to groups
      for (const customer of regionData.customers) {
        const customerId = customer.customer_internal_id;
        const customerConfigEntry = customerIdToConfig[customerId];

        if (!customerConfigEntry) {
          console.warn(`⚠ Customer ${customerId} not found in customer_config.json`);
          continue;
        }

        const parentDistrictId = customerConfigEntry.parent;

        if (!parentDistrictId) {
          console.warn(`⚠ Customer ${customerId} has no parent district`);
          continue;
        }

        // Check if parent is a district
        const parentConfig = customerConfig[parentDistrictId];
        if (!parentConfig?.isDistrict) {
          console.warn(`⚠ Customer ${customerId} parent ${parentDistrictId} is not a district`);
          continue;
        }

        // Assign to all matching groups (tag groups + individual district group)
        const matchingGroups = groups.filter(g => g.districtIds.includes(parentDistrictId));

        if (matchingGroups.length > 0) {
          matchingGroups.forEach(group => {
            group.customers.push({
              ...customer,
              label: customerConfigEntry.label || customer.label,
              configId: customerConfigEntry.configId,
              parentDistrictId,
              configOrderIndex: customerConfigEntry.configOrderIndex,
              customerPnlHidden: Boolean(customerConfigEntry.customerPnlHidden),
              customerPnlCountExcluded: Boolean(customerConfigEntry.customerPnlCountExcluded)
            });
          });
        } else {
          console.warn(`⚠ Customer ${customerId} parent district ${parentDistrictId} not in any group (likely excluded)`);
        }
      }

      // Sort customers within each group the same way the dimension config tree displays them.
      // District tags flatten multiple districts, so they sort by parent district path first.
      const pathCache = {};
      for (const group of groups) {
        group.customers.sort((a, b) => compareCustomersByDisplayOrder(customerConfig, configOrder, a, b, {
          groupIsTag: group.isTag,
          pathCache
        }));
      }

      // Convert to array, filter out empty groups, and sort alphabetically by district label
      regionData.districts = groups
        .filter(group => group.customers.length > 0)
        .sort((a, b) => {
          const aLabel = String(a.districtLabel || '').toLowerCase();
          const bLabel = String(b.districtLabel || '').toLowerCase();
          return aLabel.localeCompare(bLabel);
        });

      // Remove the flat customers array as we've organized them into districts
      delete regionData.customers;
    }

    // Inject customer 0 (No Customer) into every region that doesn't already have it.
    // Customer 0's dim_customers region may not match where its transactions actually
    // live, so we add it to every region. Within each region, place it in the district
    // that matches its customer_config parent — keeping it under the correct district
    // (e.g. "Fountain Square - Corporate") rather than just the first alphabetical one.
    const noCustomer = customers.find(c => c.customer_internal_id === 0);
    if (noCustomer) {
      const noCustomerConfigEntry = customerIdToConfig[0];
      const noCustomerParentDistrictId = noCustomerConfigEntry?.parent;

      for (const regionData of Object.values(regionMap)) {
        const alreadyHasNoCustomer = regionData.districts.some(d =>
          d.customers.some(c => c.customer_internal_id === 0)
        );
        if (alreadyHasNoCustomer) continue;
        if (regionData.districts.length === 0) continue;

        // Prefer the district whose districtId matches customer 0's config parent
        let targetDistrict = null;
        if (noCustomerParentDistrictId) {
          targetDistrict = regionData.districts.find(d =>
            Array.isArray(d.districtIds) && d.districtIds.includes(noCustomerParentDistrictId)
          );
        }
        // Fall back to first district if the parent district isn't in this region
        if (!targetDistrict) targetDistrict = regionData.districts[0];

        targetDistrict.customers.push({
          ...noCustomer,
          configId: noCustomerConfigEntry?.configId,
          parentDistrictId: noCustomerParentDistrictId,
          configOrderIndex: noCustomerConfigEntry?.configOrderIndex,
          customerPnlHidden: Boolean(noCustomerConfigEntry?.customerPnlHidden),
          customerPnlCountExcluded: Boolean(noCustomerConfigEntry?.customerPnlCountExcluded)
        });
        // Re-sort so customer 0 lands in its dimension-config display position.
        const pathCache = {};
        targetDistrict.customers.sort((a, b) => compareCustomersByDisplayOrder(customerConfig, configOrder, a, b, {
          groupIsTag: targetDistrict.isTag,
          pathCache
        }));
      }
    }

    // Convert to array and sort regions by their config order
    const regionConfigOrder = Object.keys(regionConfig);
    const result = Object.values(regionMap)
      .filter(region => region.districts.length > 0) // Only include regions with districts
      .sort((a, b) => {
        const orderA = regionConfigOrder.indexOf(a.regionConfigId);
        const orderB = regionConfigOrder.indexOf(b.regionConfigId);
        return orderA - orderB;
      });
    
    console.log(`✅ Grouped ${customers.length} customers into ${result.length} regions`);
    result.forEach(region => {
      const totalCustomers = region.districts.reduce((sum, d) => sum + d.customers.length, 0);
      console.log(`   - ${region.regionLabel}: ${region.districts.length} districts, ${totalCustomers} customers`);
    });
    
    return result;
  }
}

module.exports = StorageService;
