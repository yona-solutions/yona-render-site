# Setup Scripts

Automated scripts for deploying and managing infrastructure.

## Database Setup Script

**File**: `setup-database.js`

Automates the creation of a PostgreSQL database on Render using the Render API.

### Features

- ✅ Checks for existing databases
- ✅ Creates PostgreSQL database on Render
- ✅ Waits for database to be ready
- ✅ Runs initial migration (creates tables)
- ✅ Updates web service environment variables
- ✅ Saves connection string to local `.env`
- ✅ Color-coded console output
- ✅ Error handling and validation

### Prerequisites

1. **Render API Key**: Get from [Render Dashboard → Account Settings → API Keys](https://dashboard.render.com/account/api-keys)

2. **Add to .env**:
   ```bash
   RENDER_API_KEY=rnd_xxxxxxxxxxxxxxxxxxxxx
   ```

### Usage

```bash
# From project root
node scripts/setup-database.js
```

### What It Does

1. **Checks for existing database** named `yona-email-config-db`
   - If exists: Uses existing database
   - If not: Creates new one

2. **Creates PostgreSQL database** with:
   - Name: `yona-email-config-db`
   - Database: `yona_email_config`
   - Region: `oregon` (same as web service)
   - Plan: `free` (change to `starter` for production)
   - Version: PostgreSQL 15

3. **Waits for database** to become available
   - Polls every 5 seconds
   - Maximum 5 minutes timeout

4. **Runs migration** (`docs/migrations/001_initial_schema.sql`)
   - Creates tables: `email_groups`, `email_group_contacts`, `report_schedules`
   - Creates indexes for performance
   - Sets up triggers for auto-updates

5. **Updates web service** environment variables
   - Finds your `yona-render-site` service
   - Adds `DATABASE_URL` environment variable
   - Triggers automatic redeploy

6. **Updates local .env** file
   - Appends `DATABASE_URL=...`
   - Preserves existing variables

### Output Example

```
╔═══════════════════════════════════════════════╗
║   Render PostgreSQL Database Setup Script    ║
╚═══════════════════════════════════════════════╝

✓ API key found

🔍 Checking for existing databases...
✓ No existing database found

📦 Creating PostgreSQL database on Render...
✅ Database created successfully!
   ID: dpg-xxxxxxxxxxxxx
   Name: yona-email-config-db
   Status: creating

⏳ Waiting for database to be ready...
   Status: creating (attempt 1/60)
   Status: available (attempt 5/60)
✅ Database is ready!

🔑 Retrieving connection details...
✅ Connection details retrieved

🔄 Running database migration...
✅ Migration completed successfully!
   Tables created: email_groups, email_group_contacts, report_schedules

🔍 Finding web service...
✅ Found web service: yona-render-site
   ID: srv-xxxxxxxxxxxxx

🔧 Updating web service environment...
✅ Environment variables updated
   DATABASE_URL has been added
   Note: Service will automatically redeploy

💾 Saving to local .env file...
✅ DATABASE_URL added to .env

╔═══════════════════════════════════════════════╗
║              Setup Complete! 🎉               ║
╚═══════════════════════════════════════════════╝

📊 Database Information:
   Name: yona-email-config-db
   Status: available
   Region: oregon

🔗 Connection String:
   postgresql://user:pass@host:5432/yona_email_config

📝 Next Steps:
   1. Restart your local server: npm start
   2. Visit: http://localhost:3000/email-config
   3. Start creating email groups and report schedules!

   Note: Your Render web service will automatically redeploy
   with the new DATABASE_URL environment variable
```

### Error Handling

**Missing API Key**:
```
❌ Error: RENDER_API_KEY not found in .env file

Please add your Render API key to .env:
RENDER_API_KEY=your_api_key_here
```

**Database Creation Failed**:
```
❌ Error creating database: API Error 400: Invalid region
```

**Migration Failed**:
```
❌ Migration failed: relation "email_groups" already exists
```

### Manual Steps (if script fails)

If the automated script fails, you can set up manually:

1. **Create Database on Render Dashboard**:
   - Go to https://dashboard.render.com/
   - Click "New +" → "PostgreSQL"
   - Configure and create

2. **Run Migration Manually**:
   ```bash
   # Get connection string from Render dashboard
   export DATABASE_URL="postgresql://..."
   
   # Run migration
   psql $DATABASE_URL < docs/migrations/001_initial_schema.sql
   ```

3. **Add to Web Service**:
   - Go to your web service on Render
   - Environment tab → Add variable
   - Key: `DATABASE_URL`
   - Value: (paste connection string)

4. **Add to Local .env**:
   ```bash
   echo "DATABASE_URL=postgresql://..." >> .env
   ```

### Configuration

Edit these variables in the script if needed:

```javascript
const DB_NAME = 'yona-email-config-db';  // Database name on Render
const DATABASE_NAME = 'yona_email_config'; // Database name
const REGION = 'oregon';                   // Region (oregon, ohio, frankfurt, singapore)
```

Change plan for production:
```javascript
plan: 'starter', // Instead of 'free'
```

### Troubleshooting

**Issue**: "API Error 401: Unauthorized"
- **Fix**: Check your RENDER_API_KEY is correct

**Issue**: "Database did not become available within timeout"
- **Fix**: Check Render status page, may be experiencing issues

**Issue**: "Migration failed: table already exists"
- **Fix**: Tables already created, this is OK. Script will continue.

**Issue**: "Web service not found"
- **Fix**: Script looks for 'yona-render-site', adjust `findWebService()` if your service has a different name

### Security Notes

- Never commit `.env` file (already in `.gitignore`)
- API keys have full account access - keep them secure
- Use free plan for development, paid plans for production
- Connection strings contain passwords - treat as secrets

### Next Steps After Setup

1. Test locally: `npm start` → http://localhost:3000/email-config
2. Create email groups
3. Create report schedules
4. Verify data persists after page refresh
5. Check Render logs for any errors

### Support

For issues or questions:
1. Check Render dashboard for database status
2. Check application logs: `npm start` output
3. Review `docs/EMAIL_CONFIG_SETUP.md` for manual setup
4. Check Render API docs: https://api-docs.render.com/

