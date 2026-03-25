// src/routes/account.js
const express = require('express');
const router  = express.Router();
const path    = require('path');
const { getPortalTier } = require('../services/tierService');
const { Pool } = require('pg');

let pool = null;
function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

// GET /account
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/account.html'));
});

// GET /account/tier
router.get('/tier', async (req, res) => {
  const { portalId } = req.query;
  if (!portalId) return res.status(400).json({ error: 'Missing portalId' });

  const tierInfo = await getPortalTier(portalId);

  // Get trial_started_at from DB
  let trial_started_at = null;
  try {
    const p = getPool();
    if (p) {
      const result = await p.query(
        'SELECT trial_started_at FROM portal_tiers WHERE portal_id = $1',
        [String(portalId)]
      );
      trial_started_at = result.rows[0]?.trial_started_at || null;
    }
  } catch (err) {
    console.error('[Account] Get trial date error:', err.message);
  }

  res.json({ ...tierInfo, trial_started_at });
});

// POST /account/upgrade-request
router.post('/upgrade-request', async (req, res) => {
  const { portalId, tier, name, email } = req.body;
  console.log(`[Account] Upgrade request from portal ${portalId}: ${name} <${email}> wants ${tier}`);
  res.json({ ok: true });
});

module.exports = router;
