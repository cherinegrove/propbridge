// src/routes/settings.js
const express       = require('express');
const router        = express.Router();
const path          = require('path');
const { getClient } = require('../services/hubspotClient');
const { Pool }      = require('pg');

let pool = null;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    pool.query(`
      CREATE TABLE IF NOT EXISTS sync_rules (
        portal_id TEXT PRIMARY KEY,
        rules JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `).catch(err => console.error('[DB] sync_rules table error:', err.message));
  }
  return pool;
}

const memRulesStore = {};

async function getRules(portalId) {
  const p = getPool();
  if (p) {
    try {
      const result = await p.query('SELECT rules FROM sync_rules WHERE portal_id = $1', [String(portalId)]);
      return result.rows[0]?.rules || [];
    } catch (err) {
      console.error('[DB] Get rules error:', err.message);
    }
  }
  return memRulesStore[portalId] || [];
}

async function saveRules(portalId, rules) {
  const p = getPool();
  if (p) {
    try {
      await p.query(`
        INSERT INTO sync_rules (portal_id, rules, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (portal_id) DO UPDATE SET rules = $2, updated_at = NOW()
      `, [String(portalId), JSON.stringify(rules)]);
      return;
    } catch (err) {
      console.error('[DB] Save rules error:', err.message);
    }
  }
  memRulesStore[portalId] = rules;
}

// Known HubSpot object types as fallback
const KNOWN_OBJECTS = [
  { name: 'contacts',      label: 'Contacts' },
  { name: 'companies',     label: 'Companies' },
  { name: 'deals',         label: 'Deals' },
  { name: 'tickets',       label: 'Tickets' },
  { name: 'leads',         label: 'Leads' },
  { name: 'products',      label: 'Products' },
  { name: 'line_items',    label: 'Line Items' },
  { name: 'quotes',        label: 'Quotes' },
  { name: 'invoices',      label: 'Invoices' },
  { name: 'orders',        label: 'Orders' },
  { name: 'carts',         label: 'Carts' },
  { name: 'appointments',  label: 'Appointments' },
  { name: 'courses',       label: 'Courses' },
  { name: 'listings',      label: 'Listings' },
  { name: 'services',      label: 'Services' },
  { name: 'goals',         label: 'Goals' },
  { name: 'tasks',         label: 'Tasks' },
  { name: 'calls',         label: 'Calls' },
  { name: 'emails',        label: 'Emails' },
  { name: 'meetings',      label: 'Meetings' },
  { name: 'notes',         label: 'Notes' },
  { name: 'communications', label: 'Communications' },
  { name: 'postal_mail',   label: 'Postal Mail' },
  { name: 'subscriptions', label: 'Subscriptions' },
  { name: 'payments',      label: 'Payments' },
  { name: 'discounts',     label: 'Discounts' }
];

// GET /settings
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/settings.html'));
});

// GET /settings/rules
router.get('/rules', async (req, res) => {
  const { portalId } = req.query;
  if (!portalId) return res.status(400).json({ error: 'Missing portalId' });
  const rules = await getRules(portalId);
  res.json({ rules });
});

// POST /settings/rules
router.post('/rules', async (req, res) => {
  const { portalId, rules } = req.body;
  if (!portalId) return res.status(400).json({ error: 'Missing portalId' });
  await saveRules(portalId, rules || []);
  console.log(`[Settings] Saved ${rules?.length || 0} rules for portal ${portalId}`);
  res.json({ ok: true });
});

