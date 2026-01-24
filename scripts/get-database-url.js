#!/usr/bin/env node
/**
 * Get Database Connection String
 * 
 * Retrieves the connection string for the yona-email-config-db database
 */

require('dotenv').config();
const https = require('https');

const RENDER_API_KEY = process.env.RENDER_API_KEY;

function renderApiRequest(method, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.render.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${RENDER_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`API Error ${res.statusCode}: ${parsed.message || data}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.end();
  });
}

async function main() {
  console.log('🔍 Looking for yona-email-config-db...\n');

  try {
    // Get all databases
    const response = await renderApiRequest('GET', '/v1/postgres');
    console.log('Raw response:', JSON.stringify(response, null, 2));
    
    const databases = Array.isArray(response) ? response : [];
    console.log(`\nFound ${databases.length} database(s)\n`);
    
    if (databases.length === 0) {
      console.error('❌ No databases found in account!');
      process.exit(1);
    }
    
    // Find our database
    const db = databases.find(d => 
      d.name === 'yona-email-config-db' || 
      d.postgres?.name === 'yona-email-config-db'
    );
    
    if (!db) {
      console.error('❌ Database "yona-email-config-db" not found!');
      console.log('\nAvailable databases:');
      databases.forEach(d => {
        console.log(`  - ${d.name || d.postgres?.name || 'unknown'}`);
      });
      process.exit(1);
    }

    // Extract the postgres object
    const postgres = db.postgres;
    
    console.log(`✅ Found database: ${postgres.name}`);
    console.log(`   ID: ${postgres.id}`);
    console.log(`   Status: ${postgres.status}`);
    console.log(`   Region: ${postgres.region}`);
    
    // Get detailed info including connection string
    console.log(`\n🔄 Fetching connection details...`);
    const detailedDb = await renderApiRequest('GET', `/v1/postgres/${postgres.id}`);
    
    console.log(`\n📊 Full database details:\n`);
    console.log(JSON.stringify(detailedDb, null, 2));

    // Extract connection strings from detailed response
    const dbInfo = detailedDb.postgres || detailedDb;
    const internalUrl = dbInfo.connectionString || dbInfo.internalConnectionString;
    const externalUrl = dbInfo.externalConnectionString;

    console.log(`\n🔗 Connection Information:\n`);
    
    if (internalUrl) {
      console.log(`Internal (for Render services):`);
      console.log(`   ${internalUrl}\n`);
    }
    
    if (externalUrl) {
      console.log(`External (for local development):`);
      console.log(`   ${externalUrl}\n`);
    }

    if (!internalUrl && !externalUrl) {
      console.log(`⚠️  No connection strings found in API response`);
      console.log(`   The database might still be initializing`);
      console.log(`   Or connection strings might be under a different property\n`);
    }

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();

