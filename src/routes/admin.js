// src/routes/admin.js
const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const { getPortalTier, setPortalTier, getAllPortals, TIERS } = require('../services/tierService');
const { createNotification, getAllNotifications, runAutomatedChecks } = require('../services/notificationService');
const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) return next();
  if (req.accepts('html')) return res.redirect('/admin/auth/login');
  res.status(401).json({ error: 'Not authenticated' });
}

// ── GET /admin/api/portals ────────────────────────────────────────────────────
router.get('/portals', requireAdmin, async (req, res) => {
  const p = getPool();
  try {
    await p.query(`
      INSERT INTO portal_tiers (portal_id, tier, created_at)
      SELECT DISTINCT t.portal_id, 'trial', NOW()
      FROM tokens t
      WHERE t.portal_id NOT IN (SELECT portal_id FROM portal_tiers)
      ON CONFLICT (portal_id) DO NOTHING
    `).catch(() => {});

    const portals = await getAllPortals();

    const enriched = await Promise.all(portals.map(async (portal) => {
      let syncRuleCount = 0;
      let totalMappings = 0;
      let userCount = 0;

      try {
        const r = await p.query('SELECT rules FROM sync_rules WHERE portal_id = $1', [String(portal.portal_id)]);
        if (r.rows.length > 0) {
          const rules = r.rows[0].rules || [];
          syncRuleCount = rules.length;
          totalMappings = rules.reduce((sum, r) => sum + (r.mappings?.length || 0), 0);
        }
      } catch (e) {}

      try {
        const r = await p.query(
          'SELECT COUNT(*) as count FROM portal_users WHERE portal_id = $1 AND is_active = true',
          [String(portal.portal_id)]
        );
        userCount = parseInt(r.rows[0]?.count || 0);
      } catch (e) {}

      return { ...portal, sync_rule_count: syncRuleCount, total_mappings: totalMappings, user_count: userCount };
    }));

    res.json({ portals: enriched });
  } catch (err) {
    console.error('[Admin] Error getting portals:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/api/portals/:portalId/users ────────────────────────────────────
router.get('/portals/:portalId/users', requireAdmin, async (req, res) => {
  const p = getPool();
  const { portalId } = req.params;
  try {
    const result = await p.query(`
      SELECT
        u.id,
        u.email,
        u.full_name,
        u.last_login,
        u.email_verified,
        u.is_active,
        u.created_at  AS registered_at,
        pu.role,
        pu.invited_at,
        pu.is_active  AS portal_active
      FROM portal_users pu
      JOIN users u ON u.id = pu.user_id
      WHERE pu.portal_id = $1
      ORDER BY
        CASE pu.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END,
        u.full_name ASC
    `, [String(portalId)]);

    res.json({ users: result.rows, portalId });
  } catch (err) {
    console.error('[Admin] Error getting portal users:', err.message);
    res.json({ users: [], portalId, note: err.message });
  }
});

// ── POST /admin/api/users/:userId/send-reset ──────────────────────────────────
// Generates a password reset token and returns the reset URL.
// Also attempts to send via email if SMTP is configured.
router.post('/users/:userId/send-reset', requireAdmin, async (req, res) => {
  const p = getPool();
  const { userId } = req.params;

  try {
    // Get user details
    const userResult = await p.query(
      'SELECT id, email, full_name FROM users WHERE id = $1',
      [parseInt(userId)]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Generate reset token (1 hour expiry)
    const resetToken  = crypto.randomBytes(32).toString('hex');
    const expiresAt   = new Date(Date.now() + 60 * 60 * 1000);

    // Store token in password_reset_tokens table
    await p.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, resetToken, expiresAt]
    );

    const appUrl   = process.env.APP_URL || process.env.APP_BASE_URL || 'https://portal.syncstation.app';
    const resetUrl = `${appUrl}/reset-password?token=${resetToken}`;

    // Attempt to send email if email service is available
    let emailSent = false;
    try {
      const emailService = require('../services/emailService_auth');
      await emailService.sendPasswordResetEmail(user.email, user.full_name, resetToken);
      emailSent = true;
      console.log(`[Admin] Password reset email sent to ${user.email}`);
    } catch (emailErr) {
      // Email not configured — that's okay, we return the URL instead
      console.log('[Admin] Email not sent (SMTP not configured):', emailErr.message);
    }

    res.json({
      success: true,
      userId: user.id,
      email: user.email,
      name: user.full_name,
      resetUrl,
      emailSent,
      expiresAt
    });

  } catch (err) {
    console.error('[Admin] Send reset error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/api/portals/:portalId/tier ────────────────────────────────────
router.post('/portals/:portalId/tier', requireAdmin, async (req, res) => {
  try {
    const { portalId } = req.params;
    const { tier }     = req.body;

    if (!TIERS[tier.toUpperCase()]) {
      return res.status(400).json({ error: 'Invalid tier' });
    }

    const result = await setPortalTier(portalId, tier.toLowerCase());
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[Admin] Error setting tier:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/api/notify ────────────────────────────────────────────────────
router.post('/notify', requireAdmin, async (req, res) => {
  try {
    const { portalId, all, type, title, message, actionLabel, actionUrl } = req.body;

    if (!title || !message) return res.status(400).json({ error: 'Missing title or message' });

    if (all) {
      const portals = await getAllPortals();
      let sent = 0;
      for (const portal of portals) {
        await createNotification(portal.portal_id, { type, title, message, actionLabel, actionUrl });
        sent++;
      }
      return res.json({ sent });
    }

    if (!portalId) return res.status(400).json({ error: 'Missing portalId' });

    await createNotification(portalId, { type, title, message, actionLabel, actionUrl });
    res.json({ sent: 1 });
  } catch (err) {
    console.error('[Admin] Error sending notification:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/api/notifications ─────────────────────────────────────────────
router.get('/notifications', requireAdmin, async (req, res) => {
  try {
    const notifications = await getAllNotifications();
    res.json({ notifications });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/api/run-checks ────────────────────────────────────────────────
router.post('/run-checks', requireAdmin, async (req, res) => {
  try {
    await runAutomatedChecks();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
