#!/usr/bin/env node
/**
 * Render Database Setup Script
 * 
 * Automates the creation of a PostgreSQL database on Render
 * and optionally runs the initial migration.
 * 
 * Requirements:
 * - RENDER_API_KEY in .env file
 * 
 * Usage:
 *   node scripts/setup-database.js
 */

require('dotenv').config();
const https = require('https');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Configuration
const RENDER_API_KEY = process.env.RENDER_API_KEY;
const DB_NAME = 'yona-email-config-db';
const DATABASE_NAME = 'yona_email_config';
const REGION = 'oregon'; // Same region as your web service

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[36m',
  dim: '\x1b[2m'
};

/**
 * Make HTTPS request to Render API
 */
function renderApiRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.render.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${RENDER_API_KEY}`,
        'Content-Type': 'application/json'
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
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`API Error ${res.statusCode}: ${data}`));
          }
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if database already exists
 */
async function checkExistingDatabase() {
  console.log(`\n${colors.blue}🔍 Checking for existing databases...${colors.reset}`);
  
  try {
    const response = await renderApiRequest('GET', '/v1/postgres');
    
    // Response should be an array
    const databases = Array.isArray(response) ? response : [];
    console.log(`${colors.dim}   Found ${databases.length} database(s) in account${colors.reset}`);
    
    // Find database with matching name
    const existing = databases.find(db => db.name === DB_NAME);
    
    if (existing) {
      console.log(`${colors.yellow}⚠️  Database '${DB_NAME}' already exists!${colors.reset}`);
      console.log(`${colors.dim}   ID: ${existing.id}${colors.reset}`);
      console.log(`${colors.dim}   Status: ${existing.status}${colors.reset}`);
      console.log(`${colors.dim}   Region: ${existing.region}${colors.reset}`);
      return existing;
    }
    
    console.log(`${colors.green}✓ No existing database found with name '${DB_NAME}'${colors.reset}`);
    return null;
  } catch (error) {
    console.error(`${colors.red}❌ Error checking databases: ${error.message}${colors.reset}`);
    // Don't throw - databases might not exist yet
    return null;
  }
}

/**
 * Get owner information
 */
async function getOwner() {
  try {
    const response = await renderApiRequest('GET', '/v1/owners');
    const owners = Array.isArray(response) ? response : [response];
    
    if (owners.length === 0) {
      throw new Error('No owners found in account');
    }
    
    // Render API returns array of objects with {cursor, owner} structure
    const firstOwner = owners[0].owner || owners[0];
    
    if (!firstOwner || !firstOwner.id) {
      throw new Error('Invalid owner structure in API response');
    }
    
    return firstOwner;
  } catch (error) {
    console.error(`${colors.red}❌ Error getting owner: ${error.message}${colors.reset}`);
    throw error;
  }
}

/**
 * Create PostgreSQL database on Render
 */
async function createDatabase() {
  console.log(`\n${colors.blue}📦 Creating PostgreSQL database on Render...${colors.reset}`);
  
  // Get owner ID
  const owner = await getOwner();
  if (!owner || !owner.id) {
    throw new Error('Could not retrieve owner information');
  }
  
  console.log(`${colors.dim}   Owner ID: ${owner.id}${colors.reset}`);
  
  const requestBody = {
    ownerId: owner.id,
    name: DB_NAME,
    databaseName: DATABASE_NAME,
    databaseUser: 'yona_user',
    region: REGION,
    plan: 'free', // Use 'starter' for production
    version: '15'
  };

  console.log(`${colors.dim}   Request: ${JSON.stringify(requestBody, null, 2)}${colors.reset}`);

  try {
    const database = await renderApiRequest('POST', '/v1/postgres', requestBody);
    
    console.log(`${colors.green}✅ Database created successfully!${colors.reset}`);
    console.log(`${colors.dim}   ID: ${database.id}${colors.reset}`);
    console.log(`${colors.dim}   Name: ${database.name}${colors.reset}`);
    console.log(`${colors.dim}   Status: ${database.status}${colors.reset}`);
    
    return database;
  } catch (error) {
    console.error(`${colors.red}❌ Error creating database: ${error.message}${colors.reset}`);
    console.log(`${colors.yellow}   This might be due to:${colors.reset}`);
    console.log(`   - Account doesn't have permission to create databases`);
    console.log(`   - Free database limit reached (check Render dashboard)`);
    console.log(`   - Invalid region or plan specified`);
    console.log(`\n   ${colors.dim}Please create the database manually via Render dashboard${colors.reset}`);
    throw error;
  }
}

