// src/services/webhookManager.js
// Manages HubSpot webhook subscriptions for property change triggers
const axios = require('axios');

const APP_ID      = process.env.HUBSPOT_APP_ID;
const DEV_API_KEY = process.env.HUBSPOT_DEVELOPER_API_KEY;
const BASE_URL    = process.env.APP_BASE_URL;

const OBJECT_TYPE_MAP = {
  contacts:  'contact',
  companies: 'company',
  deals:     'deal',
  tickets:   'ticket',
  leads:     'lead',
  products:  'product'
};

// Get all current webhook subscriptions
async function getSubscriptions() {
  try {
    const { data } = await axios.get(
      `https://api.hubapi.com/webhooks/v3/${APP_ID}/subscriptions?hapikey=${DEV_API_KEY}`
    );
    return data.results || [];
  } catch (err) {
    console.error('[Webhooks] Get subscriptions error:', err.response?.data || err.message);
    return [];
  }
}

// Create a webhook subscription for a property on an object type
async function createSubscription(objectType, propertyName) {
  const hsObjectType = OBJECT_TYPE_MAP[objectType] || objectType;
  try {
    const { data } = await axios.post(
      `https://api.hubapi.com/webhooks/v3/${APP_ID}/subscriptions?hapikey=${DEV_API_KEY}`,
      {
        eventType:        `${hsObjectType}.propertyChange`,
        propertyName:     propertyName,
        active:           true
      }
    );
    console.log(`[Webhooks] Created subscription for ${objectType}.${propertyName} (ID: ${data.id})`);
    return data;
  } catch (err) {
    // Ignore duplicate subscription errors
    if (err.response?.data?.message?.includes('already exists') ||
        err.response?.status === 409) {
      console.log(`[Webhooks] Subscription already exists for ${objectType}.${propertyName}`);
      return null;
    }
    console.error(`[Webhooks] Create subscription error for ${objectType}.${propertyName}:`, err.response?.data || err.message);
    return null;
  }
}

// Delete a webhook subscription by ID
async function deleteSubscription(subscriptionId) {
  try {
    await axios.delete(
      `https://api.hubapi.com/webhooks/v3/${APP_ID}/subscriptions/${subscriptionId}?hapikey=${DEV_API_KEY}`
    );
    console.log(`[Webhooks] Deleted subscription ${subscriptionId}`);
  } catch (err) {
    console.error(`[Webhooks] Delete subscription error:`, err.response?.data || err.message);
  }
}

// Set the webhook target URL
async function setWebhookUrl() {
  try {
    await axios.put(
      `https://api.hubapi.com/webhooks/v3/${APP_ID}/settings?hapikey=${DEV_API_KEY}`,
      {
        targetUrl:          `${BASE_URL}/webhooks/receive`,
        throttlingSettings: { period: 'SECONDLY', maxConcurrentRequests: 10 }
      }
    );
    console.log(`[Webhooks] Target URL set to ${BASE_URL}/webhooks/receive`);
  } catch (err) {
    console.error('[Webhooks] Set URL error:', err.response?.data || err.message);
  }
}

// Sync subscriptions based on all active rules across all portals
async function syncSubscriptions(allRules) {
  await setWebhookUrl();

  // Collect all unique object+property combos needed
  const needed = new Set();
  for (const rules of Object.values(allRules)) {
    for (const rule of rules) {
      if (!rule.enabled) continue;
      for (const mapping of (rule.mappings || [])) {
        needed.add(`${rule.sourceObject}|${mapping.source}`);
        needed.add(`${rule.targetObject}|${mapping.target}`);
      }
    }
  }

  // Get existing subscriptions
  const existing = await getSubscriptions();
  const existingSet = new Set(
    existing.map(s => `${s.eventType.split('.')[0]}|${s.propertyName}`)
  );

  // Create missing subscriptions
  for (const key of needed) {
    const [objectType, propertyName] = key.split('|');
    const hsType = OBJECT_TYPE_MAP[objectType] || objectType;
    const existingKey = `${hsType}|${propertyName}`;
    if (!existingSet.has(existingKey)) {
      await createSubscription(objectType, propertyName);
    }
  }

  console.log(`[Webhooks] Sync complete. ${needed.size} subscriptions needed, ${existing.length} existing.`);
}

module.exports = { getSubscriptions, createSubscription, deleteSubscription, syncSubscriptions, setWebhookUrl };
