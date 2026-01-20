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
}

module.exports = StorageService;