/**
 * Wait for database to be available
 */
async function waitForDatabase(databaseId) {
  console.log(`\n${colors.blue}⏳ Waiting for database to be ready...${colors.reset}`);
  
  const maxAttempts = 60; // 5 minutes max
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    try {
      const database = await renderApiRequest('GET', `/v1/postgres/${databaseId}`);
      
      if (database.status === 'available') {
        console.log(`${colors.green}✅ Database is ready!${colors.reset}`);
        return database;
      }
      
      console.log(`${colors.yellow}   Status: ${database.status} (attempt ${attempts + 1}/${maxAttempts})${colors.reset}`);
      await sleep(5000); // Wait 5 seconds
      attempts++;
    } catch (error) {
      console.error(`${colors.red}   Error checking status: ${error.message}${colors.reset}`);
      await sleep(5000);
      attempts++;
    }
  }
  
  throw new Error('Database did not become available within timeout period');
}

/**
 * Get database connection details
 */
async function getDatabaseDetails(databaseId) {
  console.log(`\n${colors.blue}🔑 Retrieving connection details...${colors.reset}`);
  
  try {
    const database = await renderApiRequest('GET', `/v1/postgres/${databaseId}`);
    
    // Connection strings are in the database object
    const connectionInfo = {
      internalConnectionString: database.connectionInfo?.internalConnectionString,
      externalConnectionString: database.connectionInfo?.externalConnectionString,
      host: database.connectionInfo?.host,
      port: database.connectionInfo?.port,
      databaseName: database.databaseName,
      databaseUser: database.databaseUser
    };
    
    console.log(`${colors.green}✅ Connection details retrieved${colors.reset}`);
    return { database, connectionInfo };
  } catch (error) {
    console.error(`${colors.red}❌ Error getting connection details: ${error.message}${colors.reset}`);
    throw error;
  }
}

/**
 * Run database migration
 */
async function runMigration(connectionString) {
  console.log(`\n${colors.blue}🔄 Running database migration...${colors.reset}`);
  
  const migrationPath = path.join(__dirname, '../docs/migrations/001_initial_schema.sql');
  
  if (!fs.existsSync(migrationPath)) {
    console.log(`${colors.yellow}⚠️  Migration file not found: ${migrationPath}${colors.reset}`);
    return false;
  }
  
  const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
  
  // Remove psql-specific commands that won't work in pg
  const cleanedSQL = migrationSQL
    .split('\n')
    .filter(line => !line.trim().startsWith('\\'))
    .join('\n');
  
  const pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    // Run migration
    await pool.query(cleanedSQL);
    
    // Verify tables were created
    const result = await pool.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    
    console.log(`${colors.green}✅ Migration completed successfully!${colors.reset}`);
    console.log(`${colors.dim}   Tables created: ${result.rows.map(r => r.tablename).join(', ')}${colors.reset}`);
    
    await pool.end();
    return true;
  } catch (error) {
    console.error(`${colors.red}❌ Migration failed: ${error.message}${colors.reset}`);
    await pool.end();
    return false;
  }
}

/**
 * Find web service
 */
