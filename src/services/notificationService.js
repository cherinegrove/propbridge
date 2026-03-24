// src/services/notificationService.js
const { Pool } = require('pg');
const axios = require('axios');

let pool = null;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        portal_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'info',
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        action_label TEXT,
        action_url TEXT,
        status TEXT NOT NULL DEFAULT 'unread',
        created_at TIMESTAMP DEFAULT NOW(),
        read_at TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS notification_rules (
        id SERIAL PRIMARY KEY,
        trigger_type TEXT NOT NULL,
        threshold INTEGER,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'warning',
        action_label TEXT,
        action_url TEXT,
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS notifications_portal_id ON notifications(portal_id);
      CREATE INDEX IF NOT EXISTS notifications_status ON notifications(status);
    `).then(() => console.log('[Notifications] Tables ready'))
      .catch(err => console.error('[Notifications] Table error:', err.message));
  }
  return pool;
}

// Create a notification for a portal
async function createNotification(portalId, { type, title, message, actionLabel, actionUrl }) {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(
      `INSERT INTO notifications (portal_id, type, title, message, action_label, action_url)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [String(portalId), type || 'info', title, message, actionLabel || null, actionUrl || null]
    );
    console.log(`[Notifications] Created notification for portal ${portalId}: ${title}`);
  } catch (err) {
    console.error('[Notifications] Create error:', err.message);
  }
}

// Get unread notifications for a portal
async function getNotifications(portalId, includeRead = false) {
  const p = getPool();
  if (!p) return [];
  try {
    const query = includeRead
      ? 'SELECT * FROM notifications WHERE portal_id = $1 ORDER BY created_at DESC LIMIT 20'
      : 'SELECT * FROM notifications WHERE portal_id = $1 AND status = $2 ORDER BY created_at DESC';
    const params = includeRead ? [String(portalId)] : [String(portalId), 'unread'];
    const result = await p.query(query, params);
    return result.rows;
  } catch (err) {
    console.error('[Notifications] Get error:', err.message);
    return [];
  }
}

// Mark notification as read
async function markRead(notificationId) {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(
      'UPDATE notifications SET status = $1, read_at = NOW() WHERE id = $2',
      ['read', notificationId]
    );
  } catch (err) {
    console.error('[Notifications] Mark read error:', err.message);
  }
}

// Mark all notifications as read for a portal
async function markAllRead(portalId) {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(
      'UPDATE notifications SET status = $1, read_at = NOW() WHERE portal_id = $2 AND status = $3',
      ['read', String(portalId), 'unread']
    );
  } catch (err) {
    console.error('[Notifications] Mark all read error:', err.message);
  }
}

// Send email via Resend
async function sendEmail(to, subject, html) {
  if (!process.env.RESEND_API_KEY) {
    console.log('[Email] No RESEND_API_KEY set, skipping email');
    return;
  }
  try {
    await axios.post('https://api.resend.com/emails', {
      from: process.env.RESEND_FROM_EMAIL || 'PropBridge <noreply@resend.dev>',
      to,
      subject,
      html
    }, {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }
    });
    console.log(`[Email] Sent to ${to}: ${subject}`);
  } catch (err) {
    console.error('[Email] Send error:', err.response?.data || err.message);
  }
}

// Send notification to portal (in-app + optionally email)
async function notify(portalId, notification, emailTo = null) {
  await createNotification(portalId, notification);
  if (emailTo) {
    await sendEmail(
      emailTo,
      notification.title,
      `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:40px">
        <h2 style="color:#ff6b35">⇄ PropBridge</h2>
        <h3>${notification.title}</h3>
        <p>${notification.message}</p>
        ${notification.actionLabel && notification.actionUrl
          ? `<a href="${notification.actionUrl}" style="background:#ff6b35;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;margin-top:16px">${notification.actionLabel}</a>`
          : ''}
        <p style="color:#999;margin-top:32px;font-size:12px">PropBridge — HubSpot Property Sync</p>
      </div>`
    );
  }
}

// Get all notifications (admin view)
async function getAllNotifications(limit = 100) {
  const p = getPool();
  if (!p) return [];
  try {
    const result = await p.query(
      'SELECT * FROM notifications ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return result.rows;
  } catch (err) {
    console.error('[Notifications] Get all error:', err.message);
    return [];
  }
}

// Run automated notification checks
async function runAutomatedChecks() {
  const p = getPool();
  if (!p) return;

  try {
    const { getAllPortals } = require('./tierService');
    const { getRules }     = require('../routes/settings');
    const portals = await getAllPortals();

    for (const portal of portals) {
      const portalId  = portal.portal_id;
      const tier      = portal.tier;
      const rules     = await getRules(portalId);
      const { TIERS } = require('./tierService');
      const tierInfo  = TIERS[tier] || TIERS.trial;

      // Check usage > 90%
      const usagePct = (rules.length / tierInfo.maxRules) * 100;
      if (usagePct >= 90 && usagePct < 100) {
        // Check if we already sent this recently
        const recent = await p.query(
          `SELECT id FROM notifications WHERE portal_id = $1 AND type = 'warning' 
           AND title LIKE '%90%' AND created_at > NOW() - INTERVAL '7 days'`,
          [portalId]
        );
        if (!recent.rows.length) {
          await notify(portalId, {
            type: 'warning',
            title: "You've used 90% of your sync rules",
            message: `You're using ${rules.length} of ${tierInfo.maxRules} sync rules on your ${tierInfo.name} plan. Upgrade to avoid hitting your limit.`,
            actionLabel: 'Upgrade Now',
            actionUrl: `/account?portalId=${portalId}`
          });
        }
      }

      // Check trial expiring in 3 days
      if (tier === 'trial') {
        const daysSince = (Date.now() - new Date(portal.trial_started_at).getTime()) / 86400000;
        const daysLeft  = 14 - daysSince;
        if (daysLeft <= 3 && daysLeft > 0) {
          const recent = await p.query(
            `SELECT id FROM notifications WHERE portal_id = $1 AND type = 'warning'
             AND title LIKE '%trial%' AND created_at > NOW() - INTERVAL '3 days'`,
            [portalId]
          );
          if (!recent.rows.length) {
            await notify(portalId, {
              type: 'warning',
              title: `Your free trial expires in ${Math.ceil(daysLeft)} day${Math.ceil(daysLeft) !== 1 ? 's' : ''}`,
              message: 'Upgrade now to keep your sync rules active after your trial ends.',
              actionLabel: 'View Plans',
              actionUrl: `/account?portalId=${portalId}`
            });
          }
        }

        // Trial expired
        if (daysSince >= 14) {
          const recent = await p.query(
            `SELECT id FROM notifications WHERE portal_id = $1 AND type = 'error'
             AND title LIKE '%expired%' AND created_at > NOW() - INTERVAL '7 days'`,
            [portalId]
          );
          if (!recent.rows.length) {
            await notify(portalId, {
              type: 'error',
              title: 'Your free trial has expired',
              message: 'Your sync rules are now paused. Upgrade to reactivate PropBridge.',
              actionLabel: 'Upgrade Now',
              actionUrl: `/account?portalId=${portalId}`
            });
          }
        }
      }
    }
    console.log('[Notifications] Automated checks complete');
  } catch (err) {
    console.error('[Notifications] Automated check error:', err.message);
  }
}

module.exports = {
  createNotification,
  getNotifications,
  markRead,
  markAllRead,
  sendEmail,
  notify,
  getAllNotifications,
  runAutomatedChecks
};
