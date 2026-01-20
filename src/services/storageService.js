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
   * Get districts from customer configuration file grouped by parent category
   * 
   * Parses customer_config.json and extracts all entries where isDistrict === true,
   * excludes districts with districtReportingExcluded === true,
   * and groups them by their parent category.
   * 
   * @returns {Promise<Array<{group: string, districts: Array}>>} Array of grouped districts
   * @throws {Error} If storage is not initialized or file cannot be parsed
   */
  async getDistricts() {
    const configData = await this.getFileAsJson('customer_config.json');
    
    // First pass: collect all districts with their parent info
    const districtsWithParents = [];
    
    for (const [id, config] of Object.entries(configData)) {
      // Filter for districts and exclude those excluded from reporting
      if (config.isDistrict && !config.districtReportingExcluded && !config.displayExcluded) {
        const parentId = config.parent;
        const parentLabel = parentId && configData[parentId] 
          ? configData[parentId].label 
          : 'Other';
        
        districtsWithParents.push({
          id: id,
          label: config.label,
          tags: config.districtTags || [],
          parent: parentLabel
        });
      }
    }
    
    // Group districts by parent
    const grouped = {};
    districtsWithParents.forEach(district => {
      if (!grouped[district.parent]) {
        grouped[district.parent] = [];
      }
      grouped[district.parent].push(district);
    });
    
    // Convert to array format and sort
    const result = Object.entries(grouped).map(([group, districts]) => ({
      group: group,
      districts: districts.sort((a, b) => a.label.localeCompare(b.label))
    }));
    
    // Sort groups alphabetically
    result.sort((a, b) => a.group.localeCompare(b.group));
    
    return result;
  }
}

module.exports = StorageService;

