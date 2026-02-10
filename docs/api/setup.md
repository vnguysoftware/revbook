# Setup & Onboarding

Base path: `/setup`

The onboarding flow is designed for fast time-to-value (working integration in under 10 minutes):

1. Create organization and get API key
2. Connect one or more billing providers
3. Verify connectivity
4. Run historical backfill
5. Check progress
6. View First Look report

---

### POST /setup/org

Create a new organization and receive an API key.

**Auth:** None (public)
**Rate Limit:** `public` (30/min per IP)

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Organization name (1-255 chars) |
| `slug` | string | Yes | URL-safe identifier (3-64 chars, lowercase alphanumeric with hyphens, cannot start/end with hyphen) |

**Response (201):**

```json
{
  "organization": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Acme Corp",
    "slug": "acme-corp",
    "settings": {},
    "createdAt": "2026-02-10T00:00:00.000Z",
    "updatedAt": "2026-02-10T00:00:00.000Z"
  },
  "apiKey": "rev_a1b2c3d4e5f6...",
  "webhookBaseUrl": "/webhooks/acme-corp",
  "nextSteps": {
    "stripe": "POST /setup/stripe with your Stripe API key",
    "apple": "POST /setup/apple with your Apple credentials",
    "docs": "https://docs.revback.io/quickstart"
  }
}
```

The `apiKey` is only returned once. Store it securely.

```bash
curl -X POST https://your-domain.com/setup/org \
  -H "Content-Type: application/json" \
  -d '{"name": "Acme Corp", "slug": "acme-corp"}'
```

---

### POST /setup/stripe

Connect a Stripe account.

**Auth:** Bearer token (API key)
**Rate Limit:** `public` (30/min per IP)
**Scope:** None (setup auth is inline)

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `stripeSecretKey` | string | Yes | Stripe secret API key (starts with `sk_`) |
| `webhookSecret` | string | No | Stripe webhook signing secret (starts with `whsec_`) |

**Response (200):**

```json
{
  "connected": true,
  "source": "stripe",
  "webhookUrl": "/webhooks/acme-corp/stripe",
  "instructions": [
    "1. Go to Stripe Dashboard -> Developers -> Webhooks",
    "2. Add endpoint: YOUR_DOMAIN/webhooks/acme-corp/stripe",
    "3. Select events: customer.subscription.*, invoice.*, charge.refunded, charge.dispute.*",
    "4. Copy the webhook signing secret and update via POST /setup/stripe"
  ]
}
```

Validates the Stripe API key by calling `stripe.customers.list({ limit: 1 })` before storing.

```bash
curl -X POST https://your-domain.com/setup/stripe \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"stripeSecretKey": "sk_live_xxx", "webhookSecret": "whsec_xxx"}'
```

---

### POST /setup/apple

Connect an Apple App Store account.

**Auth:** Bearer token
**Rate Limit:** `public`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `keyId` | string | Yes | App Store Connect API key ID |
| `issuerId` | string | Yes | App Store Connect issuer ID |
| `bundleId` | string | Yes | App bundle identifier |
| `privateKey` | string | No | Private key in PEM format (for API access verification) |
| `originalNotificationUrl` | string (URL) | No | Existing notification URL to proxy webhooks to |

**Response (200):**

```json
{
  "connected": true,
  "source": "apple",
  "webhookUrl": "/webhooks/acme-corp/apple",
  "proxyEnabled": true,
  "originalNotificationUrl": "https://your-server.com/apple-notifications",
  "instructions": [
    "1. Go to App Store Connect -> App -> App Store Server Notifications",
    "2. Set Server URL: YOUR_DOMAIN/webhooks/acme-corp/apple",
    "3. Select Version 2 notifications",
    "4. Send a test notification to verify",
    "5. Webhook proxy enabled: notifications will be forwarded to https://your-server.com/apple-notifications"
  ]
}
```

```bash
curl -X POST https://your-domain.com/setup/apple \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "keyId": "ABC123",
    "issuerId": "def456-...",
    "bundleId": "com.example.app",
    "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
  }'
```

---

### POST /setup/recurly

Connect a Recurly account.

**Auth:** Bearer token
**Rate Limit:** `public`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `apiKey` | string | Yes | Recurly API key |
| `subdomain` | string | Yes | Recurly subdomain |
| `webhookKey` | string | No | Webhook signing key |

