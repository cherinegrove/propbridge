// src/routes/stripe.js - Stripe webhook handler for subscription management

const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Stripe webhook endpoint
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('[Stripe] Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  console.log(`[Stripe] Event received: ${event.type}`);
  
  // Handle the event
  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdate(event.data.object);
        break;
        
      case 'customer.subscription.deleted':
        await handleSubscriptionCanceled(event.data.object);
        break;
        
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;
        
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;
        
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;
        
      default:
        console.log(`[Stripe] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error(`[Stripe] Error handling ${event.type}:`, err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
  
  res.json({ received: true });
});

// Handle subscription creation or update
async function handleSubscriptionUpdate(subscription) {
  const customerId = subscription.customer;
  const subscriptionId = subscription.id;
  const status = subscription.status;
  
  // Map Stripe price ID to tier
  const priceToTier = {
    [process.env.STRIPE_PRICE_STARTER]: 'STARTER',
    [process.env.STRIPE_PRICE_PRO]: 'PRO',
    [process.env.STRIPE_PRICE_BUSINESS]: 'BUSINESS'
  };
  
  const priceId = subscription.items.data[0]?.price?.id;
  const tier = priceToTier[priceId];
  
  if (!tier) {
    console.error(`[Stripe] Unknown price ID: ${priceId}`);
    return;
  }
  
  // Only update tier if subscription is active
  if (status === 'active' || status === 'trialing') {
    await pool.query(
      `UPDATE portal_tiers 
       SET tier = $1, 
           stripe_customer_id = $2,
           stripe_subscription_id = $3,
           stripe_subscription_status = $4,
           updated_at = NOW()
       WHERE stripe_customer_id = $2`,
      [tier, customerId, subscriptionId, status]
    );
    
    console.log(`[Stripe] ✅ Subscription updated: ${customerId} -> ${tier} (${status})`);
  } else {
    // If not active, just update status
    await pool.query(
      `UPDATE portal_tiers 
       SET stripe_subscription_status = $1,
           updated_at = NOW()
       WHERE stripe_customer_id = $2`,
      [status, customerId]
    );
    
    console.log(`[Stripe] ⚠️ Subscription status updated: ${customerId} -> ${status}`);
  }
}

// Handle subscription cancellation
async function handleSubscriptionCanceled(subscription) {
  const customerId = subscription.customer;
  
  // Downgrade to FREE tier
  await pool.query(
    `UPDATE portal_tiers 
     SET tier = 'FREE',
         stripe_subscription_id = NULL,
         stripe_subscription_status = 'canceled',
         updated_at = NOW()
     WHERE stripe_customer_id = $1`,
    [customerId]
  );
  
  console.log(`[Stripe] ⛔ Subscription canceled: ${customerId} -> FREE`);
}

// Handle payment failure
async function handlePaymentFailed(invoice) {
  const customerId = invoice.customer;
  
  // Mark subscription as past_due
  await pool.query(
    `UPDATE portal_tiers 
     SET stripe_subscription_status = 'past_due',
         updated_at = NOW()
     WHERE stripe_customer_id = $1`,
    [customerId]
  );
  
  console.log(`[Stripe] ⚠️ Payment failed: ${customerId} - marked as past_due`);
}

// Handle successful payment
async function handlePaymentSucceeded(invoice) {
  const customerId = invoice.customer;
  
  // If subscription was past_due, mark as active
  await pool.query(
    `UPDATE portal_tiers 
     SET stripe_subscription_status = 'active',
         updated_at = NOW()
     WHERE stripe_customer_id = $1 AND stripe_subscription_status = 'past_due'`,
    [customerId]
  );
  
  console.log(`[Stripe] ✅ Payment succeeded: ${customerId} - marked as active`);
}

// Handle checkout session completion (for new customers)
async function handleCheckoutCompleted(session) {
  const customerId = session.customer;
  const clientReferenceId = session.client_reference_id; // This should be the portalId
  
  if (!clientReferenceId) {
    console.error('[Stripe] No client_reference_id in checkout session');
    return;
  }
  
  // Link the stripe customer to the portal
  await pool.query(
    `UPDATE portal_tiers 
     SET stripe_customer_id = $1,
         updated_at = NOW()
     WHERE portal_id = $2`,
    [customerId, clientReferenceId]
  );
  
  console.log(`[Stripe] ✅ Checkout completed: Portal ${clientReferenceId} linked to customer ${customerId}`);
}

// API endpoint to create a checkout session (for upgrading)
router.post('/create-checkout-session', express.json(), async (req, res) => {
  const { portalId, priceId } = req.body;
  
  if (!portalId || !priceId) {
    return res.status(400).json({ error: 'Missing portalId or priceId' });
  }
  
  try {
    // Check if portal already has a customer ID
    const result = await pool.query(
      'SELECT stripe_customer_id FROM portal_tiers WHERE portal_id = $1',
      [portalId]
    );
    
    let customerId = result.rows[0]?.stripe_customer_id;
    
    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId || undefined,
      client_reference_id: portalId,
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1
      }],
      mode: 'subscription',
      success_url: `${process.env.APP_URL}/settings?upgrade=success`,
      cancel_url: `${process.env.APP_URL}/settings?upgrade=canceled`
    });
    
    res.json({ url: session.url });
    
  } catch (err) {
    console.error('[Stripe] Error creating checkout session:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// API endpoint to create a customer portal session (for managing subscription)
router.post('/create-portal-session', express.json(), async (req, res) => {
  const { portalId } = req.body;
  
  if (!portalId) {
    return res.status(400).json({ error: 'Missing portalId' });
  }
  
  try {
    const result = await pool.query(
      'SELECT stripe_customer_id FROM portal_tiers WHERE portal_id = $1',
      [portalId]
    );
    
    const customerId = result.rows[0]?.stripe_customer_id;
    
    if (!customerId) {
      return res.status(404).json({ error: 'No Stripe customer found' });
    }
    
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.APP_URL}/settings`
    });
    
    res.json({ url: session.url });
    
  } catch (err) {
    console.error('[Stripe] Error creating portal session:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
