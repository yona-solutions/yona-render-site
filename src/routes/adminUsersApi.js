/**
 * Admin User Management API Routes
 *
 * Allows admin users to manage Firebase-authenticated accounts and their
 * corresponding app roles in PostgreSQL.
 */

const express = require('express');
const admin = require('firebase-admin');
const { GoogleAuth } = require('google-auth-library');
const { invalidateRoleCache } = require('../middleware/auth');

const ALLOWED_ROLES = new Set(['admin', 'viewer']);
const ALLOWED_DOMAINS = new Set([
  'flowsensesolutions.com',
  'yonasolutions.com',
  'qualitativ.ai',
  'gmail.com'
]);
const PROTECTED_EMAILS = new Set([
  'elan@flowsensesolutions.com'
]);

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isAllowedDomain(email) {
  const domain = normalizeEmail(email).split('@')[1];
  return ALLOWED_DOMAINS.has(domain);
}

function isProtectedEmail(email) {
  return PROTECTED_EMAILS.has(normalizeEmail(email));
}

function validatePassword(password) {
  const normalizedPassword = String(password || '');
  if (normalizedPassword.length < 6) {
    return 'Password must be at least 6 characters long';
  }

  return null;
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Admin access is required for user management'
    });
  }

  next();
}

function ensureDatabase(pool) {
  return (req, res, next) => {
    if (!pool) {
      return res.status(503).json({
        error: 'Service unavailable',
        message: 'User management is unavailable because the database is not configured'
      });
    }

    next();
  };
}

async function getRoleMap(pool) {
  const result = await pool.query('SELECT email, role FROM user_roles');
  return new Map(
    result.rows.map(row => [normalizeEmail(row.email), row.role])
  );
}

function serializeUser(userRecord, roleMap) {
  const email = normalizeEmail(userRecord.email);

  return {
    uid: userRecord.uid,
    email: userRecord.email || null,
    displayName: userRecord.displayName || null,
    role: email ? (roleMap.get(email) || null) : null,
    disabled: Boolean(userRecord.disabled),
    emailVerified: Boolean(userRecord.emailVerified),
    protected: isProtectedEmail(email),
    providerIds: Array.isArray(userRecord.providerData)
      ? userRecord.providerData.map(provider => provider.providerId).filter(Boolean)
      : [],
    createdAt: userRecord.metadata?.creationTime || null,
    lastSignInAt: userRecord.metadata?.lastSignInTime || null
  };
}

async function listAllUsers() {
  const users = [];
  let nextPageToken;

  do {
    const response = await admin.auth().listUsers(1000, nextPageToken);
    users.push(...response.users);
    nextPageToken = response.pageToken;
  } while (nextPageToken);

  return users;
}

async function getAccessToken() {
  let credentials;

  if (process.env.GCP_SERVICE_ACCOUNT_KEY) {
    credentials = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY);
  }

  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });

  const client = await auth.getClient();
  const tokenResult = await client.getAccessToken();
  const accessToken = typeof tokenResult === 'string' ? tokenResult : tokenResult?.token;

  if (!accessToken) {
    throw new Error('Unable to acquire Google access token for Firebase email actions');
  }

  return accessToken;
}

async function sendPasswordResetEmail(email) {
  const accessToken = await getAccessToken();

  const response = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requestType: 'PASSWORD_RESET',
      email: normalizeEmail(email)
    })
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data?.error?.message || 'Failed to send Firebase password reset email');
  }
}

async function getUserByUid(uid) {
  try {
    return await admin.auth().getUser(uid);
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      return null;
    }

    throw error;
  }
}

async function getMutableUser(uid, res) {
  const userRecord = await getUserByUid(uid);

  if (!userRecord) {
    res.status(404).json({
      error: 'Not found',
      message: 'User not found in Firebase Authentication'
    });
    return null;
  }

  if (isProtectedEmail(userRecord.email)) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'This account is locked and cannot be managed from SPHERE'
    });
    return null;
  }

  return userRecord;
}

