/**
 * Firebase Authentication Middleware
 *
 * Verifies Firebase ID tokens and checks user roles from PostgreSQL.
 * Supports API key bypass for server-to-server communication.
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin SDK with service account credentials
if (!admin.apps.length) {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'yona-solutions-poc';

  // Try to use service account key from environment
  if (process.env.GCP_SERVICE_ACCOUNT_KEY) {
    try {
      const serviceAccount = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: projectId
      });
      console.log('✅ Firebase Admin initialized with service account credentials');
    } catch (error) {
      console.error('❌ Failed to parse GCP_SERVICE_ACCOUNT_KEY for Firebase:', error.message);
      // Fallback to default credentials
      admin.initializeApp({ projectId });
    }
  } else {
    // Fallback to application default credentials
    admin.initializeApp({ projectId });
  }
}

// In-memory role cache: email -> { role, timestamp }
const roleCache = new Map();
const ROLE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Viewer-allowed API patterns
const VIEWER_ALLOWED_PATTERNS = [
  /^\/api\/pl\//,
  /^\/api\/storage\/districts$/,
  /^\/api\/storage\/regions$/,
  /^\/api\/storage\/departments$/,
  /^\/api\/config\/account$/,
  /^\/api\/health$/,
  /^\/api\/info$/,
  /^\/api\/me$/,
];

/**
 * Look up user role from PostgreSQL user_roles table.
 * Returns cached result if available and fresh.
 */
async function getUserRole(email, pool) {
  // Check cache
  const cached = roleCache.get(email);
  if (cached && (Date.now() - cached.timestamp) < ROLE_CACHE_TTL) {
    return cached.role;
  }

  const result = await pool.query(
    'SELECT role FROM user_roles WHERE email = $1',
    [email]
  );

  if (result.rows.length === 0) {
    return null; // User not in table
  }

  const role = result.rows[0].role;
  roleCache.set(email, { role, timestamp: Date.now() });
  return role;
}

/**
 * Initialize the user_roles table (auto-migrate on startup)
 */
async function initializeUserRolesTable(pool) {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_roles (
        email TEXT PRIMARY KEY,
        role TEXT NOT NULL DEFAULT 'viewer',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Ensure the initial admin exists
    await pool.query(`
      INSERT INTO user_roles (email, role)
      VALUES ('elan@flowsensesolutions.com', 'admin')
      ON CONFLICT (email) DO NOTHING
    `);

    console.log('✅ user_roles table initialized');
  } catch (error) {
    console.error('❌ Failed to initialize user_roles table:', error.message);
  }
}

/**
 * Express middleware: require authentication on API routes.
 *
 * - API key bypass: X-API-Key header matching SCHEDULER_API_KEY skips auth
 * - Firebase token: Authorization: Bearer <token> verified via firebase-admin
 * - Role check: viewers restricted to VIEWER_ALLOWED_PATTERNS
 *
 * @param {object} pool - PostgreSQL connection pool
 */
function createRequireAuth(pool) {
  return async function requireAuth(req, res, next) {
    // Skip auth for health check
    if (req.originalUrl === '/api/health') {
      return next();
    }

    // API key bypass for server-to-server (e.g., Cloud Functions -> /api/report-schedules/:id/process)
    const apiKey = req.headers['x-api-key'];
    const expectedKey = process.env.SCHEDULER_API_KEY;
    if (apiKey && expectedKey && apiKey === expectedKey) {
      return next();
    }

    // Firebase token verification
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.substring(7);

    try {
      const decoded = await admin.auth().verifyIdToken(token);
      const email = decoded.email;

      if (!email) {
        return res.status(401).json({ error: 'No email in token' });
      }

      // Look up role
      const role = await getUserRole(email, pool);

      if (!role) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Viewer role check
      if (role === 'viewer') {
        const allowed = VIEWER_ALLOWED_PATTERNS.some(pattern => pattern.test(req.originalUrl));
        if (!allowed) {
          return res.status(403).json({ error: 'Insufficient permissions' });
        }
      }

      req.user = { email, role };
      next();
    } catch (error) {
      console.error('Auth error:', error.message);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

module.exports = { createRequireAuth, initializeUserRolesTable };
