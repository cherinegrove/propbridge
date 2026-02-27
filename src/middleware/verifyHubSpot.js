// src/middleware/verifyHubSpot.js
// ─────────────────────────────────────────────────────────────
// Validates the X-HubSpot-Signature-v3 header on incoming
// webhook / action execution requests.
// ─────────────────────────────────────────────────────────────
const crypto = require('crypto');

module.exports = function verifyHubSpot(req, res, next) {
  const signature  = req.headers['x-hubspot-signature-v3'];
  const timestamp  = req.headers['x-hubspot-request-timestamp'];

  if (!signature || !timestamp) {
    return res.status(401).json({ error: 'Missing HubSpot signature headers' });
  }

  // Reject requests older than 5 minutes (replay attack protection)
  if (Math.abs(Date.now() - Number(timestamp)) > 300_000) {
    return res.status(401).json({ error: 'Request timestamp too old' });
  }

  const rawBody  = JSON.stringify(req.body);
  const method   = req.method.toUpperCase();
  const url      = `${process.env.APP_BASE_URL}${req.originalUrl}`;
  const toSign   = `${method}${url}${rawBody}${timestamp}`;
  const expected = crypto
    .createHmac('sha256', process.env.HUBSPOT_CLIENT_SECRET)
    .update(toSign)
    .digest('base64');

  if (signature !== expected) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
};
