// src/routes/paystack.js
// Paystack webhook and payment routes

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// Paystack webhook endpoint
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hash === req.headers['x-paystack-signature']) {
    const event = req.body;
    
    // Handle different event types
    switch (event.event) {
      case 'charge.success':
        console.log('[Paystack] Payment successful:', event.data);
        // Handle successful payment
        break;
      
      case 'transfer.success':
        console.log('[Paystack] Transfer successful:', event.data);
        break;
      
      case 'transfer.failed':
        console.log('[Paystack] Transfer failed:', event.data);
        break;
      
      default:
        console.log('[Paystack] Unhandled event:', event.event);
    }
    
    res.sendStatus(200);
  } else {
    res.sendStatus(400);
  }
});

// Verify payment
router.get('/verify/:reference', async (req, res) => {
  try {
    const { reference } = req.params;
    
    // Verify with Paystack API
    // Add your verification logic here
    
    res.json({ success: true, reference });
  } catch (err) {
    console.error('[Paystack] Verification error:', err.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

module.exports = router;
