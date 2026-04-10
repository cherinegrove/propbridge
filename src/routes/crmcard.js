// src/routes/crmcard.js
// HubSpot CRM Card - shows on Contact, Company, Deal, Ticket records
const express = require('express');
const router  = express.Router();

// GET /crm-card
// HubSpot calls this when a record page loads to get the card content
router.get('/', async (req, res) => {
  const { portalId, userId, associatedObjectId, associatedObjectType } = req.query;

  console.log(`[CRM Card] Portal ${portalId}, Object ${associatedObjectType} ${associatedObjectId}`);

  const settingsUrl = `${process.env.APP_BASE_URL}/settings?portalId=${portalId}`;

  try {
    // Try to get sync rules for this portal
    const settingsRoute = require('./settings');
    const rules = (settingsRoute.rulesStore[portalId] || []);
    const activeRules = rules.filter(r => r.enabled);
    const relevantRules = activeRules.filter(r =>
      r.sourceObject === associatedObjectType?.toLowerCase() ||
      r.targetObject === associatedObjectType?.toLowerCase()
    );

    // Build card response
    const card = {
      results: [
        {
          objectId: parseInt(associatedObjectId),
          title: "SyncStation Sync Status",
          properties: [
            {
              label: "Active Sync Rules",
              dataType: "STRING",
              value: activeRules.length > 0 ? `${activeRules.length} rule${activeRules.length !== 1 ? 's' : ''} active` : "No active rules"
            },
            {
              label: "Rules for this object",
              dataType: "STRING",
              value: relevantRules.length > 0
                ? relevantRules.map(r => r.name || `${r.sourceObject} → ${r.targetObject}`).join(', ')
                : "No rules configured for this object type"
            },
            {
              label: "Sync Direction",
              dataType: "STRING",
              value: relevantRules.length > 0
                ? relevantRules.map(r => r.direction === 'two_way' ? '⇄ Bidirectional' : '→ One-way').join(', ')
                : "—"
            },
            {
              label: "Property Mappings",
              dataType: "STRING",
              value: relevantRules.length > 0
                ? `${relevantRules.reduce((sum, r) => sum + (r.mappings?.length || 0), 0)} total mappings`
                : "—"
            }
          ],
          actions: [
            {
              type: "IFRAME",
              width: 890,
              height: 748,
              uri: settingsUrl,
              label: "⚙ Manage Sync Rules"
            }
          ]
        }
      ],
      primaryAction: {
        type: "IFRAME",
        width: 890,
        height: 748,
        uri: settingsUrl,
        label: "Manage Sync Rules"
      }
    };

    res.json(card);
  } catch (err) {
    console.error('[CRM Card] Error:', err.message);

    // Return a basic card even if there's an error
    res.json({
      results: [
        {
          objectId: parseInt(associatedObjectId),
          title: "SyncStation",
          properties: [
            {
              label: "Status",
              dataType: "STRING",
              value: "Click 'Manage Sync Rules' to configure property syncing"
            }
          ],
          actions: [
            {
              type: "IFRAME",
              width: 890,
              height: 748,
              uri: settingsUrl,
              label: "⚙ Manage Sync Rules"
            }
          ]
        }
      ]
    });
  }
});

module.exports = router;
