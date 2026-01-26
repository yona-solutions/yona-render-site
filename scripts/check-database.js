/**
 * Check Database Contents
 * Shows record counts and sample data from all tables
 */

require('dotenv').config();
const { Pool } = require('pg');

async function checkDatabase() {
  console.log('🔍 Checking database contents...\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // Check email_groups
    console.log('📧 EMAIL GROUPS:');
    const groupsCount = await pool.query('SELECT COUNT(*) FROM email_groups');
    console.log(`   Total: ${groupsCount.rows[0].count} records\n`);
    
    if (parseInt(groupsCount.rows[0].count) > 0) {
      const groupsSample = await pool.query('SELECT * FROM email_groups LIMIT 5');
      console.log('   Sample data:');
      groupsSample.rows.forEach(row => {
        console.log(`   - ID ${row.id}: ${row.name}`);
        console.log(`     ${row.description || 'No description'}`);
      });
      console.log('');
    }

    // Check email_group_contacts
    console.log('📬 EMAIL GROUP CONTACTS:');
    const contactsCount = await pool.query('SELECT COUNT(*) FROM email_group_contacts');
    console.log(`   Total: ${contactsCount.rows[0].count} records\n`);
    
    if (parseInt(contactsCount.rows[0].count) > 0) {
      const contactsSample = await pool.query(`
        SELECT egc.*, eg.name as group_name 
        FROM email_group_contacts egc
        JOIN email_groups eg ON egc.email_group_id = eg.id
        LIMIT 10
      `);
      console.log('   Sample data:');
      contactsSample.rows.forEach(row => {
        console.log(`   - ${row.email} (${row.group_name})`);
      });
      console.log('');
    }

    // Check report_schedules
    console.log('📊 REPORT SCHEDULES:');
    const schedulesCount = await pool.query('SELECT COUNT(*) FROM report_schedules');
    console.log(`   Total: ${schedulesCount.rows[0].count} records\n`);
    
    if (parseInt(schedulesCount.rows[0].count) > 0) {
      const schedulesSample = await pool.query(`
        SELECT 
          id,
          template_name,
          template_type,
          process,
          frequency,
          enabled,
          last_sent_at,
          next_send_at,
          created_at
        FROM report_schedules 
        ORDER BY id
        LIMIT 10
      `);
      console.log('   Sample data:');
      schedulesSample.rows.forEach(row => {
        console.log(`\n   Schedule ID ${row.id}:`);
        console.log(`   ├─ Name: ${row.template_name}`);
        console.log(`   ├─ Type: ${row.template_type} (${row.process})`);
        console.log(`   ├─ Frequency: ${row.frequency}`);
        console.log(`   ├─ Enabled: ${row.enabled ? 'Yes' : 'No'}`);
        console.log(`   ├─ Last Sent: ${row.last_sent_at || 'Never'}`);
        console.log(`   ├─ Next Send: ${row.next_send_at || 'Not scheduled'}`);
        console.log(`   └─ Created: ${row.created_at}`);
      });
      console.log('');
    }

    console.log('✅ Database check complete!\n');

  } catch (error) {
    console.error('❌ Error checking database:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

checkDatabase();
