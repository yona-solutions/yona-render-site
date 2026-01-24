# Email Configuration System Setup Guide

## Overview
This guide walks through setting up the email configuration system for automated P&L report delivery. The system uses PostgreSQL on Render for data storage.

## Architecture

### Database Tables
1. **email_groups** - Distribution lists for reports
2. **email_group_contacts** - Individual emails within groups
3. **report_schedules** - Automated report configurations

### Components
- **Frontend**: `public/email-config.html` - UI for managing configurations
- **Backend**: API endpoints for CRUD operations
- **Database**: PostgreSQL on Render
- **Future**: Email delivery service (SendGrid/AWS SES)

## Step 1: Create PostgreSQL Database on Render

### 1.1 Create Database Instance

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **"New +"** → **"PostgreSQL"**
3. Configure:
   - **Name**: `yona-email-config-db`
   - **Database**: `yona_email_config`
   - **User**: (auto-generated)
   - **Region**: Choose same region as your web service (for lower latency)
   - **PostgreSQL Version**: 15 or later
   - **Plan**: Free tier (or Starter for production)

4. Click **"Create Database"**

### 1.2 Get Connection Details

After creation, Render provides:
- **Internal Database URL**: `postgresql://user:password@hostname:5432/yona_email_config`
- **External Database URL**: For connections outside Render
- **PSQL Command**: For direct database access

**Save these credentials** - you'll need them for:
- Environment variables
- Database migrations
- Direct access

### 1.3 Connect to Database

Using Render's Web Shell:
```bash
# From Render dashboard, go to your database → "Shell" tab
# You're automatically connected - just run SQL commands
```

Or from your local machine:
```bash
# Use the PSQL Command from Render dashboard
psql postgresql://user:password@hostname:5432/yona_email_config
```

## Step 2: Database Schema

### 2.1 Create Tables

Run this SQL to create the schema:

```sql
-- Email Groups Table
CREATE TABLE email_groups (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Email Group Contacts Table
CREATE TABLE email_group_contacts (
  id SERIAL PRIMARY KEY,
  email_group_id INTEGER NOT NULL REFERENCES email_groups(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(email_group_id, email)
);

-- Report Schedules Table
CREATE TABLE report_schedules (
  id SERIAL PRIMARY KEY,
  report_type VARCHAR(50) NOT NULL, -- 'standard' or 'operational'
  hierarchy VARCHAR(50) NOT NULL, -- 'district', 'region', 'subsidiary'
  entity_id VARCHAR(255) NOT NULL, -- ID from customer/region/etc config
  entity_name VARCHAR(255), -- Cached name for display
  email_group_id INTEGER NOT NULL REFERENCES email_groups(id),
  frequency VARCHAR(50) NOT NULL, -- 'daily', 'weekly', 'monthly'
  status VARCHAR(50) DEFAULT 'active', -- 'active' or 'paused'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_sent_at TIMESTAMP,
  next_send_at TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_email_group_contacts_group_id ON email_group_contacts(email_group_id);
CREATE INDEX idx_report_schedules_group_id ON report_schedules(email_group_id);
CREATE INDEX idx_report_schedules_status ON report_schedules(status);
CREATE INDEX idx_report_schedules_next_send ON report_schedules(next_send_at);

-- Updated at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tables
CREATE TRIGGER update_email_groups_updated_at
  BEFORE UPDATE ON email_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_report_schedules_updated_at
  BEFORE UPDATE ON report_schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### 2.2 Verify Schema

```sql
-- List all tables
\dt

-- Describe tables
\d email_groups
\d email_group_contacts
\d report_schedules

-- Check indexes
\di
```

## Step 3: Environment Variables

### 3.1 Local Development

Add to `.env`:
```bash
# PostgreSQL Connection
DATABASE_URL=postgresql://user:password@hostname:5432/yona_email_config

# OR individual components:
DB_HOST=hostname.render.com
DB_PORT=5432
DB_NAME=yona_email_config
DB_USER=your_username
DB_PASSWORD=your_password
```

### 3.2 Render Production

1. Go to your web service on Render
2. Navigate to **"Environment"** tab
3. Add environment variable:
   - **Key**: `DATABASE_URL`
   - **Value**: (paste Internal Database URL from your database)
4. Click **"Save Changes"**

Render will automatically redeploy your service.

## Step 4: Install Dependencies

### 4.1 Add PostgreSQL Client

```bash
cd yona_render_site
npm install pg
```

This installs the PostgreSQL client for Node.js.

### 4.2 Update package.json

The `package.json` should include:
```json
{
  "dependencies": {
    "pg": "^8.11.0",
    "@google-cloud/storage": "^7.7.0",
    "@google-cloud/bigquery": "^7.3.0",
    "express": "^4.18.2",
    "dotenv": "^16.3.1"
  }
}
```

## Step 5: Database Service Implementation

See `src/services/emailConfigService.js` for the complete implementation.

Key features:
- Connection pooling for performance
- Parameterized queries to prevent SQL injection
- Transaction support for data integrity
- Proper error handling
- Automatic connection cleanup

## Step 6: API Endpoints

The following endpoints are implemented in `src/routes/emailConfigApi.js`:

### Email Groups
- `GET /api/email-groups` - List all groups
- `POST /api/email-groups` - Create new group
- `GET /api/email-groups/:id` - Get group details
- `PUT /api/email-groups/:id` - Update group
- `DELETE /api/email-groups/:id` - Delete group
- `GET /api/email-groups/:id/contacts` - Get contacts in group

### Report Schedules
- `GET /api/report-schedules` - List all schedules
- `POST /api/report-schedules` - Create new schedule
- `GET /api/report-schedules/:id` - Get schedule details
- `PUT /api/report-schedules/:id` - Update schedule
- `DELETE /api/report-schedules/:id` - Delete schedule

## Step 7: Testing

### 7.1 Test Database Connection

```javascript
// Test script: test-db.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function testConnection() {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Database connected:', result.rows[0].now);
    
    const tables = await pool.query(`
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'public'
    `);
    console.log('📊 Tables:', tables.rows.map(r => r.tablename));
    
    await pool.end();
  } catch (error) {
    console.error('❌ Database error:', error);
  }
}

