// src/routes/webhooks.js
const express       = require('express');
const router        = express.Router();
const { getClient } = require('../services/hubspotClient');
const { sync }      = require('../services/syncService');
const { getRules }  = require('./settings');

// Track changes PropBridge itself made so we don't re-sync them
// Key: `portalId-objectType-objectId-propertyName`, Value: timestamp
const propBridgeWrites = new Map();
const WRITE_WINDOW_MS  = 15000; // Ignore webhooks within 15s of our own write

function markOurWrite(portalId, objectType, objectId, properties) {
  const now = Date.now();
  for (const prop of Object.keys(properties)) {
    const key = `${portalId}-${objectType}-${objectId}-${prop}`;
    propBridgeWrites.set(key, now);
  }
  // Clean up old entries
  if (propBridgeWrites.size > 5000) {
    const cutoff = now - WRITE_WINDOW_MS * 2;
    for (const [k, v] of propBridgeWrites) {
      if (v < cutoff) propBridgeWrites.delete(k);
    }
  }
}

function isOurWrite(portalId, objectType, objectId, propertyName) {
  const key       = `${portalId}-${objectType}-${objectId}-${propertyName}`;
  const writeTime = propBridgeWrites.get(key);
  if (!writeTime) return false;
  const isRecent = Date.now() - writeTime < WRITE_WINDOW_MS;
  if (isRecent) {
    console.log(`[Webhooks] Skipping ${key} — triggered by PropBridge own write`);
  }
  return isRecent;
}

// Dedup rapid external updates
const recentlyProcessed = new Map();
const DEDUP_WINDOW_MS   = 5000;

function isDuplicate(key) {
  const lastTime = recentlyProcessed.get(key);
  if (lastTime && Date.now() - lastTime < DEDUP_WINDOW_MS) return true;
  recentlyProcessed.set(key, Date.now());
  if (recentlyProcessed.size > 1000) {
    const cutoff = Date.now() - DEDUP_WINDOW_MS * 2;
    for (const [k, v] of recentlyProcessed) {
      if (v < cutoff) recentlyProcessed.delete(k);
    }
  }
  return false;
}

// POST /webhooks/receive
router.post('/receive', async (req, res) => {
  res.status(200).send('ok');

  const events = Array.isArray(req.body) ? req.body : [req.body];
  console.log(`[Webhooks] Received ${events.length} event(s)`);

  if (events.length > 0) {
    console.log('[Webhooks] Sample event:', JSON.stringify(events[0]));
  }

  // Delay to let HubSpot settle on latest value
  await new Promise(resolve => setTimeout(resolve, 2000));

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
  const rules       = await getRules(portalId);
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
    const objectId      = event.objectId || event.id;
    const propertyName  = event.propertyName || event.property;
    const propertyValue = event.propertyValue || event.value;

    let objectType = event.objectType;
    if (!objectType && event.subscriptionType) {
      const prefix = event.subscriptionType.split('.')[0];
      objectType   = normalizeObjectType(prefix);
    }

    console.log(`[Webhooks] ${objectType} ${objectId} - ${propertyName} changed to "${propertyValue}"`);

    if (!objectType || !objectId || !propertyName) {
      console.log('[Webhooks] Missing required fields, skipping');
      continue;
    }

    // Skip if this change was made by PropBridge itself (prevents bidirectional loop)
    if (isOurWrite(portalId, objectType, objectId, propertyName)) {
      continue;
    }

    // Dedup rapid external changes
    const dedupKey = `${portalId}-${objectType}-${objectId}-${propertyName}`;
    if (isDuplicate(dedupKey)) {
      console.log(`[Webhooks] Duplicate skipped: ${dedupKey}`);
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
          associationLabel: rule.assocLabel || '',
          // Pass write tracker so syncService can mark our writes
          onWrite: (tgtType, tgtId, props) => markOurWrite(portalId, tgtType, tgtId, props)
        });

        console.log(`[Webhooks] Rule "${rule.name}" synced ${result.updated} record(s) - status: ${result.status}`);
        
        // Log errors if any (for debugging in Railway logs)
        if (result.errors && result.errors.length > 0) {
          console.error(`[Webhooks] Rule "${rule.name}" errors:`, JSON.stringify(result.errors));
        }
        
      } catch (err) {
        console.error(`[Webhooks] Rule "${rule.name}" failed:`, err.message);
      }
    }
  }
}

function normalizeObjectType(raw) {
  const map = {
    'contact':   'contacts',   'contacts':   'contacts',
    'company':   'companies',  'companies':  'companies',
    'deal':      'deals',      'deals':      'deals',
    'ticket':    'tickets',    'tickets':    'tickets',
    'lead':      'leads',      'leads':      'leads',
    'product':   'products',   'products':   'products',
    'line_item': 'line_items', 'line_items': 'line_items',
    'quote':     'quotes',     'quotes':     'quotes',
    'task':      'tasks',      'tasks':      'tasks',
    'call':      'calls',      'calls':      'calls',
    'meeting':   'meetings',   'meetings':   'meetings',
    'note':      'notes',      'notes':      'notes',
    'email':     'emails',     'emails':     'emails',
    'appointment': 'appointments', 'appointments': 'appointments',
    'course':    'courses',    'courses':    'courses',
    'listing':   'listings',   'listings':   'listings',
    'service':   'services',   'services':   'services',
    'project':   'projects',   'projects':   'projects',
    'invoice':   'invoices',   'invoices':   'invoices',
    'order':     'orders',     'orders':     'orders',
    'goal':      'goals',      'goals':      'goals'
  };
  return map[raw?.toLowerCase()] || raw?.toLowerCase();
}

module.exports = router;