**Response (200):**

```json
{
  "connected": true,
  "source": "recurly",
  "webhookUrl": "/webhooks/acme-corp/recurly",
  "instructions": [
    "1. Go to Recurly Dashboard -> Developers -> Webhooks",
    "2. Add endpoint URL: YOUR_DOMAIN/webhooks/acme-corp/recurly",
    "3. Select notification types: all subscription and account notifications",
    "4. Copy the webhook signing key and include it as webhookKey when connecting"
  ]
}
```

Validates the API key by calling the Recurly accounts API before storing.

```bash
curl -X POST https://your-domain.com/setup/recurly \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "your_recurly_api_key", "subdomain": "acme"}'
```

---

### POST /setup/google

Connect a Google Play account.

**Auth:** Bearer token
**Rate Limit:** `public`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `packageName` | string | Yes | Android app package name (e.g., `com.example.app`) |
| `serviceAccountJson` | string | Yes | Google Cloud service account JSON (stringified). Must contain `client_email` and `private_key`. |

**Response (200):**

```json
{
  "connected": true,
  "source": "google",
  "webhookUrl": "/webhooks/acme-corp/google",
  "instructions": [
    "1. Go to Google Cloud Console -> Pub/Sub -> Topics",
    "2. Create a topic (or use the existing one for your app)",
    "3. Create a push subscription with endpoint:",
    "   YOUR_DOMAIN/webhooks/acme-corp/google",
    "4. In Google Play Console -> Monetization Setup -> Real-time developer notifications",
    "5. Set the topic name to your Pub/Sub topic",
    "6. For push authentication, configure the Pub/Sub subscription with an OAuth audience",
    "7. Set the webhook secret in your billing connection to the audience URL"
  ]
}
```

Validates credentials by generating a JWT and testing the OAuth2 token exchange.

```bash
curl -X POST https://your-domain.com/setup/google \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "packageName": "com.example.app",
    "serviceAccountJson": "{\"client_email\":\"...\",\"private_key\":\"...\"}"
  }'
```

---

### POST /setup/verify/stripe

Verify Stripe connectivity by testing API access.

**Auth:** Bearer token
**Rate Limit:** `public`

**Response (200):**

```json
{
  "source": "stripe",
  "verified": true,
  "checks": {
    "apiKeyValid": true,
    "webhookSecretConfigured": true,
    "canListCustomers": true,
    "canListSubscriptions": true,
    "customerCount": -1,
    "subscriptionCount": -1,
    "error": null
  },
  "message": "Stripe API key is valid and working"
}
```

A `customerCount` or `subscriptionCount` of `-1` means "more than one" (Stripe does not expose total counts).

```bash
curl -X POST https://your-domain.com/setup/verify/stripe \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### POST /setup/verify/apple

Verify Apple credentials by testing JWT generation.

**Auth:** Bearer token
**Rate Limit:** `public`

**Response (200):**

```json
{
  "source": "apple",
  "verified": true,
  "checks": {
    "credentialsStored": true,
    "hasKeyId": true,
    "hasIssuerId": true,
    "hasBundleId": true,
    "hasPrivateKey": true,
    "proxyConfigured": false,
    "originalNotificationUrl": null,
    "apiTestResult": "JWT generation successful (credentials are valid)",
    "error": null
  },
  "message": "Apple credentials are configured and valid"
}
```

```bash
curl -X POST https://your-domain.com/setup/verify/apple \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### POST /setup/verify/recurly

Verify Recurly API key and connectivity.

**Auth:** Bearer token
**Rate Limit:** `public`

**Response (200):**

```json
{
  "source": "recurly",
  "verified": true,
  "checks": {
    "apiKeyValid": true,
    "webhookKeyConfigured": false,
    "canListAccounts": true,
    "canListSubscriptions": true,
    "accountCount": -1,
    "subscriptionCount": -1,
    "error": null
  },
  "message": "Recurly API key is valid and working"
}
```