async function findWebService() {
  console.log(`\n${colors.blue}🔍 Finding web service...${colors.reset}`);
  
  try {
    const response = await renderApiRequest('GET', '/v1/services?limit=100');
    const services = Array.isArray(response) ? response : [];
    
    console.log(`${colors.dim}   Found ${services.length} service(s) in account${colors.reset}`);
    
    // Look for yona-render-site service
    const webService = services.find(s => 
      s.service?.name === 'yona-render-site' || 
      s.service?.slug === 'yona-render-site' ||
      (s.service?.name && s.service.name.toLowerCase().includes('yona'))
    );
    
    if (webService && webService.service) {
      console.log(`${colors.green}✅ Found web service: ${webService.service.name}${colors.reset}`);
      console.log(`${colors.dim}   ID: ${webService.service.id}${colors.reset}`);
      return webService.service;
    }
    
    console.log(`${colors.yellow}⚠️  Web service 'yona-render-site' not found${colors.reset}`);
    console.log(`${colors.dim}   You can manually add DATABASE_URL to your service${colors.reset}`);
    return null;
  } catch (error) {
    console.error(`${colors.red}❌ Error finding web service: ${error.message}${colors.reset}`);
    return null;
  }
}

/**
 * Update web service environment variables
 */
async function updateServiceEnvironment(serviceId, databaseUrl) {
  console.log(`\n${colors.blue}🔧 Updating web service environment...${colors.reset}`);
  
  try {
    // Get existing environment variables
    const envVars = await renderApiRequest('GET', `/v1/services/${serviceId}/env-vars`);
    
    // Check if DATABASE_URL already exists
    const existingVar = envVars.find(v => v.key === 'DATABASE_URL');
    
    if (existingVar) {
      console.log(`${colors.yellow}⚠️  DATABASE_URL already exists in service environment${colors.reset}`);
      console.log(`${colors.dim}   Skipping update to avoid overwriting${colors.reset}`);
      return false;
    }
    
    // Add DATABASE_URL
    const updatedEnvVars = [
      ...envVars.map(v => ({ key: v.key, value: v.value })),
      { key: 'DATABASE_URL', value: databaseUrl }
    ];
    
    await renderApiRequest('PUT', `/v1/services/${serviceId}/env-vars`, updatedEnvVars);
    
    console.log(`${colors.green}✅ Environment variables updated${colors.reset}`);
    console.log(`${colors.dim}   DATABASE_URL has been added${colors.reset}`);
    console.log(`${colors.yellow}   Note: Service will automatically redeploy${colors.reset}`);
    return true;
  } catch (error) {
    console.error(`${colors.red}❌ Error updating environment: ${error.message}${colors.reset}`);
    return false;
  }
}

/**
 * Save connection details to local .env
 */
async function saveToLocalEnv(databaseUrl) {
  console.log(`\n${colors.blue}💾 Saving to local .env file...${colors.reset}`);
  
  const envPath = path.join(__dirname, '../.env');
  
  try {
    let envContent = '';
    
    // Read existing .env if it exists
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
      
      // Check if DATABASE_URL already exists
      if (envContent.includes('DATABASE_URL=')) {
        console.log(`${colors.yellow}⚠️  DATABASE_URL already exists in .env${colors.reset}`);
        console.log(`${colors.dim}   Skipping update to avoid overwriting${colors.reset}`);
        return false;
      }
    }
    
    // Append DATABASE_URL
    const newLine = `\n# PostgreSQL Database (added by setup-database.js)\nDATABASE_URL=${databaseUrl}\n`;
    envContent += newLine;
    
    fs.writeFileSync(envPath, envContent);
    
    console.log(`${colors.green}✅ DATABASE_URL added to .env${colors.reset}`);
    return true;
  } catch (error) {
    console.error(`${colors.red}❌ Error updating .env: ${error.message}${colors.reset}`);
    return false;
  }
}

/**
 * Main setup function
 */
