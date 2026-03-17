// src/routes/webhooks.js
const express       = require('express');
const router        = express.Router();
const { getClient } = require('../services/hubspotClient');
const { sync }      = require('../services/syncService');
const { getRules }  = require('./settings');

// POST /webhooks/receive
router.post('/receive', async (req, res) => {
  res.status(200).send('ok');

  const events = Array.isArray(req.body) ? req.body : [req.body];
  console.log(`[Webhooks] Received ${events.length} event(s)`);

  // Log first event to understand structure
  if (events.length > 0) {
    console.log('[Webhooks] Sample event:', JSON.stringify(events[0]));
  }

  const byPortal = {};
  for (const event of events) {
    const portalId = String(event.portalId);
    if (!byPortal[portalId]) byPortal[portalId] = [];
    byPortal[portalId].push(event);
  }

  for (const [portalId, portalEvents] of Object.entries(byPortal)) {
    try {
      await processPortalEvents(portalId, portalEvents);
    } catch (err) {
      console.error(`[Webhooks] Error processing portal ${portalId}:`, err.message);
    }
  }
});

async function processPortalEvents(portalId, events) {
  const rules = await getRules(portalId);
  const activeRules = rules.filter(r => r.enabled);
  if (!activeRules.length) {
    console.log(`[Webhooks] No active rules for portal ${portalId}`);
    return;
  }

  let client;
  try {
    client = await getClient(portalId);
  } catch (err) {
    console.error(`[Webhooks] Could not get client for portal ${portalId}:`, err.message);
    return;
  }

  for (const event of events) {
    // HubSpot sends different field names depending on version
    const objectId      = event.objectId || event.id;
    const propertyName  = event.propertyName || event.property;
    const propertyValue = event.propertyValue || event.value;

    // Handle subscriptionType like "deal.propertyChange" or objectType field
    let objectType = event.objectType;
    if (!objectType && event.subscriptionType) {
      // e.g. "deal.propertyChange" -> "deals"
      const prefix = event.subscriptionType.split('.')[0];
      objectType = normalizeObjectType(prefix);
    }

    console.log(`[Webhooks] ${objectType} ${objectId} - ${propertyName} changed to "${propertyValue}"`);

    if (!objectType || !objectId || !propertyName) {
      console.log('[Webhooks] Missing required fields, skipping event');
      continue;
    }

    const matchingRules = activeRules.filter(rule => {
      const isSource = rule.sourceObject === objectType &&
        rule.mappings?.some(m => m.source === propertyName);
      const isTarget = rule.direction === 'two_way' &&
        rule.targetObject === objectType &&
        rule.mappings?.some(m => m.target === propertyName);
      return isSource || isTarget;
    });

    if (!matchingRules.length) {
      console.log(`[Webhooks] No matching rules for ${objectType}.${propertyName}`);
      continue;
    }

    for (const rule of matchingRules) {
      try {
        let sourceObjectType = rule.sourceObject;
        let sourceId         = String(objectId);
        let targetObjectType = rule.targetObject;

        if (rule.direction === 'two_way' && rule.targetObject === objectType) {
          sourceObjectType = rule.targetObject;
          targetObjectType = rule.sourceObject;
        }

        const result = await sync(client, {
          sourceObjectType,
          sourceId,
          targetObjectType,
          direction:        rule.direction,
          mappings:         rule.mappings,
          skipIfHasValue:   rule.skipIfHasValue === 'true',
          associationRule:  rule.assocRule || 'all',
          associationLabel: rule.assocLabel || ''
        });

        console.log(`[Webhooks] Rule "${rule.name}" synced ${result.updated} record(s) - status: ${result.status}`);
      } catch (err) {
        console.error(`[Webhooks] Rule "${rule.name}" failed:`, err.message);
      }
    }
  }
}

function normalizeObjectType(raw) {
  const map = {
    'contact':   'contacts',
    'company':   'companies',
    'deal':      'deals',
    'ticket':    'tickets',
    'lead':      'leads',
    'product':   'products',
    'contacts':  'contacts',
    'companies': 'companies',
    'deals':     'deals',
    'tickets':   'tickets'
  };
  return map[raw?.toLowerCase()] || raw?.toLowerCase();
}

module.exports = router;
