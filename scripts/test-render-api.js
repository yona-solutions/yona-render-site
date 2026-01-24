#!/usr/bin/env node
/**
 * Test Render API Connection
 * 
 * Simple diagnostic script to test Render API connectivity and permissions
 */

require('dotenv').config();
const https = require('https');

const RENDER_API_KEY = process.env.RENDER_API_KEY;

function renderApiRequest(method, path, body = null) {
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

    console.log(`\n📡 ${method} https://api.render.com${path}`);

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        console.log(`   Status: ${res.statusCode}`);
        
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`   ✅ Success`);
            resolve(parsed);
          } else {
            console.log(`   ❌ Error: ${parsed.message || JSON.stringify(parsed)}`);
            reject(new Error(`API Error ${res.statusCode}: ${parsed.message || data}`));
          }
        } catch (e) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`   ✅ Success (non-JSON response)`);
            resolve(data);
          } else {
            console.log(`   ❌ Error: ${data}`);
            reject(new Error(`API Error ${res.statusCode}: ${data}`));
          }
        }
      });
    });

    req.on('error', (e) => {
      console.log(`   ❌ Request failed: ${e.message}`);
      reject(e);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

async function main() {
  console.log('🧪 Render API Test\n');
  console.log('='.repeat(50));

  if (!RENDER_API_KEY) {
    console.error('❌ RENDER_API_KEY not found in .env');
    process.exit(1);
  }

  console.log(`✅ API Key: ${RENDER_API_KEY.substring(0, 10)}...`);
  console.log('='.repeat(50));

  try {
    // Test 1: List services
    console.log('\n📋 Test 1: List Services');
    const services = await renderApiRequest('GET', '/v1/services?limit=5');
    console.log(`   Found ${services.length} service(s)`);
    if (services.length > 0) {
      services.forEach(s => {
        console.log(`   - ${s.name} (${s.type}) - ${s.id}`);
      });
    }

    // Test 2: List databases  
    console.log('\n📋 Test 2: List Databases');
    try {
      const databases = await renderApiRequest('GET', '/v1/postgres');
      console.log(`   Found ${databases.length} database(s)`);
      if (databases.length > 0) {
        databases.forEach(db => {
          console.log(`   - ${db.name} (${db.status}) - ${db.id}`);
        });
      }
    } catch (error) {
      console.log(`   ⚠️  Could not list databases: ${error.message}`);
      console.log(`   This might mean:`);
      console.log(`   - No databases exist yet (this is OK)`);
      console.log(`   - API key doesn't have database permissions`);
      console.log(`   - Account doesn't have database feature enabled`);
    }

    // Test 3: Get account info
    console.log('\n📋 Test 3: Get Owner Info');
    try {
      const owners = await renderApiRequest('GET', '/v1/owners');
      console.log(`   Raw response type: ${typeof owners}`);
      console.log(`   Is array: ${Array.isArray(owners)}`);
      console.log(`   Response: ${JSON.stringify(owners, null, 2)}`);
      
      if (Array.isArray(owners) && owners.length > 0) {
        const owner = owners[0];
        console.log(`   Owner ID: ${owner.id}`);
        console.log(`   Email: ${owner.email || 'N/A'}`);
        console.log(`   Name: ${owner.name || 'N/A'}`);
      }
    } catch (error) {
      console.log(`   ⚠️  Could not get owner info: ${error.message}`);
    }

    console.log('\n' + '='.repeat(50));
    console.log('✅ API Connection Test Complete!');
    console.log('='.repeat(50) + '\n');

  } catch (error) {
    console.log('\n' + '='.repeat(50));
    console.log('❌ API Test Failed');
    console.log('='.repeat(50));
    console.error(`\nError: ${error.message}\n`);
    process.exit(1);
  }
}

main();

