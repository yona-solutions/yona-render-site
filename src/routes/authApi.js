/**
 * Auth API Routes
 *
 * Handles user account creation and password reset flows.
 * These routes are PUBLIC (no authentication required).
 */

const express = require('express');
const admin = require('firebase-admin');
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
 * Generate a random password
 */
function generatePassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

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

    // Generate password
    const password = generatePassword();

    // Create Firebase user
    const userRecord = await admin.auth().createUser({
      email: normalizedEmail,
      password: password,
      emailVerified: true // Skip email verification since we're sending them the password
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

    // Send password email
    if (emailService.isAvailable()) {
      const subject = 'Your SPHERE Account Password';
      const text = `Hello,

Your SPHERE account has been created.

Email: ${normalizedEmail}
Password: ${password}

Please sign in at: ${process.env.APP_URL || 'https://yona-render-site.onrender.com'}/login.html

We recommend changing your password after your first login.

Best regards,
Yona Solutions`;

      const html = `
        <p>Hello,</p>
        <p>Your SPHERE account has been created.</p>
        <p><strong>Email:</strong> ${normalizedEmail}<br>
        <strong>Password:</strong> <code style="background:#f0f0f0;padding:2px 6px;border-radius:3px;">${password}</code></p>
        <p>Please sign in at: <a href="${process.env.APP_URL || 'https://yona-render-site.onrender.com'}/login.html">SPHERE Login</a></p>
        <p>We recommend changing your password after your first login.</p>
        <p>Best regards,<br>Yona Solutions</p>
      `;

      await emailService.sendEmail(normalizedEmail, subject, text, html);
    } else {
      console.warn('⚠️  Email service not available - password not sent');
      // In development, log password to console
      if (process.env.NODE_ENV !== 'production') {
        console.log(`   DEV: Password for ${normalizedEmail}: ${password}`);
      }
    }

    res.json({
      success: true,
      message: 'Account created. Check your email for your password.'
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
 * Generates a new password and sends it via email.
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

    // Check if user exists
    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(normalizedEmail);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        // Don't reveal if user exists or not for security
        return res.json({
          success: true,
          message: 'If an account exists with this email, a new password will be sent.'
        });
      }
      throw error;
    }

    // Generate new password
    const password = generatePassword();

    // Update user's password
    await admin.auth().updateUser(userRecord.uid, {
      password: password
    });

    console.log(`✅ Reset password for: ${normalizedEmail}`);

    // Send password email
    if (emailService.isAvailable()) {
      const subject = 'Your SPHERE Password Has Been Reset';
      const text = `Hello,

Your SPHERE password has been reset.

Email: ${normalizedEmail}
New Password: ${password}

Please sign in at: ${process.env.APP_URL || 'https://yona-render-site.onrender.com'}/login.html

Best regards,
Yona Solutions`;

      const html = `
        <p>Hello,</p>
        <p>Your SPHERE password has been reset.</p>
        <p><strong>Email:</strong> ${normalizedEmail}<br>
        <strong>New Password:</strong> <code style="background:#f0f0f0;padding:2px 6px;border-radius:3px;">${password}</code></p>
        <p>Please sign in at: <a href="${process.env.APP_URL || 'https://yona-render-site.onrender.com'}/login.html">SPHERE Login</a></p>
        <p>Best regards,<br>Yona Solutions</p>
      `;

      await emailService.sendEmail(normalizedEmail, subject, text, html);
    } else {
      console.warn('⚠️  Email service not available - password not sent');
      if (process.env.NODE_ENV !== 'production') {
        console.log(`   DEV: New password for ${normalizedEmail}: ${password}`);
      }
    }

    res.json({
      success: true,
      message: 'If an account exists with this email, a new password will be sent.'
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
