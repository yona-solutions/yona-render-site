/**
 * Check District Children
 * Shows which districts have child customers
 */

require('dotenv').config();
const StorageService = require('../src/services/storageService');
const storageService = new StorageService();

async function checkDistrictChildren() {
  console.log('🔍 Checking district children in customer_config.json...\n');

  try {
    // Initialize GCP Storage
    await storageService.initialize();
    
    const configData = await storageService.getFileAsJson('customer_config.json');
    
    // Find all districts
    const districts = {};
    for (const [id, config] of Object.entries(configData)) {
      if (config.isDistrict) {
        districts[id] = {
          label: config.label,
          children: []
        };
      }
    }
    
    console.log(`📊 Found ${Object.keys(districts).length} districts\n`);
    
    // Find all customers (non-districts)
    for (const [id, config] of Object.entries(configData)) {
      if (!config.isDistrict && config.parent) {
        const parent = config.parent;
        if (districts[parent]) {
          districts[parent].children.push({
            id: id,
            label: config.label,
            customer_id: config.customer_internal_id
          });
        }
      }
    }
    
    // Show results
    console.log('📋 District Children Report:\n');
    for (const [districtId, data] of Object.entries(districts).slice(0, 10)) {
      console.log(`District ${districtId}: ${data.label}`);
      console.log(`   Children: ${data.children.length}`);
      if (data.children.length > 0) {
        console.log(`   Sample: ${data.children.slice(0, 3).map(c => c.label).join(', ')}`);
      } else {
        console.log(`   ⚠️  NO CHILDREN - This district will not work for P&L reports`);
      }
      console.log('');
    }
    
    // Summary
    const districtsWithChildren = Object.values(districts).filter(d => d.children.length > 0);
    const districtsWithoutChildren = Object.values(districts).filter(d => d.children.length === 0);
    
    console.log('\n📊 Summary:');
    console.log(`   Total districts: ${Object.keys(districts).length}`);
    console.log(`   With children: ${districtsWithChildren.length}`);
    console.log(`   Without children: ${districtsWithoutChildren.length}`);
    
    if (districtsWithChildren.length > 0) {
      console.log('\n✅ Districts that WILL work for P&L/Email:');
      districtsWithChildren.slice(0, 5).forEach(d => {
        const id = Object.entries(districts).find(([k, v]) => v === d)[0];
        console.log(`   - ID: ${id} → ${d.label} (${d.children.length} customers)`);
      });
    }
    
    if (districtsWithoutChildren.length > 0) {
      console.log('\n❌ Districts that will NOT work (no customers):');
      districtsWithoutChildren.slice(0, 5).forEach(d => {
        const id = Object.entries(districts).find(([k, v]) => v === d)[0];
        console.log(`   - ID: ${id} → ${d.label}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkDistrictChildren();
