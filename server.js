/**
 * Server Entry Point
 * 
 * Main entry point for the application. Starts the HTTP server
 * and handles graceful shutdown.
 * 
 * Environment Variables:
 *   - PORT: Server port (default: 3000)
 *   - NODE_ENV: Environment mode (development/production)
 *   - GCP_SERVICE_ACCOUNT_KEY: GCP service account credentials (JSON)
 * 
 * @module server
 */

// Load environment variables from .env file (for local development)
require('dotenv').config();

// For local development only: bypass SSL certificate verification
// This is needed when Node.js can't verify Google's SSL certificates
// DO NOT use in production
if (process.env.NODE_ENV !== 'production') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  console.log('⚠️  Development mode: SSL certificate verification disabled');
}

const createApp = require('./src/app');

const PORT = process.env.PORT || 3000;
const app = createApp();

// Start the server
// MUST bind to 0.0.0.0 for Render deployment
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('=================================');
  console.log('🚀 Server is running!');
  console.log(`   URL: http://localhost:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Node: ${process.version}`);
  console.log('=================================');
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('\n📡 SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('✅ HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n📡 SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('✅ HTTP server closed');
    process.exit(0);
  });
});

module.exports = server;
