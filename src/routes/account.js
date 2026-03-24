// src/routes/account.js
const express = require('express');
const router  = express.Router();
const path    = require('path');
const { getPortalTier } = require('../services/tierService');

// GET /account
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/account.html'));
});

// GET /account/tier
router.get('/tier', async (req, res) => {
  const { portalId } = req.query;
  if (!portalId) return res.status(400).json({ error: 'Missing portalId' });

  const tierInfo = await getPortalTier(portalId);

  // Calculate trial days left
  let trialDaysLeft = 0;
  if (tierInfo.tier === 'trial') {
    // Get trial start from DB
    trialDaysLeft = tierInfo.trialDaysLeft || 14;
  }

  res.json({ ...tierInfo, trialDaysLeft });
});

// POST /account/upgrade-request
router.post('/upgrade-request', async (req, res) => {
  const { portalId, tier, name, email, message } = req.body;
  console.log(`[Account] Upgrade request from portal ${portalId}: ${name} <${email}> wants ${tier}`);
  console.log(`[Account] Message: ${message}`);
  // TODO: Send email notification to admin
  res.json({ ok: true });
});

module.exports = router;
