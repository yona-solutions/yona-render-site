# Manual Database Setup Guide

Quick guide for setting up PostgreSQL on Render manually via the dashboard.

## Step 1: Create PostgreSQL Database

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **"New +"** button (top right)
3. Select **"PostgreSQL"**

## Step 2: Configure Database

Fill in the form:

- **Name**: `yona-email-config-db`
- **Database**: `yona_email_config` _(this is the actual database name)_
- **User**: `yona_user` _(or leave default)_
- **Region**: **Oregon (US West)** _(same as your web service)_
- **PostgreSQL Version**: **15** _(or latest)_
- **Datadog API Key**: _(leave blank)_
- **Plan**: 
  - **Free** for testing/development
  - **Starter ($7/month)** for production

Click **"Create Database"**

## Step 3: Wait for Database Creation

- Status will show **"Creating..."**
- Takes 2-5 minutes
- Wait until status shows **"Available"**

## Step 4: Get Connection String

Once available, you'll see connection information:

### Internal Connection String
```
postgresql://user:password@hostname-internal:5432/yona_email_config
```
☝️ **Use this for your Render web service**

### External Connection String  
```
postgresql://user:password@hostname-external:5432/yona_email_config
```
☝️ **Use this for local development**

## Step 5: Run Migration

### Option A: Using Render Shell (Easiest)

1. In Render dashboard, go to your database
2. Click **"Shell"** tab at the top
3. Copy the contents of `docs/migrations/001_initial_schema.sql`
4. Paste into the shell
5. Press Enter
6. Verify tables created:
   ```sql
   \dt
   ```

### Option B: Using Local psql

```bash
# From your project root
psql "postgresql://user:password@hostname-external:5432/yona_email_config" \
  < docs/migrations/001_initial_schema.sql
```

## Step 6: Add to Render Web Service

1. Go to your **yona-render-site** web service on Render
2. Click **"Environment"** tab
3. Click **"Add Environment Variable"**
4. Add:
   - **Key**: `DATABASE_URL`
   - **Value**: _(paste Internal Connection String from Step 4)_
5. Click **"Save Changes"**

⚠️ **Your service will automatically redeploy** (takes 2-3 minutes)

## Step 7: Add to Local .env

```bash
# From your project root
cd yona_render_site

# Add to .env file
echo 'DATABASE_URL=postgresql://user:password@hostname-external:5432/yona_email_config' >> .env
```

**Important**: Use the **External** connection string for local development!

## Step 8: Test

### Test Locally

```bash
# Start server
npm start

# Visit email config page
# Open browser: http://localhost:3000/email-config

# You should see the email configuration interface
# Try creating an email group
```

### Test on Render

1. Wait for deployment to complete
2. Visit your Render URL: `https://your-site.onrender.com/email-config`
3. Create test email group
4. Refresh page - data should persist

## Verification Checklist

- [ ] Database status is "Available" on Render
- [ ] Migration ran successfully (3 tables created)
- [ ] `DATABASE_URL` added to web service environment
- [ ] `DATABASE_URL` added to local `.env`
- [ ] Local server starts without database errors
- [ ] Can create/edit email groups locally
- [ ] Can create/edit report schedules locally
- [ ] Render deployment completed successfully
- [ ] Production site loads `/email-config` page
- [ ] Data persists after page refresh

## Troubleshooting

### Connection Refused

**Problem**: Can't connect to database

**Solutions**:
- Check database status is "Available"
- Verify connection string is correct
- Use **Internal** string for Render, **External** for local
- Check for typos in DATABASE_URL

### Migration Fails: "Table already exists"

**Problem**: Tables already created

**Solution**: This is fine! Tables exist, migration already ran. You're good to go.

### Environment Variable Not Working

**Problem**: Web service can't find DATABASE_URL

**Solutions**:
- Verify variable name is exactly `DATABASE_URL` (case-sensitive)
- Check for extra spaces in value
- Wait for redeploy to complete
- Check service logs for errors

### Tables Don't Persist

**Problem**: Data disappears after page refresh

**Solutions**:
- Verify DATABASE_URL is set correctly
- Check server logs for database errors
- Ensure migration created tables successfully:
  ```sql
  -- In database shell
  SELECT tablename FROM pg_tables WHERE schemaname = 'public';
  ```

## Database Management

### View Tables

```sql
-- List all tables
\dt

-- Describe a table
\d email_groups
```

### View Data

```sql
-- See all email groups
SELECT * FROM email_groups;

-- See all report schedules
SELECT * FROM report_schedules;

-- See contacts with group names
SELECT 
  eg.name as group_name,
  egc.email,
  egc.created_at
FROM email_group_contacts egc
JOIN email_groups eg ON egc.email_group_id = eg.id
ORDER BY eg.name, egc.email;
```

### Backup Data

```bash
# From local terminal
pg_dump "postgresql://user:password@hostname-external:5432/yona_email_config" \
  > backup_$(date +%Y%m%d).sql
```

### Restore Data

```bash
psql "postgresql://user:password@hostname-external:5432/yona_email_config" \
  < backup_20260124.sql
```

## Next Steps

After successful setup:

1. ✅ Create email groups for your reports
2. ✅ Add email addresses to groups
3. ✅ Create report schedules
4. ⏭️ Implement email delivery service (future phase)
5. ⏭️ Set up scheduled job runner (future phase)

## Cost Information

### Free Plan
- **Cost**: $0/month
- **Storage**: 1 GB
- **Bandwidth**: 100 GB/month
- **Connection Limit**: 97 connections
- **Good for**: Development, testing, small projects

### Starter Plan
- **Cost**: $7/month
- **Storage**: 10 GB
- **Bandwidth**: 1000 GB/month
- **Backups**: Daily automatic backups
- **Connection Limit**: 197 connections
- **Good for**: Production, multiple users

### When to Upgrade

Upgrade to Starter when:
- Moving to production
- Need automatic backups
- Need more storage (>1GB)
- Need higher connection limits
- Want better performance

## Support

- **Render Docs**: https://render.com/docs/databases
- **PostgreSQL Docs**: https://www.postgresql.org/docs/
- **Project Docs**: See `docs/EMAIL_CONFIG_SETUP.md`

