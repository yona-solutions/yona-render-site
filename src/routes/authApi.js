/**
 * Auth API Routes
 *
 * Handles user account creation and password reset flows.
 * These routes are PUBLIC (no authentication required).
 */

const express = require('express');
const admin = require('firebase-admin');
const { GoogleAuth } = require('google-auth-library');
const emailService = require('../services/emailService');
const emailConfigService = require('../services/emailConfigService');

const router = express.Router();

// Allowed email domains for account creation
const ALLOWED_DOMAINS = [
  'flowsensesolutions.com',
  'yonasolutions.com',
  'qualitativ.ai',
  'gmail.com'
];

// Emails that should get admin role on account creation
const ADMIN_EMAILS = [
  'hnayyar@yonasolutions.com',
  'jgriffith@yonasolutions.com',
  'alagioia@yonasolutions.com',
  'aaron@qualitativ.ai',
  'daniel@flowsensesolutions.com',
  'elan@flowsensesolutions.com'
];

/**
 * Check if email domain is allowed
 */
function isAllowedDomain(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  return ALLOWED_DOMAINS.includes(domain);
}

/**
 * POST /api/auth/request-access
 *
 * Creates a new user account with email/password authentication.
 * Only allows emails from approved domains.
 * Sends the generated password via email.
 */
router.post('/request-access', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.trim()) {
      return res.status(400).json({
        error: 'Email required',
        message: 'Please provide an email address'
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({
        error: 'Invalid email',
        message: 'Please provide a valid email address'
      });
    }

    // Check domain
    if (!isAllowedDomain(normalizedEmail)) {
      return res.status(403).json({
        error: 'Domain not allowed',
        message: 'Only @flowsensesolutions.com, @yonasolutions.com, @qualitativ.ai, and @gmail.com emails can create accounts'
      });
    }

    // Check if user already exists
    try {
      const existingUser = await admin.auth().getUserByEmail(normalizedEmail);
      if (existingUser) {
        return res.status(409).json({
          error: 'Account exists',
          message: 'An account with this email already exists. Please use "Forgot Password" to reset your password.'
        });
      }
    } catch (error) {
      // User doesn't exist - this is expected, continue
      if (error.code !== 'auth/user-not-found') {
        throw error;
      }
    }

    // Create Firebase user without a password — they'll set one via the reset link
    const userRecord = await admin.auth().createUser({
      email: normalizedEmail,
      emailVerified: true
    });

    console.log(`✅ Created Firebase user: ${normalizedEmail} (${userRecord.uid})`);

    // Add user to user_roles table (admin for designated emails, viewer otherwise)
    if (emailConfigService.isAvailable()) {
      const role = ADMIN_EMAILS.includes(normalizedEmail) ? 'admin' : 'viewer';
      await emailConfigService.pool.query(
        `INSERT INTO user_roles (email, role) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`,
        [normalizedEmail, role]
      );
      console.log(`✅ Added ${normalizedEmail} to user_roles table with role: ${role}`);
    }

    // Send password setup email via Firebase's own email system
    const serviceAccount = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY);
    const auth = new GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();

    const oobResponse = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token.token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requestType: 'PASSWORD_RESET',
        email: normalizedEmail
      })
    });

    const oobData = await oobResponse.json();
    if (oobData.error) {
      throw new Error(oobData.error.message);
    }

    console.log(`✅ Sent Firebase password setup email to: ${normalizedEmail}`);

    res.json({
      success: true,
      message: 'Account created. Check your email for a link to set your password.'
    });

  } catch (error) {
    console.error('Error creating user:', error);

    // Handle specific Firebase errors
    if (error.code === 'auth/email-already-exists') {
      return res.status(409).json({
        error: 'Account exists',
        message: 'An account with this email already exists'
      });
    }

    res.status(500).json({
      error: 'Failed to create account',
      message: error.message
    });
  }
});

/**
 * POST /api/auth/forgot-password
 *
 * Sends a Firebase password reset link via Firebase's own email system.
 * Only works for existing users from allowed domains.
 */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.trim()) {
      return res.status(400).json({
        error: 'Email required',
        message: 'Please provide an email address'
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check domain
    if (!isAllowedDomain(normalizedEmail)) {
      return res.status(403).json({
        error: 'Domain not allowed',
        message: 'Only @flowsensesolutions.com, @yonasolutions.com, @qualitativ.ai, and @gmail.com emails are supported'
      });
    }

    // Check if user exists (don't reveal result for security)
    try {
      await admin.auth().getUserByEmail(normalizedEmail);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        return res.json({
          success: true,
          message: 'If an account exists with this email, a password reset link will be sent.'
        });
      }
      throw error;
    }

    // Send password reset email via Firebase's own email system
    const serviceAccount = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY);
    const auth = new GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();

    const response = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token.token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requestType: 'PASSWORD_RESET',
        email: normalizedEmail
      })
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message);
    }

    console.log(`✅ Sent Firebase password reset email to: ${normalizedEmail}`);

    res.json({
      success: true,
      message: 'If an account exists with this email, a password reset link will be sent.'
    });

  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({
      error: 'Failed to reset password',
      message: error.message
    });
  }
});

module.exports = router;
