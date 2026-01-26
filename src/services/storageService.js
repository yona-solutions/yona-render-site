/**
 * GCP Storage Service
 * 
 * Provides business logic for interacting with Google Cloud Storage.
 * Handles file listing, downloading, and bucket operations.
 * 
 * @module services/storageService
 */

const BUCKET_NAME = 'dimension_configurations';

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
   * Tag values are extracted from the 'tags' field across all entries.
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
      
      // Collect all unique tag values from the tags field
      const tags = config.tags || [];
      tags.forEach(tag => uniqueTags.add(tag));
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
    const configData = await this.getFileAsJson('department_config.json');
    
    const items = [];
    const uniqueTags = new Set();
    
    // First pass: collect individual departments (leaf nodes only) and tag values
    for (const [id, config] of Object.entries(configData)) {
      // Include only leaf nodes (parent === '2')
      // This excludes root "Department" (parent null) and "All Departments" (parent '1')
      if (config.parent === '2' && !config.displayExcluded && !config.operationalExcluded) {
        items.push({
          id: id,
          label: config.label,
          type: 'department'
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
        if (config.isDistrict && !config.districtReportingExcluded && !config.displayExcluded) {
          const tags = config.tags || [];
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
        if (config.customer_internal_id) {
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
   * IMPORTANT: For tag selections, districtReportingExcluded is ignored because tags
   * represent logical groupings that supersede individual district exclusions.
   * 
   * @param {string} districtId - District ID or tag ID (prefixed with "tag_")
   * @returns {Promise<Array>} Array of customer objects with customer_internal_id, label, configId
   */
  async getCustomersForDistrict(districtId) {
    const configData = await this.getFileAsJson('customer_config.json');
    const customers = [];
    const seenIds = new Set(); // Avoid duplicates
    let districtDisplayName = districtId; // Default to ID if not found
    
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
          const tags = config.tags || [];
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
      if (districtConfig && districtConfig.label) {
        districtDisplayName = districtConfig.label;
      }
    }
    
    // Find all customers whose parent is one of the selected districts
    for (const [id, config] of Object.entries(configData)) {
      if (config.parent && districtIdsToSearch.includes(config.parent)) {
        if (config.customer_internal_id && !seenIds.has(config.customer_internal_id)) {
          seenIds.add(config.customer_internal_id);
          
          // Extract customer_code from label (format: "CODE - Name")
          let customerCode = config.customer_code;
          if (!customerCode && config.label) {
            const parts = config.label.split(' - ');
            if (parts.length > 0) {
              customerCode = parts[0].trim();
            }
          }
          
          customers.push({
            customer_internal_id: config.customer_internal_id,
            customer_code: customerCode,
            label: config.label,
            configId: id,
            start_date_est: config.start_date_est
          });
        }
      }
    }
    
    return {
      customers,
      districtName: districtDisplayName,
      isTag
    };
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
    const configData = await this.getFileAsJson('department_config.json');
    
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
   * from customer_config.json. Returns districts ordered by their position in the config file.
   * 
   * @param {Array<Object>} customers - Array of customer objects with customer_internal_id
   * @returns {Promise<Array<Object>>} Array of district objects with {districtId, districtLabel, customers: []}
   * @throws {Error} If storage is not initialized or file cannot be parsed
   */
  async groupCustomersByDistrict(customers) {
    const configData = await this.getFileAsJson('customer_config.json');
    
    // Build reverse lookup: customer_internal_id -> config entry
    const customerIdToConfig = {};
    for (const [configId, config] of Object.entries(configData)) {
      if (config.customer_internal_id != null) {
        customerIdToConfig[config.customer_internal_id] = {
          configId,
          ...config
        };
      }
    }
    
    // Collect all unique district tags and districts
    const districtTags = new Set();
    const districtConfigs = {};
    
    for (const [configId, config] of Object.entries(configData)) {
      if (config.isDistrict && !config.displayExcluded) {
        districtConfigs[configId] = config;
        const tags = config.tags || [];
        tags.forEach(tag => districtTags.add(tag));
      }
    }
    
    // Build map of tag -> district IDs
    const tagToDistricts = {};
    for (const tag of districtTags) {
      tagToDistricts[tag] = [];
      for (const [districtId, config] of Object.entries(districtConfigs)) {
        const tags = config.tags || [];
        if (tags.includes(tag)) {
          tagToDistricts[tag].push(districtId);
        }
      }
    }
    
    console.log(`📊 Found ${Object.keys(districtConfigs).length} districts, ${districtTags.size} unique tags`);
    
    // Track which districts have been assigned to tags
    const districtsInTags = new Set();
    for (const districtIds of Object.values(tagToDistricts)) {
      districtIds.forEach(id => districtsInTags.add(id));
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
    
    // Then, create groups for individual districts NOT in any tag
    // These should respect districtReportingExcluded
    for (const [districtId, config] of Object.entries(districtConfigs)) {
      if (!districtsInTags.has(districtId) && !config.districtReportingExcluded) {
        groups.push({
          districtId: districtId,
          districtLabel: config.label,
          isTag: false,
          districtIds: [districtId], // Single district
          customers: [],
          order: orderIndex++
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
      
      // Find which group this customer belongs to
      const group = groups.find(g => g.districtIds.includes(parentDistrictId));
      
      if (group) {
        group.customers.push({
          ...customer,
          configId: customerConfig.configId
        });
      } else {
        console.warn(`⚠ Customer ${customerId} parent district ${parentDistrictId} not in any group (likely excluded)`);
      }
    }
    
    // Filter out groups with no customers and sort by order
    const result = groups
      .filter(group => group.customers.length > 0)
      .sort((a, b) => a.order - b.order);
    
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
    
    // Build reverse lookup: customer_internal_id -> config entry
    const customerIdToConfig = {};
    for (const [configId, config] of Object.entries(customerConfig)) {
      if (config.customer_internal_id != null) {
        customerIdToConfig[config.customer_internal_id] = {
          configId,
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
      
      if (!regionId) {
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
          const tags = config.tags || [];
          tags.forEach(tag => districtTags.add(tag));
        }
      }

      // Build map of tag -> district IDs
      const tagToDistricts = {};
      for (const tag of districtTags) {
        tagToDistricts[tag] = [];
        for (const [districtId, config] of Object.entries(districtConfigs)) {
          const tags = config.tags || [];
          if (tags.includes(tag)) {
            tagToDistricts[tag].push(districtId);
          }
        }
      }

      // Track which districts have been assigned to tags
      const districtsInTags = new Set();
      for (const districtIds of Object.values(tagToDistricts)) {
        districtIds.forEach(id => districtsInTags.add(id));
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

      // Then, create groups for individual districts NOT in any tag
      // These should respect districtReportingExcluded
      for (const [districtId, config] of Object.entries(districtConfigs)) {
        if (!districtsInTags.has(districtId) && !config.districtReportingExcluded) {
          groups.push({
            districtId: districtId,
            districtLabel: config.label,
            isTag: false,
            districtIds: [districtId], // Single district
            customers: [],
            order: orderIndex++
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

        // Find which group this customer belongs to
        const group = groups.find(g => g.districtIds.includes(parentDistrictId));

        if (group) {
          group.customers.push({
            ...customer,
            configId: customerConfigEntry.configId
          });
        } else {
          console.warn(`⚠ Customer ${customerId} parent district ${parentDistrictId} not in any group (likely excluded)`);
        }
      }

      // Convert to array, filter out empty groups, and sort by order
      regionData.districts = groups
        .filter(group => group.customers.length > 0)
        .sort((a, b) => a.order - b.order);

      // Remove the flat customers array as we've organized them into districts
      delete regionData.customers;
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