testConnection();
```

Run: `node test-db.js`

### 7.2 Test API Endpoints

Using curl or Postman:

```bash
# Create email group
curl -X POST http://localhost:3000/api/email-groups \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Group",
    "description": "Test distribution list",
    "emails": ["test1@example.com", "test2@example.com"]
  }'

# List email groups
curl http://localhost:3000/api/email-groups

# Create report schedule
curl -X POST http://localhost:3000/api/report-schedules \
  -H "Content-Type: application/json" \
  -d '{
    "report_type": "standard",
    "hierarchy": "district",
    "entity_id": "district_1",
    "email_group_id": 1,
    "frequency": "monthly",
    "status": "active"
  }'

# List report schedules
curl http://localhost:3000/api/report-schedules
```

### 7.3 Test UI

1. Start server: `npm start`
2. Navigate to: `http://localhost:3000/email-config`
3. Test:
   - Create email group
   - Add/remove emails from group
   - Create report schedule
   - Edit and delete entries
   - Verify data persists after page refresh

## Step 8: Seed Data (Optional)

Add sample data for testing:

```sql
-- Insert sample email groups
INSERT INTO email_groups (name, description) VALUES
  ('District Managers', 'All district-level managers'),
  ('Regional Directors', 'Regional leadership team'),
  ('Finance Team', 'Accounting and finance department');

-- Insert sample contacts
INSERT INTO email_group_contacts (email_group_id, email, name) VALUES
  (1, 'manager1@yona.com', 'John Smith'),
  (1, 'manager2@yona.com', 'Jane Doe'),
  (2, 'director1@yona.com', 'Bob Johnson'),
  (3, 'finance@yona.com', 'Finance Department');

-- Insert sample schedules
INSERT INTO report_schedules (
  report_type, hierarchy, entity_id, entity_name, 
  email_group_id, frequency, status
) VALUES
  ('standard', 'district', 'west_district', 'West District', 1, 'monthly', 'active'),
  ('operational', 'region', 'northeast', 'Northeast Region', 2, 'weekly', 'active');
```

## Troubleshooting

### Connection Issues

**Error**: "Connection refused"
- **Fix**: Check DATABASE_URL is correct
- **Fix**: Ensure database is running on Render
- **Fix**: Check firewall/network settings

**Error**: "SSL error"
- **Fix**: Add SSL configuration in production:
  ```javascript
  ssl: { rejectUnauthorized: false }
  ```

### Permission Issues

**Error**: "Permission denied for table"
- **Fix**: Ensure database user has correct permissions:
  ```sql
  GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO your_username;
  GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO your_username;
  ```

### Migration Issues

**Error**: "Table already exists"
- **Fix**: Drop tables and recreate, or use migrations tool
  ```sql
  DROP TABLE IF EXISTS report_schedules CASCADE;
  DROP TABLE IF EXISTS email_group_contacts CASCADE;
  DROP TABLE IF EXISTS email_groups CASCADE;
  ```

## Security Considerations

1. **Never commit `.env`** - Add to `.gitignore`
2. **Use environment variables** - Never hardcode credentials
3. **Parameterized queries** - Prevent SQL injection
4. **Connection pooling** - Limit concurrent connections
5. **SSL in production** - Encrypt database traffic
6. **Validate inputs** - Both frontend and backend
7. **Rate limiting** - Prevent abuse of API endpoints

## Next Steps

1. **Email Delivery Service**: Integrate SendGrid/AWS SES
2. **Scheduler**: Implement cron job to send reports
3. **Email Templates**: Design HTML email templates
4. **Audit Logging**: Track who created/modified schedules
5. **User Authentication**: Secure the configuration page
6. **Email Verification**: Validate email addresses before adding
7. **Backup Strategy**: Automated database backups

## Resources

- [Render PostgreSQL Docs](https://render.com/docs/databases)
- [Node.js pg Library](https://node-postgres.com/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [SendGrid API](https://sendgrid.com/docs/API_Reference/index.html)

## Support

For issues or questions:
1. Check Render database logs
2. Check application logs: `console.log` statements
3. Review this documentation
4. Contact development team

