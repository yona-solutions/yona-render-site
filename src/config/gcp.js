/**
 * GCP Configuration Module
 * 
 * Handles initialization and configuration of Google Cloud Platform services.
 * Supports both environment variable and service account key file authentication.
 * 
 * @module config/gcp
 */

const { Storage } = require('@google-cloud/storage');

/**
 * Initialize GCP Storage client
 * 
 * @returns {Storage|null} Initialized Storage client or null if initialization fails
 */
function initializeStorage() {
  try {
    if (!process.env.GCP_SERVICE_ACCOUNT_KEY) {
      console.warn('⚠️  GCP_SERVICE_ACCOUNT_KEY not found in environment variables');
      return null;
    }

    const serviceAccountKey = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY);
    
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

module.exports = {
  initializeStorage
};

