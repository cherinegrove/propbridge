// src/routes/admin.js
const express    = require('express');
const router     = express.Router();
const path       = require('path');
const { getPortalTier, setPortalTier, getAllPortals, TIERS } = require('../services/tierService');
const { createNotification, getAllNotifications, runAutomatedChecks } = require('../services/notificationService');
const { getAllRules, getRule, updateRule, getEmailLog, seedDefaultRules } = require('../services/emailRulesService');
const { sendRuleEmail } = require('../services/emailService');

function requireAdmin(req, res, next) {
  const key = req.query.key || req.headers['x-admin-key'];
  if (process.env.ADMIN_KEY && key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// GET /admin
router.get('/', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// GET /admin/portals
router.get('/portals', requireAdmin, async (req, res) => {
  const portals = await getAllPortals();
  res.json({ portals });
});

// POST /admin/portals/:portalId/tier
router.post('/portals/:portalId/tier', requireAdmin, async (req, res) => {
  const { portalId } = req.params;
  const { tier }     = req.body;
  if (!TIERS[tier]) return res.status(400).json({ error: 'Invalid tier' });
  await setPortalTier(portalId, tier);
  console.log(`[Admin] Portal ${portalId} tier set to ${tier}`);
  res.json({ ok: true });
});

// POST /admin/notify
router.post('/notify', requireAdmin, async (req, res) => {
  const { portalId, all, type, title, message, actionLabel, actionUrl } = req.body;
  if (!title || !message) return res.status(400).json({ error: 'Missing title or message' });
  const notification = { type: type || 'info', title, message, actionLabel: actionLabel || null, actionUrl: actionUrl || null };
  let sent = 0;
  try {
    if (all) {
      const portals = await getAllPortals();
      for (const portal of portals) {
        await createNotification(portal.portal_id, notification);
        sent++;
      }
    } else if (portalId) {
      await createNotification(String(portalId), notification);
      sent = 1;
    } else {
      return res.status(400).json({ error: 'Provide portalId or all:true' });
    }
    console.log(`[Admin] Sent notification to ${sent} portal(s): "${title}"`);
    res.json({ ok: true, sent });
  } catch (err) {
    console.error('[Admin] Notify error:', err.message);
    res.status(500).json({ error: err.message, sent: 0 });
  }
});

// GET /admin/notifications
router.get('/notifications', requireAdmin, async (req, res) => {
  const notifications = await getAllNotifications();
  res.json({ notifications });
});

// POST /admin/run-checks
router.post('/run-checks', requireAdmin, async (req, res) => {
  await runAutomatedChecks();
  res.json({ ok: true });
});

// ── EMAIL RULES ────────────────────────────────────────────

// GET /admin/email-rules
router.get('/email-rules', requireAdmin, async (req, res) => {
  const rules = await getAllRules();
  res.json({ rules });
});

// PUT /admin/email-rules/:id
router.put('/email-rules/:id', requireAdmin, async (req, res) => {
  const { id }                         = req.params;
  const { subject, body, enabled, name } = req.body;
  await updateRule(id, { subject, body, enabled, name });
  res.json({ ok: true });
});

// POST /admin/email-rules/:id/test
router.post('/email-rules/:id/test', requireAdmin, async (req, res) => {
  const { id }    = req.params;
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Missing email' });
  try {
    const sent = await sendRuleEmail(id, email, 'test-portal', {
      portalId:    'test-portal',
      planName:    'Growth',
      planPrice:   '$12/month',
      maxRules:    '30',
      maxMappings: '30',
      daysLeft:    '7',
      fromTier:    'trial',
      toTier:      'growth'
    });
    res.json({ ok: sent });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /admin/email-rules/:id/reset
router.post('/email-rules/:id/reset', requireAdmin, async (req, res) => {
  await seedDefaultRules();
  // Force re-seed by deleting and re-inserting
  const { Pool } = require('pg');
  try {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pool.query('DELETE FROM email_rules WHERE id = $1', [req.params.id]);
    await pool.end();
    await seedDefaultRules();
  } catch (err) {
    console.error('[Admin] Reset rule error:', err.message);
  }
  res.json({ ok: true });
});

// GET /admin/email-log
router.get('/email-log', requireAdmin, async (req, res) => {
  const logs = await getEmailLog();
  res.json({ logs });
});

module.exports = router;
