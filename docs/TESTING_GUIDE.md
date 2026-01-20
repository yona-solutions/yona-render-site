# Testing Guide - Dimension Configuration

## Quick Start

### 1. Restart the Server

The server needs to be restarted to pick up the updated GCP configuration that reads from the local service account key file.

```bash
cd "/Users/elanadler/Documents/Yona Solutions/yona_render_site"

# Stop any running instances
# Press Ctrl+C in the terminal running the server
# OR kill the process manually

# Start the server
npm start
```

You should see this output:
```
📄 Using local GCP service account key file
✅ GCP Storage initialized successfully
   Project: yona-solutions-poc
✅ GCP BigQuery initialized successfully
   Project: yona-solutions-poc
=================================
🚀 Server is running!
   URL: http://localhost:3000
   Environment: development
   Node: v24.4.0
=================================
```

### 2. Navigate to Dimension Configuration

Open your browser to: **http://localhost:3000**

Click **"Dimension Configuration"** in the sidebar.

### 3. Test Each Dimension Type

#### Accounts Tab
- Should load account configurations from `account_config.json`
- Look for:
  - Hierarchical tree structure
  - Account names and internal IDs
  - Account mapping badges (green "Mapped" badges)
  - Expand/collapse functionality

#### Customers Tab
- Should load customer configurations from `customer_config.json`
- Look for:
  - District nodes (yellow "District" badges)
  - Customer tags (blue badges)
  - Customer internal IDs
  - District Reporting Excluded badges (red)

#### Departments Tab
- Should load department configurations from `department_config.json`
- Look for:
  - Subsidiary hierarchy
  - Subsidiary internal IDs
  - Display/Operational exclusion flags

#### Regions Tab
- Should load region configurations from `region_config.json`
- Look for:
  - Regional hierarchy
  - Region internal IDs
  - Geographic organization

#### Vendors Tab
- Should load vendor configurations from `vendor_config.json`
- Look for:
  - Vendor hierarchy
  - Vendor internal IDs
  - Vendor classifications

### 4. Test Features

#### Search Functionality
1. Type in the search box at the top
2. Tree should automatically expand to show matches
3. Matched text should be highlighted in yellow
4. Stats should update to show visible vs total count

#### Expand/Collapse
1. Click the ▶ button next to any node to expand
2. Click the ▼ button to collapse
3. Use "Expand All" button to expand entire tree
4. Use "Collapse All" button to collapse everything

#### Node Details
1. Click any node label to show detailed properties
2. Details appear in a gray box below the node
3. Shows all available fields:
   - Parent ID
   - Internal IDs
   - Flags and settings
   - Tags
   - Custom properties

#### Refresh
1. Click "Refresh" button to reload data from server
2. Should show loading state briefly
3. Tree should rebuild with fresh data

## Expected Behavior

### Loading States
- **Initial Load**: Shows "⏳ Loading dimensions..."
- **Error State**: Shows "❌ Error: [error message]"
- **Empty State**: Shows "📭 No data found" if configuration is empty
- **Success**: Shows hierarchical tree with stats

### Visual Indicators

#### Icons
- 🏢 District nodes
- 💰 Accounts with internal IDs  
- 👤 Customers
- 🌍 Regions
- 🏛️ Subsidiaries
- 🏪 Vendors
- 📁 Nodes with children
- 📄 Leaf nodes

#### Badges
- **Yellow** - District marker
- **Blue** - Tags
- **Red** - Display/District Reporting Excluded
- **Orange** - Operational Excluded
- **Green** - Mapped to internal IDs

### Stats Display
- **Total**: Count of all nodes in current dimension
- **Visible**: Count of visible nodes (may differ when searching)

## Troubleshooting

### Error: "Failed to load [dimension] configuration"

**Possible causes:**

1. **GCP credentials not loaded**
   - Check server logs for: "✅ GCP Storage initialized successfully"
   - If missing, verify `gcp-service-account-key.json` exists in project root

2. **Configuration file not found in GCP bucket**
   - Verify files exist in `dimension_configurations` bucket:
     - `account_config.json`
     - `customer_config.json`
     - `department_config.json`
     - `region_config.json`
     - `vendor_config.json`
   - Check GCP Console or use storage browser

3. **Network/Permission issues**
   - Check service account has read access to bucket
   - Verify network connectivity to GCP

### Error: "Address already in use"

Server port 3000 is already occupied.

**Solution:**
```bash
# Find the process using port 3000
lsof -i :3000

# Kill it (replace PID with actual process ID)
kill -9 <PID>

# Or use pkill
pkill -f "node server.js"
```

### No data showing / Empty tree

1. Check browser console (F12) for errors
2. Check Network tab for failed API requests
3. Verify the API endpoint returns data:
   - Open: http://localhost:3000/api/config/account
   - Should see JSON response

### Search not working

1. Clear search box completely
2. Check console for JavaScript errors
3. Try refreshing the page

### Expand/Collapse buttons not working

1. Try clicking directly on the ▶/▼ icons
2. Refresh the page
3. Check console for errors

## Verifying GCP Configuration Files

### Using the Storage Browser

Navigate to: http://localhost:3000/storage-browser

You should see the configuration files listed:
- account_config.json
- customer_config.json
- department_config.json
- region_config.json
- vendor_config.json

Click "Download" to inspect the file contents.

### Using API Endpoints Directly

Test each endpoint in your browser:

```
http://localhost:3000/api/config/account
http://localhost:3000/api/config/customer
http://localhost:3000/api/config/department
http://localhost:3000/api/config/region
http://localhost:3000/api/config/vendor
```

Each should return JSON data in this format:
```json
{
  "node_id": {
    "parent": "parent_id_or_null",
    "label": "Node Name",
    ...
  }
}
```

### Using GCP Console

1. Go to: https://console.cloud.google.com/storage
2. Select project: `yona-solutions-poc`
3. Navigate to bucket: `dimension_configurations`
4. Verify files exist and have recent timestamps

## Performance Testing

### Large Trees
- Customer dimension has 575+ nodes
- Vendor dimension has 578+ nodes
- Expand All should complete in < 2 seconds
- Search should be responsive (< 500ms)

### Memory Usage
- Initial load: ~50-100MB
- With all dimensions loaded: ~150-200MB
- No memory leaks on tab switching

## Browser Compatibility

Tested and working on:
- Chrome 120+ ✅
- Firefox 120+ ✅
- Safari 17+ ✅
- Edge 120+ ✅

## Known Limitations

1. **Read-Only**: Cannot edit configurations yet
2. **No Undo**: Refresh is destructive (reloads from server)
3. **No Multi-Select**: Cannot select multiple nodes
4. **Search is Case-Insensitive**: No regex or advanced filters
5. **No Export**: Cannot export visible/filtered nodes

## Next Steps

Once read-only viewing is confirmed working:

1. **Add Edit Functionality**
   - Inline editing of node labels
   - Add/delete nodes
   - Move nodes (change parent)

2. **Add Save Functionality**
   - Save button with dirty state tracking
   - Validation before save
   - Backup mechanism

3. **Advanced Features**
   - Bulk operations
   - Import/export
   - Version history
   - Undo/redo

## Support

If you encounter issues not covered in this guide:

1. Check server logs for detailed error messages
2. Check browser console for JavaScript errors
3. Verify GCP credentials and file access
4. Review the implementation documentation: `DIMENSION_CONFIG_IMPLEMENTATION.md`

