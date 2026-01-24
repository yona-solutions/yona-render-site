# Get Database Connection String

Your database `yona-email-config-db` has been successfully created on Render! 🎉

However, Render doesn't expose connection strings via the API for security reasons.  
You need to get it from the Render Dashboard.

## Quick Steps

### 1. Go to Render Dashboard

Visit: **https://dashboard.render.com/d/dpg-d5q7mcur433s73fsesr0-a**

(This is your database's direct link)

### 2. Copy Connection Strings

On the database page, scroll down to **"Connections"** section.

You'll see two connection strings:

####  Internal Connection String
```
postgresql://yona_user:****@dpg-d5q7mcur433s73fsesr0-a/yona_email_config
```
☝️ **Use this for your Render web service**

#### External Connection String
```
postgresql://yona_user:****@dpg-d5q7mcur433s73fsesr0-a.oregon-postgres.render.com/yona_email_config
```
☝️ **Use this for local development**

### 3. Update Local .env

```bash
cd yona_render_site

# Edit .env file - replace the "undefined" value
nano .env
```

Replace:
```
DATABASE_URL=undefined
```

With (use **External** connection string):
```
DATABASE_URL=postgresql://yona_user:****@dpg-d5q7mcur433s73fsesr0-a.oregon-postgres.render.com/yona_email_config
```

### 4. Add to Render Web Service

1. Go to your **yona-render-site** web service
2. Click **"Environment"** tab
3. Click **"Add Environment Variable"**
4. Add:
   - **Key**: `DATABASE_URL`
   - **Value**: (paste **Internal** connection string)
5. Click **"Save Changes"**

Your service will automatically redeploy (2-3 minutes).

### 5. Run Migration

From your project root:

```bash
# Export the external connection string
export DATABASE_URL="postgresql://yona_user:****@..."

# Run migration
psql $DATABASE_URL < docs/migrations/001_initial_schema.sql
```

Or use Render Shell:
1. Go to database on Render dashboard
2. Click **"Shell"** tab  
3. Copy/paste contents of `docs/migrations/001_initial_schema.sql`
4. Press Enter

### 6. Test

```bash
# Start local server
npm start

# Visit: http://localhost:3000/email-config
# Try creating an email group!
```

## Database Info

- **Name**: yona-email-config-db
- **ID**: dpg-d5q7mcur433s73fsesr0-a
- **Region**: Oregon
- **Status**: Available ✅
- **Plan**: Free
- **Expires**: 2026-02-23 (30 days - extends automatically with use)

## Next Steps

1. ✅ Database created
2. ⏭️ Get connection string from dashboard (above)
3. ⏭️ Update .env file
4. ⏭️ Add DATABASE_URL to Render web service
5. ⏭️ Run migration
6. ⏭️ Test locally and in production

## Need Help?

- **Dashboard Link**: https://dashboard.render.com/d/dpg-d5q7mcur433s73fsesr0-a
- **Render Docs**: https://render.com/docs/databases
- **Manual Setup Guide**: See `docs/MANUAL_DATABASE_SETUP.md`

## Troubleshooting

**Can't find connection strings?**
- Go to database dashboard
- Scroll to "Connections" section
- Click "External Connection String" to reveal
- Click "Internal Connection String" to reveal

**Migration fails?**
- Check connection string is correct
- Ensure database status is "Available"
- Try using Render Shell instead of local psql

**Local server can't connect?**
- Use **External** connection string for local
- Use **Internal** connection string for Render services
- Check for typos in DATABASE_URL

