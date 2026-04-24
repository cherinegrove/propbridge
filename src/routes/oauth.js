// =====================================================
// HUBSPOT OAUTH ROUTES
// =====================================================

const express     = require('express');
const router      = express.Router();
const axios       = require('axios');
const pool        = require('../services/database');
const authService = require('../services/authService');

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

// Compute at request time so env vars are always resolved
function getRedirectUri() {
    const base = process.env.APP_BASE_URL || process.env.APP_URL || '';
    return `${base}/oauth/callback`;
}

// ── /oauth/install ─────────────────────────────────────────────────────────────

router.get('/install', (req, res) => {
    const redirectUri = getRedirectUri();
    console.log('[OAuth] install — redirect_uri:', redirectUri);

    // Use EU HubSpot endpoint (app-eu1) to match your HubSpot account region
    const authUrl = new URL('https://app-eu1.hubspot.com/oauth/authorize');
    authUrl.searchParams.set('client_id',    process.env.HUBSPOT_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope',        SCOPES);
    res.redirect(authUrl.toString());
});

// ── /oauth/callback ────────────────────────────────────────────────────────────

router.get('/callback', async (req, res) => {
    const { code, error } = req.query;

    if (error || !code) {
        console.error('[OAuth] HubSpot error:', error);
        return res.redirect('/settings?error=oauth_denied');
    }

    try {
        const redirectUri = getRedirectUri();

        // 1. Exchange code for tokens
        const tokenRes = await axios.post(
            'https://api.hubapi.com/oauth/v1/token',
            new URLSearchParams({
                grant_type:    'authorization_code',
                client_id:     process.env.HUBSPOT_CLIENT_ID,
                client_secret: process.env.HUBSPOT_CLIENT_SECRET,
                redirect_uri:  redirectUri,
                code
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { access_token, refresh_token, expires_in } = tokenRes.data;

        // 2. Get portal info from HubSpot
        const infoRes = await axios.get(
            'https://api.hubapi.com/oauth/v1/access-tokens/' + access_token
        );

        const portalId  = String(infoRes.data.hub_id);
        const hubDomain = infoRes.data.hub_domain || '';
        const expiresAt = new Date(Date.now() + expires_in * 1000);

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
        const sessionToken = req.cookies?.sessionToken;
        if (sessionToken) {
            try {
                const userSession = await authService.verifySession(sessionToken);
                await authService.linkUserToPortal(userSession.userId, portalId, 'owner');
                console.log(`[OAuth] Linked user ${userSession.userId} → portal ${portalId}`);
            } catch (linkErr) {
                console.log('[OAuth] Could not link user to portal:', linkErr.message);
            }
        } else {
            console.log('[OAuth] No session cookie — portal connected without user link');
        }

        // 5. Redirect to settings
        res.redirect(`/settings?portalId=${portalId}&connected=1`);

    } catch (err) {
        console.error('[OAuth] Callback error:', err.response?.data || err.message);
        res.redirect('/settings?error=oauth_failed');
    }
});

// ── /oauth/disconnect ──────────────────────────────────────────────────────────

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