```bash
curl -X POST https://your-domain.com/setup/verify/recurly \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### POST /setup/verify/google

Verify Google Play service account credentials and OAuth2 token exchange.

**Auth:** Bearer token
**Rate Limit:** `public`

**Response (200):**

```json
{
  "source": "google",
  "verified": true,
  "checks": {
    "credentialsValid": true,
    "canGenerateToken": true,
    "canCallApi": true,
    "error": null
  },
  "message": "Google Play credentials are valid and working"
}
```

```bash
curl -X POST https://your-domain.com/setup/verify/google \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### GET /setup/status

Check integration health across all connected billing providers.

**Auth:** Bearer token
**Rate Limit:** `public`

**Response (200):**

```json
{
  "integrations": [
    {
      "source": "stripe",
      "connected": true,
      "lastWebhookAt": "2026-02-10T12:00:00.000Z",
      "lastWebhookFreshness": "5 minutes ago",
      "hasWebhookSecret": true,
      "webhookDeliveryRate24h": 142,
      "syncStatus": "complete",
      "lastSyncAt": "2026-02-10T10:00:00.000Z",
      "credentialStatus": "valid",
      "status": "healthy"
    }
  ],
  "stats": {
    "eventsProcessed": 15420,
    "usersTracked": 3200,
    "openIssues": 12,
    "eventsToday": 87
  },
  "readiness": {
    "hasConnection": true,
    "hasEvents": true,
    "hasUsers": true,
    "isReady": true
  },
  "backfill": {
    "stripe": { "status": "complete", "imported": 5000 },
    "recurly": null,
    "google": null
  }
}
```

Integration `status` values: `"awaiting_first_webhook"`, `"healthy"` (webhook in last 24h), `"stale"` (no webhook in 24h+).

```bash
curl https://your-domain.com/setup/status \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### POST /setup/backfill/stripe

Start importing historical data from Stripe. Runs in the background.

**Auth:** Bearer token
**Rate Limit:** `public`

**Request Body:** None

**Response (200):**

```json
{
  "jobId": "backfill_550e8400..._1707523200000",
  "status": "started",
  "message": "Historical data import has started. Check /setup/backfill/progress for real-time updates.",
  "progressUrl": "/setup/backfill/progress",
  "estimatedTime": "5-15 minutes depending on data volume"
}
```

Returns 409 if a backfill is already in progress.

```bash
curl -X POST https://your-domain.com/setup/backfill/stripe \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### POST /setup/backfill/recurly

Start importing historical data from Recurly. Runs in the background.

**Auth:** Bearer token
**Rate Limit:** `public`

**Request Body:** None

**Response:** Same format as Stripe backfill.

```bash
curl -X POST https://your-domain.com/setup/backfill/recurly \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### POST /setup/backfill/google

Start importing historical data from Google Play. Optionally accepts specific purchase tokens.

**Auth:** Bearer token
**Rate Limit:** `public`

**Request Body (optional):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `purchaseTokens` | string[] | No | Specific purchase tokens to import. If omitted, imports voided purchases. |

**Response (200):**

```json
{
  "jobId": "backfill_google_550e8400..._1707523200000",
  "status": "started",
  "message": "Importing 5 purchase tokens from Google Play. Check /setup/backfill/progress for real-time updates.",
  "progressUrl": "/setup/backfill/progress",
  "estimatedTime": "2-10 minutes depending on data volume"
}
```

```bash
curl -X POST https://your-domain.com/setup/backfill/google \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"purchaseTokens": ["token1", "token2"]}'
```

---

### GET /setup/backfill/progress

Check real-time progress of all running backfills.

**Auth:** Bearer token
**Rate Limit:** `public`

**Response (200):**

```json
{
  "stripe": {
    "status": "importing_subscriptions",
    "imported": 2500,
    "total": 5000,
    "errors": 0
  },
  "recurly": null,
  "google": null
}
```

If no backfill has been started:

```json
{
  "status": "not_started",
  "message": "No backfill has been started. Run POST /setup/backfill/stripe, /setup/backfill/recurly, or /setup/backfill/google to begin."
}
```

```bash
curl https://your-domain.com/setup/backfill/progress \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### GET /setup/security-info

Static security documentation for enterprise review.

**Auth:** None (public)
**Rate Limit:** `public`

Returns detailed security information covering: data protection (encryption at rest/in transit, credential storage), access control (authentication, authorization, multi-tenancy), data retention policies, compliance status (SOC 2, GDPR, CCPA), network security, and incident response contacts.

```bash
curl https://your-domain.com/setup/security-info
```
