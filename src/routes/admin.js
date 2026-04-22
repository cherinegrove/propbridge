// src/routes/admin.js
const express    = require('express');
const router     = express.Router();
const path       = require('path');
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
  if (req.session && req.session.adminId) {
    return next();
  }
  if (req.accepts('html')) {
    return res.redirect('/admin/auth/login');
  }
  res.status(401).json({ error: 'Not authenticated' });
}

// GET /admin/api/portals - enriched with sync rules + user counts
router.get('/portals', requireAdmin, async (req, res) => {
  const p = getPool();
  
  try {
    // Auto-populate portals from tokens table
    await p.query(`
      INSERT INTO portal_tiers (portal_id, tier, created_at)
      SELECT DISTINCT t.portal_id, 'trial', NOW()
      FROM tokens t
      WHERE t.portal_id NOT IN (SELECT portal_id FROM portal_tiers)
      ON CONFLICT (portal_id) DO NOTHING
    `).catch(() => {}); // Ignore if tokens table doesn't exist

    // Get base portals
    const portals = await getAllPortals();

    // Enrich each portal with sync rule count and user count
    const enriched = await Promise.all(portals.map(async (portal) => {
      let syncRuleCount = 0;
      let totalMappings = 0;
      let userCount = 0;

      try {
        // Get sync rules
        const rulesResult = await p.query(
          'SELECT rules FROM sync_rules WHERE portal_id = $1',
          [String(portal.portal_id)]
        );
        if (rulesResult.rows.length > 0) {
          const rules = rulesResult.rows[0].rules || [];
          syncRuleCount = rules.length;
          totalMappings = rules.reduce((sum, r) => sum + (r.mappings?.length || 0), 0);
        }
      } catch (e) {}

      try {
        // Get user count from portal_users table
        const usersResult = await p.query(
          'SELECT COUNT(*) as count FROM portal_users WHERE portal_id = $1 AND is_active = true',
          [String(portal.portal_id)]
        );
        userCount = parseInt(usersResult.rows[0]?.count || 0);
      } catch (e) {}

      return {
        ...portal,
        sync_rule_count: syncRuleCount,
        total_mappings: totalMappings,
        user_count: userCount
      };
    }));

    res.json({ portals: enriched });
  } catch (err) {
    console.error('[Admin] Error getting portals:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/api/portals/:portalId/tier
router.post('/portals/:portalId/tier', requireAdmin, async (req, res) => {
  try {
    const { portalId } = req.params;
    const { tier } = req.body;
    
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

// POST /admin/api/notify
router.post('/notify', requireAdmin, async (req, res) => {
  try {
    const { portalId, all, type, title, message, actionLabel, actionUrl } = req.body;
    
    if (!title || !message) {
      return res.status(400).json({ error: 'Missing title or message' });
    }
    
    if (all) {
      const portals = await getAllPortals();
      let sent = 0;
      for (const portal of portals) {
        await createNotification(portal.portal_id, { type, title, message, actionLabel, actionUrl });
        sent++;
      }
      return res.json({ sent });
    }
    
    if (!portalId) {
      return res.status(400).json({ error: 'Missing portalId' });
    }
    
    await createNotification(portalId, { type, title, message, actionLabel, actionUrl });
    res.json({ sent: 1 });
  } catch (err) {
    console.error('[Admin] Error sending notification:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/api/notifications
router.get('/notifications', requireAdmin, async (req, res) => {
  try {
    const notifications = await getAllNotifications();
    res.json({ notifications });
  } catch (err) {
    console.error('[Admin] Error getting notifications:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/api/run-checks
router.post('/run-checks', requireAdmin, async (req, res) => {
  try {
    await runAutomatedChecks();
    res.json({ ok: true });
  } catch (err) {
    console.error('[Admin] Error running checks:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