// GET /settings/objects — dynamically fetch all available object types for a portal
router.get('/objects', async (req, res) => {
  const { portalId } = req.query;
  if (!portalId) return res.status(400).json({ error: 'Missing portalId', objects: KNOWN_OBJECTS });

  try {
    const client = await getClient(portalId);
    const axios  = require('axios');
    const tokenStore = require('../services/tokenStore');
    const tokens = await tokenStore.get(portalId);

    if (!tokens?.access_token) {
      return res.json({ objects: KNOWN_OBJECTS, source: 'fallback' });
    }

    // Fetch all object schemas from HubSpot
    const schemasRes = await axios.get(
      'https://api-eu1.hubapi.com/crm/v3/schemas',
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );

    const customObjects = (schemasRes.data?.results || []).map(schema => ({
      name:  schema.objectTypeId || schema.name,
      label: schema.labels?.singular || schema.name,
      custom: true
    }));

    // Merge known objects with custom objects (deduplicate)
    const knownNames   = new Set(KNOWN_OBJECTS.map(o => o.name));
    const uniqueCustom = customObjects.filter(o => !knownNames.has(o.name));
    const allObjects   = [...KNOWN_OBJECTS, ...uniqueCustom];

    console.log(`[Settings] Loaded ${allObjects.length} object types for portal ${portalId} (${uniqueCustom.length} custom)`);
    res.json({ objects: allObjects, source: 'dynamic' });

  } catch (err) {
    console.error('[Settings] Objects error:', err.message);
    // Return fallback list so UI still works
    res.json({ objects: KNOWN_OBJECTS, source: 'fallback' });
  }
});

// GET /settings/properties/:objectType
router.get('/properties/:objectType', async (req, res) => {
  const { objectType } = req.params;
  const { portalId }   = req.query;

  if (!portalId) return res.status(400).json({ error: 'Missing portalId', properties: [] });

  try {
    const client = await getClient(portalId);

    let properties = [];

    // Try standard CRM properties API first
    try {
      const response = await client.crm.properties.coreApi.getAll(objectType);
      properties = (response.results || [])
        .filter(p => !p.hidden && !p.calculated)
        .sort((a, b) => a.label.localeCompare(b.label))
        .map(p => ({ name: p.name, label: p.label, type: p.type }));
    } catch (crmErr) {
      // Try with axios for non-standard objects
      const axios      = require('axios');
      const tokenStore = require('../services/tokenStore');
      const tokens     = await tokenStore.get(portalId);

      if (tokens?.access_token) {
        // Try v3 properties endpoint
        const propsRes = await axios.get(
          `https://api-eu1.hubapi.com/crm/v3/properties/${objectType}`,
          { headers: { Authorization: `Bearer ${tokens.access_token}` } }
        );
        properties = (propsRes.data?.results || [])
          .filter(p => !p.hidden && !p.calculated)
          .sort((a, b) => a.label.localeCompare(b.label))
          .map(p => ({ name: p.name, label: p.label, type: p.type }));
      }
    }

    if (!properties.length) {
      console.warn(`[Settings] No properties found for ${objectType}`);
    } else {
      console.log(`[Settings] Loaded ${properties.length} properties for ${objectType}`);
    }

    res.json({ properties });

  } catch (err) {
    console.error('[Settings] Properties error for', objectType, ':', err.message);
    if (err.message.includes('not installed') || err.message.includes('token')) {
      return res.status(401).json({
        error: 'App not connected. Please reinstall.',
        reinstallUrl: `${process.env.APP_BASE_URL}/oauth/install`,
        properties: []
      });
    }
    res.status(500).json({ error: err.message, properties: [] });
  }
});

// GET /settings/sync-webhooks
router.get('/sync-webhooks', async (req, res) => {
  try {
    const webhookManager = require('../services/webhookManager');
    const tokenStore     = require('../services/tokenStore');
    const allTokens      = await tokenStore.getAll();
    const allRules       = {};
    for (const pid of Object.keys(allTokens)) {
      allRules[pid] = await getRules(pid);
    }
    await webhookManager.syncSubscriptions(allRules);
    res.json({ ok: true, portals: Object.keys(allTokens), message: 'Webhook subscriptions synced!' });
  } catch (err) {
    console.error('[Settings] Webhook sync error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /settings/rules/sync-webhooks
router.post('/rules/sync-webhooks', async (req, res) => {
  try {
    const webhookManager = require('../services/webhookManager');
    const tokenStore     = require('../services/tokenStore');
    const allTokens      = await tokenStore.getAll();
    const allRules       = {};
    for (const portalId of Object.keys(allTokens)) {
      allRules[portalId] = await getRules(portalId);
    }
    await webhookManager.syncSubscriptions(allRules);
    res.json({ ok: true, message: 'Webhook subscriptions synced' });
  } catch (err) {
    console.error('[Settings] Webhook sync error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.getRules = getRules;
