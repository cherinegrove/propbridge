// =====================================================
// HUBSPOT OAUTH ROUTES
// =====================================================

const express     = require('express');
const router      = express.Router();
const axios       = require('axios');
const pool        = require('../services/database');
const authService = require('../services/authService');

const {
    HUBSPOT_CLIENT_ID,
    HUBSPOT_CLIENT_SECRET,
    APP_URL
} = process.env;

const REDIRECT_URI = `${APP_URL}/oauth/callback`;

const SCOPES = [
    'crm.objects.contacts.read',
    'crm.objects.contacts.write',
    'crm.objects.companies.read',
    'crm.objects.companies.write',
    'crm.schemas.contacts.read',
    'crm.schemas.contacts.write',
    'crm.schemas.companies.read',
    'crm.schemas.companies.write',
    'oauth'
].join(' ');

// ── /oauth/install ─────────────────────────────────────────────────────────────
// Redirect user to HubSpot's consent screen

router.get('/install', (req, res) => {
    const authUrl = new URL('https://app.hubspot.com/oauth/authorize');
    authUrl.searchParams.set('client_id',     HUBSPOT_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri',  REDIRECT_URI);
    authUrl.searchParams.set('scope',         SCOPES);
    res.redirect(authUrl.toString());
});

// ── /oauth/callback ────────────────────────────────────────────────────────────
// HubSpot redirects here after the user grants access

router.get('/callback', async (req, res) => {
    const { code, error } = req.query;

    if (error || !code) {
        console.error('[OAuth] HubSpot error:', error);
        return res.redirect('/settings?error=oauth_denied');
    }

    try {
        // 1. Exchange code for tokens
        const tokenRes = await axios.post(
            'https://api.hubapi.com/oauth/v1/token',
            new URLSearchParams({
                grant_type:    'authorization_code',
                client_id:     HUBSPOT_CLIENT_ID,
                client_secret: HUBSPOT_CLIENT_SECRET,
                redirect_uri:  REDIRECT_URI,
                code
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { access_token, refresh_token, expires_in } = tokenRes.data;

        // 2. Get portal info from HubSpot
        const infoRes = await axios.get(
            'https://api.hubapi.com/oauth/v1/access-tokens/' + access_token
        );

        const portalId   = String(infoRes.data.hub_id);
        const hubDomain  = infoRes.data.hub_domain || '';
        const expiresAt  = new Date(Date.now() + expires_in * 1000);

        console.log(`[OAuth] Callback for portal ${portalId}`);

        // 3. Upsert tokens in DB
        await pool.query(
            `INSERT INTO hubspot_tokens
                (portal_id, access_token, refresh_token, expires_at, hub_domain)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (portal_id) DO UPDATE
               SET access_token  = EXCLUDED.access_token,
                   refresh_token = EXCLUDED.refresh_token,
                   expires_at    = EXCLUDED.expires_at,
                   hub_domain    = EXCLUDED.hub_domain,
                   updated_at    = NOW()`,
            [portalId, access_token, refresh_token, expiresAt, hubDomain]
        );

        // 4. Auto-link the logged-in user to this portal
        //    The session cookie is set by the client auth system
        const sessionToken = req.cookies?.sessionToken;
        let linkedUserId   = null;

        if (sessionToken) {
            try {
                const userSession = await authService.verifySession(sessionToken);
                await authService.linkUserToPortal(userSession.userId, portalId, 'owner');
                linkedUserId = userSession.userId;
                console.log(`[OAuth] Linked user ${userSession.userId} → portal ${portalId}`);
            } catch (linkErr) {
                // Not fatal — user may not be logged in (install from marketplace, etc.)
                console.log('[OAuth] Could not link user to portal:', linkErr.message);
            }
        } else {
            console.log('[OAuth] No session cookie — portal connected without user link');
        }

        // 5. Redirect to settings for this portal
        const redirectUrl = `/settings?portalId=${portalId}&connected=1`;
        res.redirect(redirectUrl);

    } catch (err) {
        console.error('[OAuth] Callback error:', err.response?.data || err.message);
        res.redirect('/settings?error=oauth_failed');
    }
});

// ── /oauth/disconnect ──────────────────────────────────────────────────────────
// Remove HubSpot tokens for a portal (owner only)

router.post('/disconnect', async (req, res) => {
    const { portalId } = req.body;
    if (!portalId) return res.status(400).json({ error: 'portalId required' });

    try {
        await pool.query('DELETE FROM hubspot_tokens WHERE portal_id = $1', [String(portalId)]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
