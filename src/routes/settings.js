// src/routes/settings.js
const express      = require('express');
const router       = express.Router();
const path         = require('path');
const { getClient } = require('../services/hubspotClient');

// In-memory rules store (per portal)
const rulesStore = {};

// ── GET /settings ─────────────────────────────────────────────
// Serve the settings UI page
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/settings.html'));
});

// ── GET /settings/rules ───────────────────────────────────────
router.get('/rules', (req, res) => {
  const { portalId } = req.query;
  const rules = rulesStore[portalId] || [];
  res.json({ rules });
});

// ── POST /settings/rules ──────────────────────────────────────
router.post('/rules', (req, res) => {
  const { portalId, rules } = req.body;
  if (!portalId) return res.status(400).json({ error: 'Missing portalId' });
  rulesStore[portalId] = rules || [];
  console.log(`[Settings] Saved ${rules?.length || 0} rules for portal ${portalId}`);
  res.json({ ok: true });
});

// ── GET /settings/properties/:objectType ─────────────────────
// Load properties for a given object type using stored OAuth token
router.get('/properties/:objectType', async (req, res) => {
  const { objectType } = req.params;
  const { portalId }   = req.query;

  if (!portalId) return res.status(400).json({ error: 'Missing portalId' });

  try {
    const client = await getClient(portalId);
    const response = await client.crm.properties.coreApi.getAll(objectType);
    const properties = (response.results || [])
      .filter(p => !p.hidden && !p.calculated)
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(p => ({ name: p.name, label: p.label, type: p.type }));
    res.json({ properties });
  } catch (err) {
    console.error('[Settings] Properties error:', err.message);
    res.status(500).json({ error: err.message, properties: [] });
  }
});

// Export rules store so webhook handler can access it
module.exports = router;
module.exports.rulesStore = rulesStore;
