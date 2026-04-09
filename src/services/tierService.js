// src/services/tierService.js - UPDATED VERSION
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
        portal_id TEXT PRIMARY KEY,
        tier TEXT NOT NULL DEFAULT 'TRIAL',
        created_at TIMESTAMP DEFAULT NOW(),
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        stripe_subscription_status TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `).then(() => console.log('[Tiers] Table ready'))
      .catch(err => console.error('[Tiers] Table error:', err.message));
  }
  return pool;
}

// ✅ UPDATED TIER STRUCTURE
const TIERS = {
  FREE: {
    name: 'Free',
    price: 0,
    maxRules: Infinity,        // Unlimited rules
    maxMappings: 5,            // Total mappings across all rules
    allowedObjects: ['contacts', 'companies', 'deals'],
    trialDays: null,           // No trial expiration
    features: {
      polling: true,
      webhooks: true,
      customObjects: false,
      apiAccess: false
    }
  },
  
  TRIAL: {
    name: 'Trial',
    price: 0,
    maxRules: Infinity,
    maxMappings: 30,
    allowedObjects: ['contacts', 'companies', 'deals', 'tickets', 'leads', 'projects', 'courses'],
    trialDays: 7,              // ✅ 7 DAYS - THEN STOPS SYNCING
    features: {
      polling: true,
      webhooks: true,
      customObjects: true,
      apiAccess: true
    }
  },
  
  STARTER: {
    name: 'Starter',
    price: 5,
    maxRules: Infinity,
    maxMappings: 10,           // ✅ 10 MAPPINGS
    allowedObjects: ['contacts', 'companies', 'deals'],
    trialDays: null,
    features: {
      polling: true,
      webhooks: true,
      customObjects: false,
      apiAccess: false
    }
  },
  
  PRO: {
    name: 'Pro',
    price: 30,
    maxRules: Infinity,
    maxMappings: 30,           // ✅ 30 MAPPINGS
    allowedObjects: ['contacts', 'companies', 'deals', 'tickets', 'leads', 'projects', 'courses'],
    trialDays: null,
    features: {
      polling: true,
      webhooks: true,
      customObjects: true,
      apiAccess: true
    }
  },
  
  BUSINESS: {
    name: 'Business',
    price: 50,
    maxRules: Infinity,
    maxMappings: 100,          // ✅ 100 MAPPINGS
    allowedObjects: ['contacts', 'companies', 'deals', 'tickets', 'leads', 'projects', 'courses'],
    trialDays: null,
    features: {
      polling: true,
      webhooks: true,
      customObjects: true,
      apiAccess: true
    }
  },
  
  SUSPENDED: {
    name: 'Suspended',
    price: 0,
    maxRules: 0,
    maxMappings: 0,
    allowedObjects: [],
    trialDays: null,
    features: {
      polling: false,
      webhooks: false,
      customObjects: false,
      apiAccess: false
    }
  }
};

async function getPortalTier(portalId) {
  const p = getPool();
  if (!p) return { tier: 'FREE', ...TIERS.FREE, isExpired: false, canSync: true };

  try {
    const result = await p.query(
      'SELECT tier, created_at, stripe_customer_id, stripe_subscription_id, stripe_subscription_status FROM portal_tiers WHERE portal_id = $1',
      [String(portalId)]
    );

    if (!result.rows[0]) {
      // New portal - create with TRIAL tier
      await p.query(
        'INSERT INTO portal_tiers (portal_id, tier, created_at) VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING',
        [String(portalId), 'TRIAL']
      );
      return { 
        tier: 'TRIAL', 
        ...TIERS.TRIAL, 
        isExpired: false, 
        canSync: true,
        trialDaysLeft: 7 
      };
    }

    const { tier, created_at, stripe_customer_id, stripe_subscription_id, stripe_subscription_status } = result.rows[0];
    const tierInfo = TIERS[tier] || TIERS.FREE;

    let isExpired = false;
    let trialDaysLeft = null;
    let canSync = true;

    // ✅ CHECK TRIAL EXPIRATION
    if (tier === 'TRIAL' && created_at) {
      const daysSinceStart = (Date.now() - new Date(created_at).getTime()) / (1000 * 60 * 60 * 24);
      isExpired = daysSinceStart > 7;
      trialDaysLeft = Math.max(0, Math.ceil(7 - daysSinceStart));
      
      if (isExpired) {
        canSync = false; // ✅ STOPS SYNCING after 7 days
        console.log(`[Tiers] ⛔ Trial expired for portal ${portalId} - started ${daysSinceStart.toFixed(1)} days ago`);
      }
    }

    // FREE and paid tiers can always sync (no expiration)
    if (tier === 'FREE' || tier === 'STARTER' || tier === 'PRO' || tier === 'BUSINESS') {
      canSync = true;
      isExpired = false;
    }

    // SUSPENDED cannot sync
    if (tier === 'SUSPENDED') {
      canSync = false;
      isExpired = true;
    }

    return { 
      tier, 
      ...tierInfo, 
      isExpired, 
      canSync,
      trialDaysLeft,
      stripe_customer_id,
      stripe_subscription_id,
      stripe_subscription_status
    };
  } catch (err) {
    console.error('[Tiers] Get tier error:', err.message);
    return { tier: 'FREE', ...TIERS.FREE, isExpired: false, canSync: true };
  }
}

async function setPortalTier(portalId, tier, stripeData = {}) {
  const p = getPool();
  if (!p) return;
  
  const { customerId, subscriptionId, subscriptionStatus } = stripeData;
  
  await p.query(`
    INSERT INTO portal_tiers (portal_id, tier, stripe_customer_id, stripe_subscription_id, stripe_subscription_status, updated_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (portal_id) DO UPDATE 
    SET tier = $2, 
        stripe_customer_id = COALESCE($3, portal_tiers.stripe_customer_id),
        stripe_subscription_id = COALESCE($4, portal_tiers.stripe_subscription_id),
        stripe_subscription_status = COALESCE($5, portal_tiers.stripe_subscription_status),
        updated_at = NOW()
  `, [String(portalId), tier, customerId, subscriptionId, subscriptionStatus]);
  
  console.log(`[Tiers] Updated portal ${portalId} to ${tier}`);
}

async function getAllPortals() {
  const p = getPool();
  if (!p) return [];
  try {
    const result = await p.query(`
      SELECT 
        pt.portal_id,
        pt.tier,
        pt.created_at,
        pt.stripe_customer_id,
        pt.stripe_subscription_id,
        pt.stripe_subscription_status,
        pt.updated_at,
        t.data->>'hub_id' as hub_id
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

// ✅ COUNT TOTAL MAPPINGS across all rules
function countTotalMappings(rules) {
  if (!Array.isArray(rules)) return 0;
  
  return rules.reduce((total, rule) => {
    if (!rule.enabled || !rule.mappings) return total;
    return total + rule.mappings.length;
  }, 0);
}

// ✅ CHECK IF OBJECT TYPE IS ALLOWED
function isObjectAllowed(tier, objectType) {
  const tierInfo = TIERS[tier];
  if (!tierInfo) return false;
  
  return tierInfo.allowedObjects.includes(objectType);
}

// ✅ UPDATED CHECK LIMITS - Enforces new structure
async function checkLimits(portalId, rules) {
  const tierInfo = await getPortalTier(portalId);

  // ✅ CHECK IF CAN SYNC (trial expiration, suspended, etc)
  if (!tierInfo.canSync) {
    if (tierInfo.isExpired && tierInfo.tier === 'TRIAL') {
      return { 
        allowed: false, 
        reason: 'Your 7-day trial has expired. Please upgrade to continue syncing.',
        tierInfo
      };
    }
    
    if (tierInfo.tier === 'SUSPENDED') {
      return { 
        allowed: false, 
        reason: 'Your account is suspended. Please contact support.',
        tierInfo
      };
    }
    
    return { 
      allowed: false, 
      reason: 'Cannot sync. Please check your account status.',
      tierInfo
    };
  }

  // ✅ COUNT TOTAL MAPPINGS (not per-rule, but across all rules)
  const totalMappings = countTotalMappings(rules);
  
  if (totalMappings > tierInfo.maxMappings) {
    return {
      allowed: false,
      reason: `Your ${tierInfo.name} plan allows ${tierInfo.maxMappings} total mappings. You have ${totalMappings}. Please upgrade or reduce mappings.`,
      tierInfo,
      currentMappings: totalMappings
    };
  }

  // ✅ CHECK OBJECT TYPE RESTRICTIONS
  for (const rule of rules) {
    if (!rule.enabled) continue;
    
    if (!isObjectAllowed(tierInfo.tier, rule.sourceObject)) {
      return {
        allowed: false,
        reason: `Object type "${rule.sourceObject}" is not allowed on your ${tierInfo.name} plan. Please upgrade to use this object type.`,
        tierInfo
      };
    }
    
    if (!isObjectAllowed(tierInfo.tier, rule.targetObject)) {
      return {
        allowed: false,
        reason: `Object type "${rule.targetObject}" is not allowed on your ${tierInfo.name} plan. Please upgrade to use this object type.`,
        tierInfo
      };
    }
  }

  return { allowed: true, tierInfo, currentMappings: totalMappings };
}

module.exports = { 
  getPortalTier, 
  setPortalTier, 
  getAllPortals, 
  checkLimits, 
  countTotalMappings,
  isObjectAllowed,
  TIERS 
};
