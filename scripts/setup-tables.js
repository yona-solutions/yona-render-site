/**
 * Database Table Setup Script
 * Creates all required tables for email scheduler
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function setupTables() {
  console.log('🗄️  Setting up database tables...\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // Test connection
    console.log('📡 Testing database connection...');
    const testResult = await pool.query('SELECT NOW()');
    console.log('✅ Connected successfully at:', testResult.rows[0].now);
    console.log('');

    // Read the schema file
    const schemaPath = path.join(__dirname, '../docs/COMPLETE_DATABASE_SCHEMA.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    // Execute the schema
    console.log('📋 Creating tables...');
    await pool.query(schema);
    console.log('✅ Tables created successfully!\n');

    // Verify tables
    console.log('🔍 Verifying tables...');
    const tablesResult = await pool.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);

    console.log('📊 Tables in database:');
    tablesResult.rows.forEach(row => {
      console.log(`   ✓ ${row.tablename}`);
    });
    console.log('');

    // Show table details
    for (const table of tablesResult.rows) {
      const countResult = await pool.query(`SELECT COUNT(*) as count FROM ${table.tablename}`);
      console.log(`   ${table.tablename}: ${countResult.rows[0].count} rows`);
    }

    console.log('\n✅ Database setup complete!');
    console.log('   You can now use the email scheduler functionality.');

  } catch (error) {
    console.error('❌ Error setting up database:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

setupTables();