function createAdminUserRoutes(pool) {
  const router = express.Router();

  router.use(requireAdmin);
  router.use(ensureDatabase(pool));

  router.get('/users', async (req, res) => {
    try {
      const [userRecords, roleMap] = await Promise.all([
        listAllUsers(),
        getRoleMap(pool)
      ]);

      const users = userRecords
        .map(userRecord => serializeUser(userRecord, roleMap))
        .sort((a, b) => {
          if (a.protected !== b.protected) {
            return a.protected ? -1 : 1;
          }

          if ((a.role === 'admin') !== (b.role === 'admin')) {
            return a.role === 'admin' ? -1 : 1;
          }

          return (a.email || '').localeCompare(b.email || '');
        });

      res.json({
        users,
        protectedEmails: [...PROTECTED_EMAILS]
      });
    } catch (error) {
      console.error('Failed to list admin users:', error);
      res.status(500).json({
        error: 'Failed to load users',
        message: error.message
      });
    }
  });

  router.post('/users', async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const role = normalizeEmail(req.body?.role || 'viewer');

      if (!email) {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'Email is required'
        });
      }

      if (!ALLOWED_ROLES.has(role)) {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'Role must be either "admin" or "viewer"'
        });
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'Please provide a valid email address'
        });
      }

      if (!isAllowedDomain(email)) {
        return res.status(403).json({
          error: 'Domain not allowed',
          message: 'Only approved company domains can be granted access'
        });
      }

      if (isProtectedEmail(email)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'This account is locked and cannot be created or modified here'
        });
      }

      try {
        const existingUser = await admin.auth().getUserByEmail(email);
        if (existingUser) {
          return res.status(409).json({
            error: 'Conflict',
            message: 'A Firebase user with this email already exists'
          });
        }
      } catch (error) {
        if (error.code !== 'auth/user-not-found') {
          throw error;
        }
      }

      const userRecord = await admin.auth().createUser({
        email,
        emailVerified: true,
        disabled: false
      });

      await pool.query(
        `INSERT INTO user_roles (email, role)
         VALUES ($1, $2)
         ON CONFLICT (email)
         DO UPDATE SET role = EXCLUDED.role`,
        [email, role]
      );

      invalidateRoleCache(email);
      await sendPasswordResetEmail(email);

      const roleMap = new Map([[email, role]]);
      res.status(201).json({
        success: true,
        message: 'User created and invite email sent',
        user: serializeUser(userRecord, roleMap)
      });
    } catch (error) {
      console.error('Failed to create admin-managed user:', error);
      res.status(500).json({
        error: 'Failed to create user',
        message: error.message
      });
    }
  });

  router.patch('/users/:uid', async (req, res) => {
    try {
      const userRecord = await getMutableUser(req.params.uid, res);
      if (!userRecord) {
        return;
      }

      const updates = {};
      let nextRole = null;

      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'disabled')) {
        if (typeof req.body.disabled !== 'boolean') {
          return res.status(400).json({
            error: 'Invalid request',
            message: 'disabled must be a boolean value'
          });
        }

        updates.disabled = req.body.disabled;
      }

      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'role')) {
        nextRole = normalizeEmail(req.body.role);
        if (!ALLOWED_ROLES.has(nextRole)) {
          return res.status(400).json({
            error: 'Invalid request',
            message: 'Role must be either "admin" or "viewer"'
          });
        }
      }

      if (!Object.keys(updates).length && !nextRole) {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'Provide at least one supported update'
        });
      }

      let updatedUserRecord = userRecord;
      if (Object.keys(updates).length) {
        updatedUserRecord = await admin.auth().updateUser(userRecord.uid, updates);
      }

      const email = normalizeEmail(updatedUserRecord.email);
      if (nextRole) {
        await pool.query(
          `INSERT INTO user_roles (email, role)
           VALUES ($1, $2)
           ON CONFLICT (email)
           DO UPDATE SET role = EXCLUDED.role`,
          [email, nextRole]
        );
        invalidateRoleCache(email);
      }

      const roleMap = nextRole
        ? new Map([[email, nextRole]])
        : await getRoleMap(pool);

      res.json({
        success: true,
        message: 'User updated',
        user: serializeUser(updatedUserRecord, roleMap)
      });
    } catch (error) {
      console.error('Failed to update admin-managed user:', error);
      res.status(500).json({
        error: 'Failed to update user',
        message: error.message
      });
    }
  });

  router.post('/users/:uid/reset-password', async (req, res) => {
    try {
      const userRecord = await getMutableUser(req.params.uid, res);
      if (!userRecord) {
        return;
      }

      if (!userRecord.email) {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'This user does not have an email address for password reset'
        });
      }

      await sendPasswordResetEmail(userRecord.email);

      res.json({
        success: true,
        message: 'Password reset email sent'
      });
    } catch (error) {
      console.error('Failed to send password reset email:', error);
      res.status(500).json({
        error: 'Failed to send reset email',
        message: error.message
      });
    }
  });

  router.post('/users/:uid/set-password', async (req, res) => {
    try {
      const userRecord = await getMutableUser(req.params.uid, res);
      if (!userRecord) {
        return;
      }

      const password = String(req.body?.password || '');
      const passwordError = validatePassword(password);
      if (passwordError) {
        return res.status(400).json({
          error: 'Invalid request',
          message: passwordError
        });
      }

      await admin.auth().updateUser(userRecord.uid, {
        password
      });

      res.json({
        success: true,
        message: 'Password updated'
      });
    } catch (error) {
      console.error('Failed to set password:', error);
      res.status(500).json({
        error: 'Failed to set password',
        message: error.message
      });
    }
  });

  router.delete('/users/:uid', async (req, res) => {
    try {
      const userRecord = await getMutableUser(req.params.uid, res);
      if (!userRecord) {
        return;
      }

      const email = normalizeEmail(userRecord.email);

      await admin.auth().deleteUser(userRecord.uid);
      if (email) {
        await pool.query('DELETE FROM user_roles WHERE LOWER(email) = LOWER($1)', [email]);
        invalidateRoleCache(email);
      }

      res.json({
        success: true,
        message: 'User deleted'
      });
    } catch (error) {
      console.error('Failed to delete admin-managed user:', error);
      res.status(500).json({
        error: 'Failed to delete user',
        message: error.message
      });
    }
  });

  return router;
}

module.exports = createAdminUserRoutes;
