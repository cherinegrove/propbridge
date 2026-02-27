// src/routes/oauth.js
const express      = require('express');
const router       = express.Router();
const { getAuthUrl, exchangeCode } = require('../services/hubspotClient');
const tokenStore   = require('../services/tokenStore');

// ── GET /oauth/install ────────────────────────────────────────
// Entry point from the HubSpot Marketplace "Install" button.
router.get('/install', (_req, res) => {
  res.redirect(getAuthUrl());
});

// ── GET /oauth/callback ───────────────────────────────────────
// HubSpot redirects here after the user approves the app.
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    console.error('OAuth error:', error);
    return res.status(400).send(`OAuth error: ${error}`);
  }

  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  try {
    const tokens = await exchangeCode(code);
    // tokens.hub_id is the portal ID
    tokenStore.set(tokens.hub_id, tokens);
    console.log(`✅  Portal ${tokens.hub_id} installed successfully`);

    // In production redirect to a nice "installation complete" page
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h2>✅ Property Sync App Installed!</h2>
        <p>Portal <strong>${tokens.hub_id}</strong> is connected.</p>
        <p>You can now use the <strong>Sync Object Properties</strong> action in your workflows.</p>
        <a href="https://app.hubspot.com">Return to HubSpot →</a>
      </body></html>
    `);
  } catch (err) {
    console.error('Token exchange failed:', err.message);
    res.status(500).send('Installation failed — please try again.');
  }
});

module.exports = router;
