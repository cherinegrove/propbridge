// src/services/tierService.js
const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    pool.query(`
      CREATE TABLE IF NOT EXISTS portal_tiers (
        portal_id                  TEXT PRIMARY KEY,
        tier                       TEXT NOT NULL DEFAULT 'trial',
        created_at                 TIMESTAMP DEFAULT NOW(),
        trial_started_at           TIMESTAMP,
        paddle_customer_id         TEXT,
        paddle_subscription_id     TEXT,
        paddle_subscription_status TEXT,
        updated_at                 TIMESTAMP DEFAULT NOW()
      )
    `).then(() => console.log('[Tiers] Table ready'))
      .catch(err => console.error('[Tiers] Table error:', err.message));
  }
  return pool;
}

const TIERS = {
  FREE: {
    name: 'Free',
    price: 0,
    maxMappings: Infinity,
    maxRules: Infinity,
    allowedObjects: ['contacts', 'companies', 'deals', 'tickets', 'leads', 'projects'],
    trialDays: null,
    canSync: true
  },
  TRIAL: {
    name: 'Free Trial',
    price: 0,
    maxMappings: 30,
    maxRules: Infinity,
    allowedObjects: ['contacts', 'companies', 'deals', 'tickets', 'leads', 'projects'],
    trialDays: 7,
    canSync: true
  },
  STARTER: {
    name: 'Starter',
    price: 10,
    maxMappings: 20,
    maxRules: Infinity,
    allowedObjects: ['contacts', 'companies', 'deals'],
    trialDays: null,
    canSync: true
  },
  PRO: {
    name: 'Pro',
    price: 15,
    maxMappings: 30,
    maxRules: Infinity,
    allowedObjects: ['contacts', 'companies', 'deals', 'tickets', 'leads', 'projects'],
    trialDays: null,
    canSync: true
  },
  BUSINESS: {
    name: 'Business',
    price: 40,
    maxMappings: 100,
    maxRules: Infinity,
    allowedObjects: ['contacts', 'companies', 'deals', 'tickets', 'leads', 'projects'],
    trialDays: null,
    canSync: true
  },
  SUSPENDED: {
    name: 'Suspended',
    price: 0,
    maxMappings: 0,
    maxRules: 0,
    allowedObjects: [],
    trialDays: null,
    canSync: false
  },
  CANCELLED: {
    name: 'Cancelled',
    price: 0,
    maxMappings: 0,
    maxRules: 0,
    allowedObjects: [],
    trialDays: null,
    canSync: false
  }
};

async function getPortalTier(portalId) {
  const p = getPool();
  try {
    const result = await p.query(
      `SELECT tier, created_at, trial_started_at,
              paddle_customer_id, paddle_subscription_id, paddle_subscription_status
       FROM portal_tiers WHERE portal_id = $1`,
      [portalId]
    );

    console.log('[Tiers] getPortalTier for', portalId, '- DB returned:', result.rows.length, 'rows');
    if (result.rows.length > 0) console.log('[Tiers] DB tier value:', result.rows[0].tier);

    if (result.rows.length === 0) {
      console.log('[Tiers] Portal not found, creating with trial tier');
      await p.query(
        'INSERT INTO portal_tiers (portal_id, tier, created_at, trial_started_at) VALUES ($1, $2, NOW(), NOW()) ON CONFLICT (portal_id) DO NOTHING',
        [portalId, 'trial']
      );
      return { tier: 'trial', created_at: new Date(), isExpired: false, canSync: true, ...TIERS.TRIAL };
    }

    const row       = result.rows[0];
    const tierUpper = row.tier.toUpperCase();
    const tierConfig = TIERS[tierUpper] || TIERS.FREE;

    // Check trial expiry using trial_started_at
    let isExpired = false;
    if (tierConfig.trialDays) {
      const startDate  = new Date(row.trial_started_at || row.created_at);
      const expiryDate = new Date(startDate.getTime() + (tierConfig.trialDays * 86400000));
      isExpired = Date.now() > expiryDate.getTime();
    }

    let canSync = tierConfig.canSync;
    if (isExpired) canSync = false;

    const returnValue = {
      tier:                       row.tier.toLowerCase(),
      created_at:                 row.created_at,
      trial_started_at:           row.trial_started_at,
      paddle_customer_id:         row.paddle_customer_id,
      paddle_subscription_id:     row.paddle_subscription_id,
      paddle_subscription_status: row.paddle_subscription_status,
      isExpired,
      canSync,
      ...tierConfig
    };

    console.log('[Tiers] Returning tier:', returnValue.tier, 'for portal', portalId);
    return returnValue;

  } catch (err) {
    console.error('[Tiers] Get tier error:', err.message);
    return { tier: 'free', created_at: new Date(), isExpired: false, canSync: true, ...TIERS.FREE };
  }
}

async function setPortalTier(portalId, tier, paddleData = {}) {
  const p = getPool();
  const tierUpper = tier.toUpperCase();
  if (!TIERS[tierUpper]) throw new Error(`Invalid tier: ${tier}`);

  const validTier = tier.toLowerCase();
  const { customer_id, subscription_id, subscription_status } = paddleData;

  await p.query(`
    INSERT INTO portal_tiers (portal_id, tier, created_at, trial_started_at, paddle_customer_id, paddle_subscription_id, paddle_subscription_status, updated_at)
    VALUES ($1, $2, NOW(), NOW(), $3, $4, $5, NOW())
    ON CONFLICT (portal_id) DO UPDATE SET
      tier                       = $2,
      paddle_customer_id         = COALESCE($3, portal_tiers.paddle_customer_id),
      paddle_subscription_id     = COALESCE($4, portal_tiers.paddle_subscription_id),
      paddle_subscription_status = COALESCE($5, portal_tiers.paddle_subscription_status),
      updated_at                 = NOW()
  `, [portalId, validTier, customer_id, subscription_id, subscription_status]);

  return { tier: validTier };
}

function isObjectAllowed(tier, objectType) {
  const tierConfig = TIERS[tier.toUpperCase()] || TIERS.FREE;
  return tierConfig.allowedObjects.includes(objectType);
}

async function getAllPortals() {
  const p = getPool();
  try {
    const result = await p.query(`
      SELECT pt.portal_id, pt.tier, pt.created_at, pt.trial_started_at,
             pt.paddle_customer_id, pt.paddle_subscription_id, pt.paddle_subscription_status,
             pt.updated_at, t.data->>'hub_id' as hub_id
      FROM portal_tiers pt
      LEFT JOIN tokens t ON t.portal_id = pt.portal_id
      ORDER BY pt.updated_at DESC
    `);
    return result.rows;
  } catch (err) {
    console.error('[Tiers] Get all portals error:', err.message);
    return [];
  }
}

module.exports = { TIERS, getPortalTier, setPortalTier, getAllPortals, isObjectAllowed };
