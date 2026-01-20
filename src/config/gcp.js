/**
 * GCP Configuration Module
 * 
 * Handles initialization and configuration of Google Cloud Platform services.
 * Supports both environment variable and service account key file authentication.
 * 
 * @module config/gcp
 */

const { Storage } = require('@google-cloud/storage');
const { BigQuery } = require('@google-cloud/bigquery');
const path = require('path');
const fs = require('fs');

/**
 * Load service account credentials
 * 
 * Tries to load from:
 * 1. GCP_SERVICE_ACCOUNT_KEY environment variable (JSON string)
 * 2. gcp-service-account-key.json file in project root
 * 
 * @returns {object|null} Service account credentials or null if not found
 */
function loadServiceAccountKey() {
  // Try environment variable first
  if (process.env.GCP_SERVICE_ACCOUNT_KEY) {
    try {
      return JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY);
    } catch (error) {
      console.error('❌ Failed to parse GCP_SERVICE_ACCOUNT_KEY:', error.message);
    }
  }
  
  // Try local file
  const keyPath = path.join(__dirname, '../../gcp-service-account-key.json');
  if (fs.existsSync(keyPath)) {
    try {
      const keyContent = fs.readFileSync(keyPath, 'utf8');
      console.log('📄 Using local GCP service account key file');
      return JSON.parse(keyContent);
    } catch (error) {
      console.error('❌ Failed to read local service account key:', error.message);
    }
  }
  
  console.warn('⚠️  No GCP credentials found (tried env var and local file)');
  return null;
}

/**
 * Initialize GCP Storage client
 * 
 * @returns {Storage|null} Initialized Storage client or null if initialization fails
 */
function initializeStorage() {
  try {
    const serviceAccountKey = loadServiceAccountKey();
    
    if (!serviceAccountKey) {
      return null;
    }
    
    const storage = new Storage({
      credentials: serviceAccountKey,
      projectId: serviceAccountKey.project_id
    });

    console.log('✅ GCP Storage initialized successfully');
    console.log(`   Project: ${serviceAccountKey.project_id}`);
    
    return storage;
  } catch (error) {
    console.error('❌ Failed to initialize GCP Storage:', error.message);
    return null;
  }
}

/**
 * Initialize GCP BigQuery client
 * 
 * @returns {BigQuery|null} Initialized BigQuery client or null if initialization fails
 */
function initializeBigQuery() {
  try {
    const serviceAccountKey = loadServiceAccountKey();
    
    if (!serviceAccountKey) {
      return null;
    }
    
    const bigquery = new BigQuery({
      credentials: serviceAccountKey,
      projectId: serviceAccountKey.project_id
    });

    console.log('✅ GCP BigQuery initialized successfully');
    console.log(`   Project: ${serviceAccountKey.project_id}`);
    
    return bigquery;
  } catch (error) {
    console.error('❌ Failed to initialize GCP BigQuery:', error.message);
    return null;
  }
}

module.exports = {
  initializeStorage,
  initializeBigQuery
};

