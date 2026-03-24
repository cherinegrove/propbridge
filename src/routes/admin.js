// src/routes/admin.js
const express    = require('express');
const router     = express.Router();
const path       = require('path');
const { getPortalTier, setPortalTier, getAllPortals, TIERS } = require('../services/tierService');

// Simple admin key protection
function requireAdmin(req, res, next) {
  const key = req.query.key || req.headers['x-admin-key'];
  if (key !== process.env.ADMIN_KEY && process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// GET /admin — serve admin page
router.get('/', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// GET /admin/portals — list all portals
router.get('/portals', requireAdmin, async (req, res) => {
  const portals = await getAllPortals();
  res.json({ portals });
});

// POST /admin/portals/:portalId/tier — update tier
router.post('/portals/:portalId/tier', requireAdmin, async (req, res) => {
  const { portalId } = req.params;
  const { tier } = req.body;
  if (!TIERS[tier]) return res.status(400).json({ error: 'Invalid tier' });
  await setPortalTier(portalId, tier);
  console.log(`[Admin] Portal ${portalId} tier set to ${tier}`);
  res.json({ ok: true });
});

// GET /admin/portals/:portalId/tier — get tier info
router.get('/portals/:portalId/tier', requireAdmin, async (req, res) => {
  const tierInfo = await getPortalTier(req.params.portalId);
  res.json(tierInfo);
});

module.exports = router;
