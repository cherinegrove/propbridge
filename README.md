# HubSpot Property Sync — Public App

A HubSpot Public App that adds a **"Sync Object Properties"** custom action to the workflow builder. Users can sync property values between associated CRM objects (Contact ↔ Company, Contact ↔ Deal, etc.) with full control over direction and which properties to map.

---

## How it works

1. User installs your app from the HubSpot Marketplace (or your install link)
2. OAuth grants your server access to their portal
3. User builds a workflow and adds the **"Sync Object Properties"** action
4. They configure it directly in the workflow UI:
   - Source & target object types
   - Sync direction (one-way or bidirectional)
   - Property mappings
   - Whether to skip non-empty values
5. HubSpot calls your `/action/execute` endpoint each time the action fires

---

## Project structure

```
hubspot-sync-app/
├── src/
│   ├── index.js                  # Express app entry point
│   ├── routes/
│   │   ├── oauth.js              # /oauth/install  /oauth/callback
│   │   └── action.js             # /action/execute  /action/fields
│   ├── services/
│   │   ├── hubspotClient.js      # OAuth exchange, token refresh, client factory
│   │   ├── syncService.js        # Core sync logic
│   │   └── tokenStore.js         # Token persistence (swap for DB in prod)
│   └── middleware/
│       └── verifyHubSpot.js      # Signature verification
└── scripts/
    └── registerAction.js         # One-time action registration script
```

---

## Setup

### 1. Create a HubSpot Public App

1. Go to [app.hubspot.com/developer](https://app.hubspot.com/developer) → **Apps → Create app**
2. Under **Auth**, set your redirect URL to: `https://your-domain.com/oauth/callback`
3. Add these scopes:
   - `crm.objects.contacts.read` + `.write`
   - `crm.objects.companies.read` + `.write`
   - `crm.objects.deals.read` + `.write`
   - `crm.objects.tickets.read` + `.write`
   - `crm.associations.read` + `.write`
   - `automation`
4. Note your **App ID**, **Client ID**, and **Client Secret**

### 2. Configure environment

```bash
cp .env.example .env
# Fill in HUBSPOT_CLIENT_ID, HUBSPOT_CLIENT_SECRET, HUBSPOT_APP_ID,
# HUBSPOT_DEVELOPER_API_KEY, and APP_BASE_URL
```

### 3. Install dependencies

```bash
npm install
```

### 4. Deploy your server

The server must be publicly accessible (HTTPS required by HubSpot).

**Quick options:**
- [Railway](https://railway.app) — push to deploy, free tier available
- [Render](https://render.com) — similar, easy Node.js deploys
- [Heroku](https://heroku.com)

For **local development**, use [ngrok](https://ngrok.com):
```bash
ngrok http 3000
# Copy the https URL into APP_BASE_URL in your .env
```

### 5. Register the custom workflow action

Run this **once** after your server is live:

```bash
npm run register-action
```

This tells HubSpot about your action, its input fields, and its webhook URL. Re-run if you change the field definitions.

---

## Controlling sync frequency

Frequency is set in the **Workflow settings**, not in code:

| Frequency | How to set it |
|-----------|--------------|
| Real-time | Trigger on "Property value changes" for any mapped property + enable re-enrollment |
| Hourly / Daily | Add a **Delay** step before the sync action, or use a Scheduled workflow |
| On-demand | Enroll records manually or via the [Enrollments API](https://developers.hubspot.com/docs/api/automation/workflow-enrollment) |

---

## Workflow action fields

| Field | Type | Description |
|-------|------|-------------|
| Source object type | Dropdown | The enrolled object (e.g. Contact) |
| Target object type | Dropdown | The object to sync to (e.g. Company) |
| Sync direction | Dropdown | `one_way` or `two_way` |
| Property mappings | Text | `source_prop:target_prop` pairs, comma-separated |
| Skip if target has value | Checkbox | Never overwrite existing target values |

### Output tokens (usable in later workflow steps)

| Token | Value |
|-------|-------|
| `sync_status` | `success` / `no_targets` / `error` |
| `targets_updated` | Number of records changed |
| `sync_summary` | JSON array with per-target details |
| `sync_error` | Error message if status is `error` |

---

## Production checklist

- [ ] Replace in-memory `tokenStore` with a real database (Postgres, Redis, etc.)
- [ ] Set `TOKEN_STORE=file` as a minimum for single-server deploys
- [ ] Set up HTTPS (required by HubSpot for OAuth and action URLs)
- [ ] Add proper logging (e.g. Winston, Datadog)
- [ ] Tighten the rate limiter in `src/index.js`
- [ ] Submit your app to the HubSpot Marketplace

---

## Local development

```bash
# Start the server with hot-reload
npm run dev

# In another terminal, expose it publicly
ngrok http 3000

# Update APP_BASE_URL in .env with the ngrok URL, then re-register
npm run register-action
```
