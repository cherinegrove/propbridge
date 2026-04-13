// src/routes/paystack.js - Complete PayStack Integration
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { Pool } = require('pg');
const { setPortalTier } = require('../services/tierService');

let pool = null;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

// PayStack Plan Codes (update these with your actual plan codes after creating them)
const PLAN_CODES = {
  starter: process.env.PAYSTACK_STARTER_PLAN || 'PLN_starter',
  pro: process.env.PAYSTACK_PRO_PLAN || 'PLN_pro',
  business: process.env.PAYSTACK_BUSINESS_PLAN || 'PLN_business'
};

// Tier to plan mapping
const TIER_TO_PLAN = {
  starter: 'starter',
  pro: 'pro',
  business: 'business'
};

// POST /api/paystack/initialize - Initialize a subscription
router.post('/initialize', async (req, res) => {
  const { email, plan, portalId } = req.body;

  if (!email || !plan || !portalId) {
    return res.status(400).json({ error: 'Email, plan, and portalId required' });
  }

  if (!PLAN_CODES[plan]) {
    return res.status(400).json({ error: 'Invalid plan' });
  }

  try {
    const https = require('https');
    const planCode = PLAN_CODES[plan];

    const params = JSON.stringify({
      email,
      plan: planCode,
      metadata: {
        portal_id: portalId,
        plan_tier: plan
      }
    });

    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path: '/transaction/initialize',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(params)
      }
    };

    const paystackReq = https.request(options, (paystackRes) => {
      let data = '';

      paystackRes.on('data', (chunk) => {
        data += chunk;
      });

      paystackRes.on('end', () => {
        const response = JSON.parse(data);
        
        if (response.status) {
          res.json({
            success: true,
            authorization_url: response.data.authorization_url,
            access_code: response.data.access_code,
            reference: response.data.reference
          });
        } else {
          console.error('[PayStack] Initialize error:', response.message);
          res.status(400).json({ error: response.message });
        }
      });
    });

    paystackReq.on('error', (error) => {
      console.error('[PayStack] Request error:', error.message);
      res.status(500).json({ error: 'Payment initialization failed' });
    });

    paystackReq.write(params);
    paystackReq.end();

  } catch (err) {
    console.error('[PayStack] Initialize error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/paystack/verify/:reference - Verify a payment
router.get('/verify/:reference', async (req, res) => {
  const { reference } = req.params;

  if (!reference) {
    return res.status(400).json({ error: 'Reference required' });
  }

  try {
    const https = require('https');

    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path: `/transaction/verify/${reference}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
      }
    };

    const paystackReq = https.request(options, (paystackRes) => {
      let data = '';

      paystackRes.on('data', (chunk) => {
        data += chunk;
      });

      paystackRes.on('end', async () => {
        const response = JSON.parse(data);
        
        if (response.status && response.data.status === 'success') {
          const { metadata, customer, subscription } = response.data;
          const portalId = metadata.portal_id;
          const planTier = metadata.plan_tier;

          // Update portal tier
          if (portalId && planTier) {
            await setPortalTier(portalId, planTier);

            // Store subscription info
            const p = getPool();
            if (p) {
              try {
                await p.query(`
                  UPDATE portal_tiers 
                  SET paystack_customer_id = $1,
                      paystack_subscription_id = $2,
                      paystack_subscription_status = 'active',
                      updated_at = NOW()
                  WHERE portal_id = $3
                `, [customer.customer_code, subscription?.subscription_code, portalId]);
              } catch (dbErr) {
                console.error('[PayStack] DB update error:', dbErr.message);
              }
            }

            console.log(`[PayStack] ✅ Portal ${portalId} upgraded to ${planTier}`);
          }

          res.json({
            success: true,
            status: response.data.status,
            amount: response.data.amount / 100, // Convert from kobo/cents
            customer: customer.email,
            plan: planTier
          });
        } else {
          res.json({
            success: false,
            message: response.message || 'Payment not successful'
          });
        }
      });
    });

    paystackReq.on('error', (error) => {
      console.error('[PayStack] Verify error:', error.message);
      res.status(500).json({ error: 'Verification failed' });
    });

    paystackReq.end();

  } catch (err) {
    console.error('[PayStack] Verify error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/paystack/webhook - Handle PayStack webhooks
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    console.log('[PayStack] Invalid webhook signature');
    return res.sendStatus(400);
  }

  const event = req.body;
  console.log('[PayStack] Webhook event:', event.event);

  try {
    switch (event.event) {
      case 'charge.success':
        // Initial payment successful
        console.log('[PayStack] Payment successful:', event.data.reference);
        break;

      case 'subscription.create':
        // Subscription created
        const createData = event.data;
        console.log('[PayStack] Subscription created:', createData.subscription_code);
        break;

      case 'subscription.disable':
        // Subscription cancelled/disabled
        const disableData = event.data;
        const p1 = getPool();
        if (p1) {
          try {
            // Find portal by subscription code
            const result = await p1.query(
              'SELECT portal_id FROM portal_tiers WHERE paystack_subscription_id = $1',
              [disableData.subscription_code]
            );
            
            if (result.rows.length > 0) {
              const portalId = result.rows[0].portal_id;
              await setPortalTier(portalId, 'cancelled');
              await p1.query(`
                UPDATE portal_tiers 
                SET paystack_subscription_status = 'cancelled'
                WHERE portal_id = $1
              `, [portalId]);
              console.log(`[PayStack] Portal ${portalId} subscription cancelled`);
            }
          } catch (dbErr) {
            console.error('[PayStack] Webhook DB error:', dbErr.message);
          }
        }
        break;

      case 'invoice.payment_failed':
        // Payment failed - suspend account
        const failData = event.data;
        const p2 = getPool();
        if (p2) {
          try {
            const result = await p2.query(
              'SELECT portal_id FROM portal_tiers WHERE paystack_subscription_id = $1',
              [failData.subscription?.subscription_code]
            );
            
            if (result.rows.length > 0) {
              const portalId = result.rows[0].portal_id;
              await setPortalTier(portalId, 'suspended');
              await p2.query(`
                UPDATE portal_tiers 
                SET paystack_subscription_status = 'past_due'
                WHERE portal_id = $1
              `, [portalId]);
              console.log(`[PayStack] Portal ${portalId} suspended (payment failed)`);
            }
          } catch (dbErr) {
            console.error('[PayStack] Webhook DB error:', dbErr.message);
          }
        }
        break;

      case 'subscription.not_renew':
        // Subscription will not renew
        console.log('[PayStack] Subscription will not renew:', event.data.subscription_code);
        break;

      default:
        console.log('[PayStack] Unhandled event:', event.event);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('[PayStack] Webhook processing error:', err.message);
    res.sendStatus(500);
  }
});

// GET /api/paystack/subscription/:portalId - Get subscription status
router.get('/subscription/:portalId', async (req, res) => {
  const { portalId } = req.params;
  const p = getPool();

  if (!p) {
    return res.json({ subscription: null });
  }

  try {
    const result = await p.query(
      'SELECT paystack_subscription_id, paystack_subscription_status FROM portal_tiers WHERE portal_id = $1',
      [portalId]
    );

    if (result.rows.length > 0 && result.rows[0].paystack_subscription_id) {
      res.json({
        subscription_id: result.rows[0].paystack_subscription_id,
        status: result.rows[0].paystack_subscription_status || 'unknown'
      });
    } else {
      res.json({ subscription: null });
    }
  } catch (err) {
    console.error('[PayStack] Get subscription error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/paystack/cancel/:portalId - Cancel subscription
router.post('/cancel/:portalId', async (req, res) => {
  const { portalId } = req.params;
  const p = getPool();

  if (!p) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    // Get subscription ID
    const result = await p.query(
      'SELECT paystack_subscription_id FROM portal_tiers WHERE portal_id = $1',
      [portalId]
    );

    if (result.rows.length === 0 || !result.rows[0].paystack_subscription_id) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    const subscriptionCode = result.rows[0].paystack_subscription_id;

    // Cancel via PayStack API
    const https = require('https');
    const params = JSON.stringify({
      code: subscriptionCode,
      token: process.env.PAYSTACK_SECRET_KEY.split('_')[2] // Email token
    });

    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path: '/subscription/disable',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      }
    };

    const paystackReq = https.request(options, (paystackRes) => {
      let data = '';

      paystackRes.on('data', (chunk) => {
        data += chunk;
      });

      paystackRes.on('end', async () => {
        const response = JSON.parse(data);
        
        if (response.status) {
          // Update local status
          await setPortalTier(portalId, 'cancelled');
          await p.query(`
            UPDATE portal_tiers 
            SET paystack_subscription_status = 'cancelled'
            WHERE portal_id = $1
          `, [portalId]);

          res.json({ success: true, message: 'Subscription cancelled' });
        } else {
          res.status(400).json({ error: response.message });
        }
      });
    });

    paystackReq.on('error', (error) => {
      console.error('[PayStack] Cancel error:', error.message);
      res.status(500).json({ error: 'Cancellation failed' });
    });

    paystackReq.write(params);
    paystackReq.end();

  } catch (err) {
    console.error('[PayStack] Cancel subscription error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