async function main() {
  console.log(`${colors.green}
╔═══════════════════════════════════════════════╗
║   Render PostgreSQL Database Setup Script    ║
╚═══════════════════════════════════════════════╝
${colors.reset}`);

  // Check for API key
  if (!RENDER_API_KEY) {
    console.error(`${colors.red}❌ Error: RENDER_API_KEY not found in .env file${colors.reset}`);
    console.log(`\nPlease add your Render API key to .env:`);
    console.log(`${colors.dim}RENDER_API_KEY=your_api_key_here${colors.reset}\n`);
    process.exit(1);
  }

  console.log(`${colors.green}✓ API key found${colors.reset}`);

  try {
    // Step 1: Check for existing database
    const existingDb = await checkExistingDatabase();
    
    let database;
    let connectionString;
    
    if (existingDb) {
      // Use existing database
      database = existingDb;
      
      if (database.status !== 'available') {
        console.log(`${colors.yellow}⏳ Waiting for existing database to be available...${colors.reset}`);
        database = await waitForDatabase(database.id);
      }
      
      const { connectionInfo } = await getDatabaseDetails(database.id);
      connectionString = connectionInfo.internalConnectionString;
    } else {
      // Step 2: Create new database
      database = await createDatabase();
      
      // Step 3: Wait for database to be ready
      database = await waitForDatabase(database.id);
      
      // Step 4: Get connection details
      const { connectionInfo } = await getDatabaseDetails(database.id);
      connectionString = connectionInfo.internalConnectionString;
    }
    
    // Step 5: Run migration
    const migrationSuccess = await runMigration(connectionString);
    
    if (!migrationSuccess) {
      console.log(`${colors.yellow}\n⚠️  Migration was skipped or failed${colors.reset}`);
      console.log(`${colors.dim}   You can run it manually later using:${colors.reset}`);
      console.log(`${colors.dim}   psql "${connectionString}" < docs/migrations/001_initial_schema.sql${colors.reset}`);
    }
    
    // Step 6: Update web service (optional)
    const webService = await findWebService();
    if (webService) {
      await updateServiceEnvironment(webService.id, connectionString);
    }
    
    // Step 7: Save to local .env
    await saveToLocalEnv(connectionString);
    
    // Summary
    console.log(`\n${colors.green}╔═══════════════════════════════════════════════╗`);
    console.log(`║              Setup Complete! 🎉               ║`);
    console.log(`╚═══════════════════════════════════════════════╝${colors.reset}\n`);
    
    console.log(`${colors.blue}📊 Database Information:${colors.reset}`);
    console.log(`${colors.dim}   Name: ${database.name}${colors.reset}`);
    console.log(`${colors.dim}   Status: ${database.status}${colors.reset}`);
    console.log(`${colors.dim}   Region: ${database.region}${colors.reset}`);
    
    console.log(`\n${colors.blue}🔗 Connection String:${colors.reset}`);
    console.log(`${colors.dim}   ${connectionString}${colors.reset}`);
    
    console.log(`\n${colors.yellow}📝 Next Steps:${colors.reset}`);
    console.log(`   1. Restart your local server: ${colors.dim}npm start${colors.reset}`);
    console.log(`   2. Visit: ${colors.dim}http://localhost:3000/email-config${colors.reset}`);
    console.log(`   3. Start creating email groups and report schedules!`);
    
    if (webService) {
      console.log(`\n   ${colors.yellow}Note: Your Render web service will automatically redeploy${colors.reset}`);
      console.log(`   ${colors.dim}with the new DATABASE_URL environment variable${colors.reset}`);
    }
    
    console.log('');
    
  } catch (error) {
    console.error(`\n${colors.red}╔═══════════════════════════════════════════════╗`);
    console.error(`║            Setup Failed ❌                    ║`);
    console.error(`╚═══════════════════════════════════════════════╝${colors.reset}\n`);
    console.error(`${colors.red}Error: ${error.message}${colors.reset}\n`);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { main };

