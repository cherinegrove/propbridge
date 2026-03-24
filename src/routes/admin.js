// src/routes/admin.js
const express    = require('express');
const router     = express.Router();
const path       = require('path');
const { getPortalTier, setPortalTier, getAllPortals, TIERS } = require('../services/tierService');
const { notify, getAllNotifications, runAutomatedChecks }    = require('../services/notificationService');

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
  const { tier } = req.body;
  if (!TIERS[tier]) return res.status(400).json({ error: 'Invalid tier' });
  await setPortalTier(portalId, tier);
  console.log(`[Admin] Portal ${portalId} tier set to ${tier}`);
  res.json({ ok: true });
});

// POST /admin/notify — send notification to one or all portals
router.post('/notify', requireAdmin, async (req, res) => {
  const { portalId, all, type, title, message, actionLabel, actionUrl } = req.body;

  if (!title || !message) return res.status(400).json({ error: 'Missing title or message' });

  if (all) {
    const portals = await getAllPortals();
    for (const portal of portals) {
      await notify(portal.portal_id, { type, title, message, actionLabel, actionUrl });
    }
    console.log(`[Admin] Sent notification to all ${portals.length} portals`);
    res.json({ ok: true, sent: portals.length });
  } else if (portalId) {
    await notify(portalId, { type, title, message, actionLabel, actionUrl });
    res.json({ ok: true, sent: 1 });
  } else {
    res.status(400).json({ error: 'Provide portalId or all:true' });
  }
});

// GET /admin/notifications — get all notifications
router.get('/notifications', requireAdmin, async (req, res) => {
  const notifications = await getAllNotifications();
  res.json({ notifications });
});

// POST /admin/run-checks — manually trigger automated checks
router.post('/run-checks', requireAdmin, async (req, res) => {
  await runAutomatedChecks();
  res.json({ ok: true });
});

module.exports = router;
