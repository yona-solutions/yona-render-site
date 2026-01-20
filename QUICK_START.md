# Quick Start - Dimension Configuration Viewer

## 🚀 Start in 3 Steps

### 1️⃣ Restart Server
```bash
cd "/Users/elanadler/Documents/Yona Solutions/yona_render_site"
npm start
```

### 2️⃣ Open Browser
Navigate to: **http://localhost:3000**

### 3️⃣ Click "Dimension Configuration"
It's in the left sidebar!

---

## ✨ What You Can Do

### 📑 View 5 Dimension Types
- **Accounts** - Financial accounts
- **Customers** - Customers & districts  
- **Departments** - Organizational structure
- **Regions** - Geographic hierarchy
- **Vendors** - Vendor relationships

### 🔍 Search & Navigate
- Type to search across all nodes
- Click ▶ to expand nodes
- Click labels to see details
- Use "Expand All" / "Collapse All"

### 🏷️ Visual Indicators
- 🏢 Districts
- 💰 Mapped accounts
- Blue badges = Tags
- Yellow badges = Districts
- Green badges = Mapped IDs

---

## 🐛 Troubleshooting

**Error loading data?**
→ Restart the server (Ctrl+C then `npm start`)

**Port 3000 in use?**
→ Kill it: `pkill -f "node server.js"`

**Still not working?**
→ Check: `docs/TESTING_GUIDE.md`

---

## 📊 What's Loaded

Files from GCP bucket `dimension_configurations`:
- `account_config.json`
- `customer_config.json`
- `department_config.json`
- `region_config.json`
- `vendor_config.json`

---

## 🎯 Status: ✅ Read-Only Viewer Complete

**Next Phases:**
- Phase 2: Edit functionality
- Phase 3: Save to GCP
- Phase 4: Advanced features

---

**Full Documentation**: `README_DIMENSION_CONFIG.md`  
**Testing Guide**: `docs/TESTING_GUIDE.md`  
**Implementation Details**: `docs/DIMENSION_CONFIG_IMPLEMENTATION.md`

