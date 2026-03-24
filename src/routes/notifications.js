// src/routes/notifications.js
const express = require('express');
const router  = express.Router();
const { getNotifications, markRead, markAllRead } = require('../services/notificationService');

// GET /notifications?portalId=xxx
router.get('/', async (req, res) => {
  const { portalId } = req.query;
  if (!portalId) return res.status(400).json({ error: 'Missing portalId' });
  const notifications = await getNotifications(portalId);
  res.json({ notifications });
});

// POST /notifications/:id/read
router.post('/:id/read', async (req, res) => {
  await markRead(req.params.id);
  res.json({ ok: true });
});

// POST /notifications/read-all
router.post('/read-all', async (req, res) => {
  const { portalId } = req.body;
  if (!portalId) return res.status(400).json({ error: 'Missing portalId' });
  await markAllRead(portalId);
  res.json({ ok: true });
});

module.exports = router;
