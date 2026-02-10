# RevBack API Reference

**Version:** 0.1.0
**Base URL:** `https://your-domain.com`

---

## Table of Contents

- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Error Format](#error-format)
- [API Key Scopes](#api-key-scopes)
- [Health & Readiness](#health--readiness)
- [Setup & Onboarding](#setup--onboarding)
- [Webhooks (Ingestion)](#webhooks-ingestion)
- [Issues](#issues)
- [AI Investigation](#ai-investigation)
- [Users](#users)
- [Dashboard](#dashboard)
- [First Look Report](#first-look-report)
- [Alerts](#alerts)
- [Access Checks (SDK)](#access-checks-sdk)
- [Data Management (GDPR)](#data-management-gdpr)
- [Admin: Scans](#admin-scans)
- [Admin: Queue Monitor](#admin-queue-monitor)
- [Admin: Dead Letter Queue](#admin-dead-letter-queue)
- [Admin: Circuit Breakers](#admin-circuit-breakers)

---

## Authentication

All `/api/v1/*` endpoints require API key authentication via the `Authorization` header.

```
Authorization: Bearer rev_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

API keys are issued during organization creation (`POST /setup/org`). Keys are prefixed with `rev_` and are hashed with SHA-256 before storage. The full key is only returned once at creation time.

**Setup routes** (`/setup/*`) use the same API key auth for all endpoints except `POST /setup/org` (which creates the org and returns the key) and `GET /setup/security-info` (public).

**Webhook routes** (`/webhooks/*`) do not use API key auth. They rely on provider-specific signature verification (e.g., Stripe webhook signing secret).

### Auth Error Responses

| Status | Body | Meaning |
|--------|------|---------|
| `401` | `{"error": "Missing or invalid Authorization header"}` | No `Authorization: Bearer ...` header |
| `401` | `{"error": "Invalid API key format"}` | Key does not start with `rev_` |
| `401` | `{"error": "Invalid API key"}` | Key not found in database |
| `401` | `{"error": "API key expired"}` | Key has passed its `expiresAt` date |
| `403` | `{"error": "Insufficient permissions", "requiredScope": "issues:write"}` | Key lacks the required scope |

---

## Rate Limiting

Rate limiting uses a token bucket algorithm. Limits are per organization (API tier), per org slug (webhook tier), or per IP address (public tier).

| Tier | Applies To | Limit | Window |
|------|-----------|-------|--------|
| `api` | All `/api/v1/*` routes | 100 requests | Per minute, per org |
| `webhook` | All `/webhooks/*` routes | 500 requests | Per minute, per org slug |
| `public` | All `/setup/*` routes | 30 requests | Per minute, per IP |

### Rate Limit Headers

| Header | Description |
|--------|-------------|
| `X-RateLimit-Remaining` | Tokens remaining in the current window |
| `Retry-After` | Seconds to wait before retrying (only on 429) |

### Rate Limit Error

```json
// HTTP 429
{
  "error": "Rate limit exceeded"
}
```

The rate limiter fails open: if Redis is unavailable, requests are allowed through.

---

## Error Format

All error responses follow this structure:

```json
{
  "error": "Human-readable error message",
  "details": { ... },
  "message": "Additional context (dev mode only)"
}
```

- `error` (string): Always present. Short description of the error.
- `details` (object, optional): Zod validation field errors when request body is invalid.
- `message` (string, optional): Stack trace or internal message, only present when `NODE_ENV !== 'production'`.

### Common HTTP Status Codes

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `201` | Resource created |
| `202` | Accepted (async processing started) |
| `400` | Bad request / validation error |
| `401` | Authentication failed |
| `403` | Insufficient permissions (scope check) |
| `404` | Resource not found |
| `409` | Conflict (duplicate slug, backfill already running) |
| `429` | Rate limit exceeded |
| `500` | Internal server error |
| `503` | Service unavailable (health check failure) |

---

## API Key Scopes

Scopes control what operations an API key can perform. An empty scopes array grants full access (backward compatibility for keys created before the scope system).

| Scope | Description |
|-------|-------------|
| `*` | Wildcard, grants all permissions |
| `issues:read` | Read issues, summaries, investigations, insights, incidents, detector health |
| `issues:write` | Acknowledge, resolve, dismiss issues; submit feedback |
| `alerts:read` | List alert configs, view delivery history, reveal signing secrets |
| `alerts:write` | Create, update, delete alert configs; send test alerts |
| `admin:read` | View scan history, schedules, queue health, DLQ, circuit breakers; export user data |
| `admin:write` | Trigger scans, retry DLQ jobs, delete user data (GDPR) |
| `setup:write` | Connect billing providers, run backfills |
| `access-checks:read` | List access checks, view stats |
| `access-checks:write` | Report access checks (single, batch, test) |
| `dashboard:read` | Revenue impact, event feed, entitlement health, trends, first look report |
| `users:read` | List/search users, view profiles, timelines, entitlements, identities |

Scope rules:
- `issues:write` does NOT imply `issues:read` -- grant both if needed.
- Empty scopes array = full access (backward compatibility).

---

## Health & Readiness

These endpoints require no authentication. They are designed for load balancers and Kubernetes probes.

### GET /health

Full health check with component status.

**Auth:** None
**Rate Limit:** None

**Response:**

```json
{
  "status": "ok",
  "version": "0.1.0",
  "components": {
    "database": "ok",
    "redis": "ok"
  }
}
```

- `status`: `"ok"` (all components healthy), `"degraded"` (some components down), or `"unhealthy"` (all components down).
- Returns HTTP 503 when `status` is `"unhealthy"`.

```bash
curl https://your-domain.com/health
```

### GET /ready

Kubernetes readiness probe. Returns 200 only when ALL components are up.

**Auth:** None
**Rate Limit:** None

**Response (healthy):**

```json
// HTTP 200
{
  "ready": true
}
```

**Response (not ready):**

```json
// HTTP 503
{
  "ready": false,
  "components": {
    "database": "ok",
    "redis": "error"
  }
}
```

```bash
curl https://your-domain.com/ready
```

---

## Setup & Onboarding

Base path: `/setup`

The onboarding flow is designed for fast time-to-value (working integration in under 10 minutes):

1. Create organization and get API key
2. Connect one or more billing providers
3. Verify connectivity
4. Run historical backfill
5. Check progress
6. View First Look report

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

### GET /setup/security-info

Static security documentation for enterprise review.

**Auth:** None (public)
**Rate Limit:** `public`

Returns detailed security information covering: data protection (encryption at rest/in transit, credential storage), access control (authentication, authorization, multi-tenancy), data retention policies, compliance status (SOC 2, GDPR, CCPA), network security, and incident response contacts.

```bash
curl https://your-domain.com/setup/security-info
```

---

## Webhooks (Ingestion)

Base path: `/webhooks`

Webhook endpoints receive billing events from providers. They use provider-specific signature verification (not API key auth).

**Design:** Signature is verified BEFORE enqueueing. The webhook is logged and pushed to BullMQ for async processing. Response target is under 100ms.

### POST /webhooks/:orgSlug/stripe

Receive Stripe webhook events.

**Auth:** Stripe webhook signature (`stripe-signature` header)
**Rate Limit:** `webhook` (500/min per org slug)

**Request:** Raw Stripe event JSON body with standard Stripe webhook headers.

**Response (200):**

```json
{
  "ok": true,
  "webhookLogId": "550e8400-e29b-41d4-a716-446655440000"
}
```

```bash
# Stripe sends this automatically when configured
curl -X POST https://your-domain.com/webhooks/acme-corp/stripe \
  -H "Content-Type: application/json" \
  -H "stripe-signature: t=1234567890,v1=..." \
  -d '{ "id": "evt_xxx", "type": "customer.subscription.updated", ... }'
```

### POST /webhooks/:orgSlug/apple

Receive Apple App Store Server Notifications (V2).

**Auth:** Apple notification signature verification
**Rate Limit:** `webhook`

If the organization has an `originalNotificationUrl` configured, the webhook is proxied (forwarded) to that URL before processing.

**Response:** Same format as Stripe.

### POST /webhooks/:orgSlug/google

Receive Google Play real-time developer notifications via Pub/Sub push.

**Auth:** Google Pub/Sub push authentication
**Rate Limit:** `webhook`

**Response:** Same format as Stripe.

### POST /webhooks/:orgSlug/recurly

Receive Recurly webhook notifications.

**Auth:** Recurly webhook signature verification
**Rate Limit:** `webhook`

**Response:** Same format as Stripe.

### Error Responses

| Status | Body | Meaning |
|--------|------|---------|
| `404` | `{"error": "Organization not found"}` | Invalid org slug |
| `404` | `{"error": "Billing connection not configured"}` | No connection for this source |
| `401` | `{"error": "Invalid signature"}` | Webhook signature verification failed |
| `500` | `{"error": "Signature verification error"}` | Internal error during verification |

---

## Issues

Base path: `/api/v1/issues`

The core issue management API. Think "Sentry for money."

### GET /api/v1/issues

List issues with filtering and pagination.

**Auth:** Bearer token
**Scope:** `issues:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | string | `"open"` | Filter by status: `open`, `acknowledged`, `resolved`, `dismissed` |
| `severity` | string | - | Filter by severity: `critical`, `warning`, `info` |
| `type` | string | - | Filter by issue type (e.g., `unrevoked_refund`) |
| `category` | string | - | Filter by detector category (e.g., `revenue_protection`) |
| `limit` | number | `50` | Results per page (max 100) |
| `offset` | number | `0` | Pagination offset |

**Response (200):**

```json
{
  "issues": [
    {
      "id": "550e8400-...",
      "orgId": "...",
      "userId": "...",
      "issueType": "unrevoked_refund",
      "severity": "critical",
      "status": "open",
      "title": "Refund not revoked: user still has access",
      "description": "User was refunded $49.99 but still has active entitlement...",
      "estimatedRevenueCents": 4999,
      "confidence": 0.95,
      "detectorId": "unrevoked_refund",
      "detectionTier": "billing_only",
      "evidence": { ... },
      "createdAt": "2026-02-10T00:00:00.000Z",
      "updatedAt": "2026-02-10T00:00:00.000Z",
      "category": "revenue_protection",
      "recommendedAction": "Revoke the entitlement for this user...",
      "detectorDisplayName": "Unrevoked Refund"
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "count": 12
  }
}
```

Issues are enriched with detector metadata including `category`, `recommendedAction`, and `detectorDisplayName`.

```bash
curl "https://your-domain.com/api/v1/issues?status=open&severity=critical&limit=10" \
  -H "Authorization: Bearer rev_your_api_key"
```

### GET /api/v1/issues/summary

Aggregated issue statistics for dashboard headers.

**Auth:** Bearer token
**Scope:** `issues:read`

**Response (200):**

```json
{
  "open": 47,
  "critical": 5,
  "revenueAtRiskCents": 2300000,
  "byType": [
    {
      "issueType": "unrevoked_refund",
      "count": 12,
      "revenue": "150000",
      "category": "revenue_protection"
    }
  ],
  "byCategory": {
    "revenue_protection": { "count": 15, "revenue": 200000 },
    "cross_platform": { "count": 8, "revenue": 50000 }
  }
}
```

```bash
curl https://your-domain.com/api/v1/issues/summary \
  -H "Authorization: Bearer rev_your_api_key"
```

### GET /api/v1/issues/:issueId

Get a single issue with full detail.

**Auth:** Bearer token
**Scope:** `issues:read`

**Response (200):**

```json
{
  "issue": {
    "id": "550e8400-...",
    "issueType": "unrevoked_refund",
    "severity": "critical",
    "status": "open",
    "title": "Refund not revoked: user still has access",
    "description": "...",
    "estimatedRevenueCents": 4999,
    "confidence": 0.95,
    "evidence": { ... },
    "category": "revenue_protection",
    "recommendedAction": "...",
    "detectorDisplayName": "Unrevoked Refund",
    "createdAt": "2026-02-10T00:00:00.000Z",
    "updatedAt": "2026-02-10T00:00:00.000Z"
  }
}
```

```bash
curl https://your-domain.com/api/v1/issues/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer rev_your_api_key"
```

### POST /api/v1/issues/:issueId/acknowledge

Mark an issue as acknowledged.

**Auth:** Bearer token
**Scope:** `issues:write`

**Request Body:** None

**Response (200):**

```json
{ "ok": true }
```

Triggers `issue.acknowledged` webhook event.

```bash
curl -X POST https://your-domain.com/api/v1/issues/550e8400-.../acknowledge \
  -H "Authorization: Bearer rev_your_api_key"
```

### POST /api/v1/issues/:issueId/resolve

Mark an issue as resolved with optional resolution notes.

**Auth:** Bearer token
**Scope:** `issues:write`

**Request Body (optional):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `resolution` | string | No | Resolution notes (max 2000 chars) |

**Response (200):**

```json
{ "ok": true }
```

Triggers `issue.resolved` webhook event.

```bash
curl -X POST https://your-domain.com/api/v1/issues/550e8400-.../resolve \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"resolution": "Revoked entitlement in Stripe dashboard"}'
```

### POST /api/v1/issues/:issueId/dismiss

Dismiss an issue with optional reason.

**Auth:** Bearer token
**Scope:** `issues:write`

**Request Body (optional):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string | No | Dismissal reason (max 2000 chars) |

**Response (200):**

```json
{ "ok": true }
```

Triggers `issue.dismissed` webhook event.

```bash
curl -X POST https://your-domain.com/api/v1/issues/550e8400-.../dismiss \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Known test account, not a real issue"}'
```

---

## AI Investigation

AI-powered endpoints for root cause analysis, insights, incident clustering, and feedback. These endpoints require the `ANTHROPIC_API_KEY` environment variable to be set. Without it, they gracefully degrade with clear messages.

### GET /api/v1/issues/:id/investigation

Get or trigger an AI root cause analysis for a specific issue.

**Auth:** Bearer token
**Scope:** `issues:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `async` | string | `"false"` | Set to `"true"` to force async processing |

**Response (200) -- cached result:**

```json
{
  "available": true,
  "investigation": {
    "rootCause": "The refund was processed but the entitlement engine...",
    "timeline": [ ... ],
    "suggestedActions": [ ... ],
    "generatedAt": "2026-02-10T00:00:00.000Z"
  },
  "cached": true
}
```

**Response (202) -- processing:**

```json
{
  "available": true,
  "status": "processing",
  "message": "AI investigation is being generated. Poll this endpoint to get results.",
  "jobId": "inv_550e8400..."
}
```

**Response (200) -- AI not enabled:**

```json
{
  "available": false,
  "message": "AI investigation is not currently enabled for this account"
}
```

Cached investigations are valid for 24 hours or until the issue is updated.

```bash
curl https://your-domain.com/api/v1/issues/550e8400-.../investigation \
  -H "Authorization: Bearer rev_your_api_key"
```

### GET /api/v1/insights

AI-generated billing health insights.

**Auth:** Bearer token
**Scope:** `issues:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `period` | string | `"daily"` | Analysis period: `"daily"` or `"weekly"` |

**Response (200):**

```json
{
  "insights": [ ... ],
  "generatedAt": "2026-02-10T00:00:00.000Z",
  "aiEnabled": true
}
```

```bash
curl "https://your-domain.com/api/v1/insights?period=weekly" \
  -H "Authorization: Bearer rev_your_api_key"
```

### GET /api/v1/issues/incidents

Group open issues into incident clusters (co-occurring issues that likely share a root cause).

**Auth:** Bearer token
**Scope:** `issues:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `window` | number | `4` | Time window in hours for clustering (max 48) |
| `min_size` | number | `3` | Minimum cluster size (min 2) |

**Response (200):**

```json
{
  "incidents": [
    {
      "id": "cluster_1",
      "issueCount": 8,
      "commonType": "webhook_delivery_gap",
      "issues": [ ... ],
      "summary": "..."
    }
  ],
  "count": 2,
  "aiEnabled": true
}
```

```bash
curl "https://your-domain.com/api/v1/issues/incidents?window=6&min_size=2" \
  -H "Authorization: Bearer rev_your_api_key"
```

### POST /api/v1/issues/:id/feedback

Submit resolution feedback. Used to train detector accuracy over time.

**Auth:** Bearer token
**Scope:** `issues:write`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `wasRealIssue` | boolean | Yes | Whether this was a genuine issue |
| `actualCause` | string | No | What the actual root cause was (max 2000 chars) |
| `notes` | string | No | Additional notes (max 5000 chars) |

**Response (200):**

```json
{
  "ok": true,
  "status": "resolved"
}
```

The `status` is `"resolved"` if `wasRealIssue` is true, `"dismissed"` if false.

```bash
curl -X POST https://your-domain.com/api/v1/issues/550e8400-.../feedback \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"wasRealIssue": true, "actualCause": "Stripe webhook was delayed by 30 minutes"}'
```

### GET /api/v1/detectors/health

Detector accuracy metrics computed from feedback data.

**Auth:** Bearer token
**Scope:** `issues:read`

**Response (200):**

```json
{
  "detectors": {
    "unrevoked_refund": {
      "totalIssues": 100,
      "truePositives": 92,
      "falsePositives": 8,
      "accuracy": 0.92
    }
  }
}
```

```bash
curl https://your-domain.com/api/v1/detectors/health \
  -H "Authorization: Bearer rev_your_api_key"
```

### GET /api/v1/ai/status

Check AI system status and token usage.

**Auth:** Bearer token
**Scope:** `issues:read`

**Response (200):**

```json
{
  "enabled": true,
  "tokenUsage": {
    "inputTokens": 15000,
    "outputTokens": 3000
  },
  "model": "claude-sonnet-4-5-20250929"
}
```

```bash
curl https://your-domain.com/api/v1/ai/status \
  -H "Authorization: Bearer rev_your_api_key"
```

---

## Users

Base path: `/api/v1/users`

User management with cross-platform identity resolution and timeline views.

### GET /api/v1/users

List users with optional search and pagination.

**Auth:** Bearer token
**Scope:** `users:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | `25` | Results per page (max 100) |
| `offset` | number | `0` | Pagination offset |
| `search` | string | - | Search by email or external user ID (min 2 chars, ILIKE match) |

**Response (200):**

```json
{
  "users": [
    {
      "id": "550e8400-...",
      "email": "user@example.com",
      "externalUserId": "usr_abc123",
      "createdAt": "2026-01-15T00:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 25,
    "offset": 0,
    "count": 3200
  }
}
```

```bash
curl "https://your-domain.com/api/v1/users?search=user@example.com&limit=10" \
  -H "Authorization: Bearer rev_your_api_key"
```

### GET /api/v1/users/search

Search for users by exact match on email, external user ID, or any identity (Stripe customer_id, Apple original_transaction_id, etc.).

**Auth:** Bearer token
**Scope:** `users:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | - | Search query (min 2 chars, required) |
| `limit` | number | `20` | Results per page (max 50) |

Search priority: email -> external user ID -> identity graph (external IDs from billing providers).

**Response (200):**

```json
{
  "users": [
    {
      "id": "550e8400-...",
      "orgId": "...",
      "email": "user@example.com",
      "externalUserId": "usr_abc123",
      "metadata": {},
      "createdAt": "2026-01-15T00:00:00.000Z",
      "updatedAt": "2026-02-10T00:00:00.000Z"
    }
  ]
}
```

```bash
curl "https://your-domain.com/api/v1/users/search?q=cus_ABC123" \
  -H "Authorization: Bearer rev_your_api_key"
```

### GET /api/v1/users/:userId

Full user profile with identities, entitlements, open issues, and recent events.

**Auth:** Bearer token
**Scope:** `users:read`

**Response (200):**

```json
{
  "user": {
    "id": "550e8400-...",
    "orgId": "...",
    "email": "user@example.com",
    "externalUserId": "usr_abc123",
    "metadata": {},
    "createdAt": "...",
    "updatedAt": "..."
  },
  "identities": [
    {
      "id": "...",
      "userId": "...",
      "source": "stripe",
      "externalId": "cus_ABC123",
      "idType": "customer_id",
      "createdAt": "..."
    }
  ],
  "entitlements": [
    {
      "id": "...",
      "productId": "...",
      "source": "stripe",
      "state": "active",
      "currentPeriodStart": "...",
      "currentPeriodEnd": "..."
    }
  ],
  "openIssues": [ ... ],
  "recentEvents": [ ... ]
}
```

The `openIssues` array is limited to the 10 most recent open issues. The `recentEvents` array is limited to the 20 most recent events.

```bash
curl https://your-domain.com/api/v1/users/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer rev_your_api_key"
```

### GET /api/v1/users/:userId/timeline

All billing events for a user across all platforms, newest first.

**Auth:** Bearer token
**Scope:** `users:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | `100` | Max events to return (max 500) |

**Response (200):**

```json
{
  "events": [
    {
      "id": "...",
      "source": "stripe",
      "eventType": "renewal",
      "eventTime": "2026-02-01T00:00:00.000Z",
      "status": "success",
      "amountCents": 4999,
      "currency": "USD",
      ...
    }
  ]
}
```

```bash
curl "https://your-domain.com/api/v1/users/550e8400-.../timeline?limit=50" \
  -H "Authorization: Bearer rev_your_api_key"
```

### GET /api/v1/users/:userId/entitlements

All entitlements for a specific user.

**Auth:** Bearer token
**Scope:** `users:read`

**Response (200):**

```json
{
  "entitlements": [
    {
      "id": "...",
      "productId": "...",
      "source": "stripe",
      "state": "active",
      "externalSubscriptionId": "sub_ABC123",
      "currentPeriodStart": "...",
      "currentPeriodEnd": "...",
      "billingInterval": "month",
      "planTier": "premium"
    }
  ]
}
```

```bash
curl https://your-domain.com/api/v1/users/550e8400-.../entitlements \
  -H "Authorization: Bearer rev_your_api_key"
```

### GET /api/v1/users/:userId/identities

All cross-platform identities for a user (Stripe customer ID, Apple transaction ID, etc.).

**Auth:** Bearer token
**Scope:** `users:read`

**Response (200):**

```json
{
  "identities": [
    {
      "id": "...",
      "userId": "...",
      "source": "stripe",
      "externalId": "cus_ABC123",
      "idType": "customer_id",
      "metadata": {},
      "createdAt": "..."
    },
    {
      "id": "...",
      "userId": "...",
      "source": "apple",
      "externalId": "1000000123456789",
      "idType": "original_transaction_id",
      "metadata": {},
      "createdAt": "..."
    }
  ]
}
```

```bash
curl https://your-domain.com/api/v1/users/550e8400-.../identities \
  -H "Authorization: Bearer rev_your_api_key"
```

### GET /api/v1/users/:userId/issues

All issues for a specific user.

**Auth:** Bearer token
**Scope:** `users:read`

**Response (200):**

```json
{
  "issues": [ ... ]
}
```

```bash
curl https://your-domain.com/api/v1/users/550e8400-.../issues \
  -H "Authorization: Bearer rev_your_api_key"
```

---

## Dashboard

Base path: `/api/v1/dashboard`

Aggregate views for the main dashboard.

### GET /api/v1/dashboard/revenue-impact

Revenue at risk breakdown by severity and issue type, plus revenue saved by resolved issues.

**Auth:** Bearer token
**Scope:** `dashboard:read`

**Response (200):**

```json
{
  "atRisk": {
    "totalCents": 2300000,
    "issueCount": 47
  },
  "bySeverity": [
    {
      "severity": "critical",
      "totalRevenueCents": "1500000",
      "issueCount": 5
    },
    {
      "severity": "warning",
      "totalRevenueCents": "800000",
      "issueCount": 30
    }
  ],
  "byType": [
    {
      "issueType": "unrevoked_refund",
      "totalRevenueCents": "500000",
      "issueCount": 12
    }
  ],
  "saved": {
    "totalCents": 450000,
    "issueCount": 23
  }
}
```

```bash
curl https://your-domain.com/api/v1/dashboard/revenue-impact \
  -H "Authorization: Bearer rev_your_api_key"
```

### GET /api/v1/dashboard/events

Real-time event feed with filtering.

**Auth:** Bearer token
**Scope:** `dashboard:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | `50` | Max events (max 200) |
| `source` | string | - | Filter by billing source: `stripe`, `apple`, `google`, `recurly` |
| `type` | string | - | Filter by event type: `purchase`, `renewal`, `refund`, etc. |
| `startDate` | string (ISO 8601) | - | Filter events after this date |
| `endDate` | string (ISO 8601) | - | Filter events before this date |

**Response (200):**

```json
{
  "events": [
    {
      "id": "...",
      "source": "stripe",
      "eventType": "renewal",
      "sourceEventType": "invoice.payment_succeeded",
      "eventTime": "2026-02-10T12:00:00.000Z",
      "status": "success",
      "amountCents": 4999,
      "currency": "USD",
      "userId": "...",
      "environment": "production",
      "ingestedAt": "2026-02-10T12:00:01.000Z"
    }
  ]
}
```

```bash
curl "https://your-domain.com/api/v1/dashboard/events?source=stripe&type=refund&limit=20" \
  -H "Authorization: Bearer rev_your_api_key"
```

### GET /api/v1/dashboard/entitlement-health

Entitlement state distribution across all users.

**Auth:** Bearer token
**Scope:** `dashboard:read`

**Response (200):**

```json
{
  "totalUsers": 3200,
  "byState": [
    { "state": "active", "count": 2800 },
    { "state": "trial", "count": 150 },
    { "state": "grace_period", "count": 50 },
    { "state": "expired", "count": 200 }
  ],
  "bySource": [
    { "source": "stripe", "state": "active", "count": 2000 },
    { "source": "apple", "state": "active", "count": 800 }
  ]
}
```

```bash
curl https://your-domain.com/api/v1/dashboard/entitlement-health \
  -H "Authorization: Bearer rev_your_api_key"
```

### GET /api/v1/dashboard/trends/issues

Issue trend data for charts, aggregated by day and severity.

**Auth:** Bearer token
**Scope:** `dashboard:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `days` | number | `30` | Number of days of history (max 90) |

**Response (200):**

```json
{
  "trend": [
    {
      "date": "2026-02-01",
      "severity": "critical",
      "count": 2,
      "revenue": "100000"
    },
    {
      "date": "2026-02-01",
      "severity": "warning",
      "count": 5,
      "revenue": "50000"
    }
  ],
  "days": 30
}
```

```bash
curl "https://your-domain.com/api/v1/dashboard/trends/issues?days=14" \
  -H "Authorization: Bearer rev_your_api_key"
```

### GET /api/v1/dashboard/trends/events

Event volume trend data for charts, aggregated by day and billing source.

**Auth:** Bearer token
**Scope:** `dashboard:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `days` | number | `30` | Number of days of history (max 90) |

**Response (200):**

```json
{
  "trend": [
    {
      "date": "2026-02-01",
      "source": "stripe",
      "count": 142
    },
    {
      "date": "2026-02-01",
      "source": "apple",
      "count": 58
    }
  ],
  "days": 30
}
```

```bash
curl "https://your-domain.com/api/v1/dashboard/trends/events?days=7" \
  -H "Authorization: Bearer rev_your_api_key"
```

---

## First Look Report

Base path: `/api/v1/first-look`

The "aha moment" endpoint. After connecting billing systems and importing historical data, this report shows the reality of subscription health.

### GET /api/v1/first-look

Generate a comprehensive billing health report.

**Auth:** Bearer token
**Scope:** `dashboard:read`

**Response (200):**

```json
{
  "generatedAt": "2026-02-10T00:00:00.000Z",
  "dataReady": true,
  "overview": {
    "totalSubscribers": 3200,
    "activeSources": ["stripe", "apple"],
    "totalEventsProcessed": 15420,
    "eventsBySource": [
      { "source": "stripe", "count": 10000 },
      { "source": "apple", "count": 5420 }
    ]
  },
  "subscriberHealth": {
    "distribution": [
      { "state": "active", "count": 2800, "percentage": 88 },
      { "state": "grace_period", "count": 50, "percentage": 2 }
    ]
  },
  "revenueImpact": {
    "totalMonthlyRevenueCentsAtRisk": 2300000,
    "totalOpenIssues": 47,
    "bySeverity": [
      { "severity": "critical", "count": 5, "revenueCents": 1500000 }
    ],
    "byType": [
      { "issueType": "unrevoked_refund", "count": 12, "revenueCents": 500000 }
    ]
  },
  "topIssues": [
    {
      "id": "...",
      "type": "unrevoked_refund",
      "severity": "critical",
      "title": "Refund not revoked: user still has access",
      "description": "...",
      "estimatedRevenueCents": 4999,
      "confidence": 0.95
    }
  ],
  "activityTimeline": [
    { "date": "2026-02-01", "events": 142 }
  ],
  "importSummary": [
    { "source": "stripe", "syncStatus": "complete", "lastSyncAt": "..." }
  ]
}
```

```bash
curl https://your-domain.com/api/v1/first-look \
  -H "Authorization: Bearer rev_your_api_key"
```

---

## Alerts

Base path: `/api/v1/alerts`

Configure alert notifications via Slack, email, or webhooks when issues are detected.

### POST /api/v1/alerts

Create an alert configuration.

**Auth:** Bearer token
**Scope:** `alerts:write`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `channel` | string | Yes | `"slack"`, `"email"`, or `"webhook"` |
| `config` | object | Yes | Channel-specific configuration (see below) |
| `severityFilter` | string[] | No | Severity levels to alert on. Default: `["critical", "warning", "info"]` |
| `issueTypes` | string[] | No | Specific issue types to alert on. `null` = all types |
| `enabled` | boolean | No | Whether the alert is active. Default: `true` |

**Slack config:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `webhookUrl` | string | Yes | Slack incoming webhook URL (must start with `https://hooks.slack.com/`) |
| `channelName` | string | No | Display name for the channel |

**Email config:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `recipients` | string[] | Yes | Array of email addresses (1-50) |

**Webhook config:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | Webhook endpoint URL |
| `eventTypes` | string[] | No | Event types to send: `"issue.created"`, `"issue.resolved"`, `"issue.dismissed"`, `"issue.acknowledged"` |

For webhook configs, a signing secret is auto-generated and returned in the creation response (one-time reveal).

**Response (201):**

```json
{
  "alertConfig": {
    "id": "550e8400-...",
    "orgId": "...",
    "channel": "webhook",
    "config": {
      "url": "https://your-server.com/revback-webhook",
      "signingSecret": "whsec_abc123...",
      "eventTypes": ["issue.created", "issue.resolved"]
    },
    "severityFilter": ["critical", "warning"],
    "issueTypes": null,
    "enabled": true,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

The `signingSecret` is only returned on creation for webhook configs. After creation, it is masked as `"***"`.

```bash
curl -X POST https://your-domain.com/api/v1/alerts \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "slack",
    "config": {
      "webhookUrl": "https://hooks.slack.com/services/T.../B.../xxx"
    },
    "severityFilter": ["critical", "warning"]
  }'
```

### GET /api/v1/alerts

List all alert configurations for the organization.

**Auth:** Bearer token
**Scope:** `alerts:read`

**Response (200):**

```json
{
  "alertConfigs": [
    {
      "id": "...",
      "channel": "slack",
      "config": {
        "webhookUrl": "***xxx12345",
        "channelName": "#billing-alerts"
      },
      "severityFilter": ["critical", "warning"],
      "issueTypes": null,
      "enabled": true,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

Sensitive config values are masked (Slack webhook URLs show only last 8 chars, webhook signing secrets show `"***"`).

```bash
curl https://your-domain.com/api/v1/alerts \
  -H "Authorization: Bearer rev_your_api_key"
```

### PUT /api/v1/alerts/:id

Update an existing alert configuration. Only provided fields are updated.

**Auth:** Bearer token
**Scope:** `alerts:write`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `config` | object | No | Updated channel config |
| `severityFilter` | string[] | No | Updated severity filter |
| `issueTypes` | string[] or null | No | Updated issue type filter |
| `enabled` | boolean | No | Enable/disable the alert |

For webhook configs, the signing secret is preserved when updating the config.

**Response (200):**

```json
{
  "alertConfig": { ... }
}
```

```bash
curl -X PUT https://your-domain.com/api/v1/alerts/550e8400-... \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

### DELETE /api/v1/alerts/:id

Delete an alert configuration and its delivery logs.

**Auth:** Bearer token
**Scope:** `alerts:write`

**Response (200):**

```json
{ "ok": true }
```

```bash
curl -X DELETE https://your-domain.com/api/v1/alerts/550e8400-... \
  -H "Authorization: Bearer rev_your_api_key"
```

### POST /api/v1/alerts/test

Send a test alert to verify the configuration is working.

**Auth:** Bearer token
**Scope:** `alerts:write`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `alertConfigId` | string (UUID) | Yes | ID of the alert configuration to test |

**Response (200):**

```json
{
  "ok": true,
  "message": "Test alert sent via slack"
}
```

**Response (500):**

```json
{
  "ok": false,
  "error": "Failed to send test alert"
}
```

```bash
curl -X POST https://your-domain.com/api/v1/alerts/test \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"alertConfigId": "550e8400-..."}'
```

### GET /api/v1/alerts/:id/signing-secret

Retrieve the signing secret for a webhook alert configuration.

**Auth:** Bearer token
**Scope:** `alerts:read`

Only works for `webhook` channel configs. Returns 400 for other channels.

**Response (200):**

```json
{
  "signingSecret": "whsec_abc123..."
}
```

```bash
curl https://your-domain.com/api/v1/alerts/550e8400-.../signing-secret \
  -H "Authorization: Bearer rev_your_api_key"
```

### GET /api/v1/alerts/history

View recent alert delivery logs.

**Auth:** Bearer token
**Scope:** `alerts:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | `20` | Max entries (max 100) |

**Response (200):**

```json
{
  "deliveries": [
    {
      "id": "...",
      "orgId": "...",
      "alertConfigId": "...",
      "issueId": "...",
      "channel": "slack",
      "status": "sent",
      "errorMessage": null,
      "sentAt": "2026-02-10T12:00:00.000Z"
    }
  ]
}
```

```bash
curl "https://your-domain.com/api/v1/alerts/history?limit=50" \
  -H "Authorization: Bearer rev_your_api_key"
```

---

## Access Checks (SDK)

Base path: `/api/v1/access-checks`

Report access check results from your application SDK. These are used by Tier 2 ("verified") detectors to confirm whether users actually have access to your product.

### POST /api/v1/access-checks

Report a single access check.

**Auth:** Bearer token
**Scope:** `access-checks:write`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `user` | string | Yes | External user identifier (email, user ID, or billing platform ID) |
| `productId` | string | No | Product UUID. Required if org has multiple products. Auto-resolved if single product. |
| `hasAccess` | boolean | Yes | Whether the user currently has access |
| `checkedAt` | string (ISO 8601) | No | When the check was performed. Defaults to now. |

**Response (200):**

```json
{
  "ok": true,
  "accessCheckId": "550e8400-..."
}
```

```bash
curl -X POST https://your-domain.com/api/v1/access-checks \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"user": "user@example.com", "hasAccess": true}'
```

### POST /api/v1/access-checks/test

Validate an access check payload without storing it. Useful for integration testing.

**Auth:** Bearer token
**Scope:** `access-checks:write`

**Request Body:** Same as `POST /access-checks`.

**Response (200):**

```json
{
  "ok": true,
  "parsed": {
    "user": "user@example.com",
    "hasAccess": true
  },
  "userResolved": true,
  "resolvedUserId": "550e8400-..."
}
```

```bash
curl -X POST https://your-domain.com/api/v1/access-checks/test \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"user": "user@example.com", "hasAccess": true}'
```

### POST /api/v1/access-checks/batch

Report up to 100 access checks in a single request.

**Auth:** Bearer token
**Scope:** `access-checks:write`

**Request Body:** Array of access check objects (same schema as single check, max 100).

```json
[
  { "user": "user1@example.com", "hasAccess": true },
  { "user": "user2@example.com", "hasAccess": false }
]
```

**Response (200):**

```json
{
  "ok": true,
  "results": [
    { "ok": true, "accessCheckId": "..." },
    { "ok": true, "accessCheckId": "..." }
  ]
}
```

Individual items that fail still appear in the results with `ok: false` and an error message.

```bash
curl -X POST https://your-domain.com/api/v1/access-checks/batch \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '[{"user":"user1@example.com","hasAccess":true},{"user":"user2@example.com","hasAccess":false}]'
```

### GET /api/v1/access-checks

List recent access checks.

**Auth:** Bearer token
**Scope:** `access-checks:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | `50` | Max results (max 100) |

**Response (200):**

```json
{
  "accessChecks": [
    {
      "id": "...",
      "orgId": "...",
      "userId": "...",
      "productId": "...",
      "externalUserId": "user@example.com",
      "hasAccess": true,
      "reportedAt": "2026-02-10T12:00:00.000Z",
      "metadata": {},
      "createdAt": "..."
    }
  ]
}
```

```bash
curl "https://your-domain.com/api/v1/access-checks?limit=20" \
  -H "Authorization: Bearer rev_your_api_key"
```

### GET /api/v1/access-checks/stats

Access check statistics for the organization.

**Auth:** Bearer token
**Scope:** `access-checks:read`

**Response (200):**

```json
{
  "accessChecksReceived": 15420,
  "accessChecksToday": 87
}
```

```bash
curl https://your-domain.com/api/v1/access-checks/stats \
  -H "Authorization: Bearer rev_your_api_key"
```

---

## Data Management (GDPR)

Base path: `/api/v1/data-management`

GDPR right-to-delete and data portability endpoints.

### DELETE /api/v1/data-management/users/:userId/data

Permanently delete all data for a user (GDPR right to erasure).

**Auth:** Bearer token
**Scope:** `admin:write`

Deletes in dependency order within a transaction: access checks, issues, entitlements, canonical events, user identities, then the user record. An audit log entry is created before deletion.

**Response (200):**

```json
{
  "ok": true,
  "userId": "550e8400-...",
  "deleted": {
    "accessChecksDeleted": 5,
    "issuesDeleted": 2,
    "entitlementsDeleted": 1,
    "eventsDeleted": 47,
    "identitiesDeleted": 3,
    "userDeleted": true
  },
  "message": "All user data has been permanently deleted."
}
```

```bash
curl -X DELETE https://your-domain.com/api/v1/data-management/users/550e8400-.../data \
  -H "Authorization: Bearer rev_your_api_key"
```

### GET /api/v1/data-management/users/:userId/data-export

Export all data for a user (GDPR right to portability).

**Auth:** Bearer token
**Scope:** `admin:read`

**Response (200):**

```json
{
  "exportedAt": "2026-02-10T00:00:00.000Z",
  "user": {
    "id": "...",
    "externalUserId": "usr_abc123",
    "email": "user@example.com",
    "metadata": {},
    "createdAt": "..."
  },
  "identities": [
    {
      "source": "stripe",
      "externalId": "cus_ABC123",
      "idType": "customer_id",
      "createdAt": "..."
    }
  ],
  "events": [
    {
      "id": "...",
      "source": "stripe",
      "eventType": "renewal",
      "eventTime": "...",
      "status": "success",
      "amountCents": 4999,
      "currency": "USD",
      "createdAt": "..."
    }
  ],
  "entitlements": [
    {
      "id": "...",
      "productId": "...",
      "source": "stripe",
      "state": "active",
      "currentPeriodStart": "...",
      "currentPeriodEnd": "...",
      "createdAt": "..."
    }
  ],
  "issues": [
    {
      "id": "...",
      "issueType": "unrevoked_refund",
      "severity": "critical",
      "status": "resolved",
      "title": "...",
      "description": "...",
      "createdAt": "...",
      "resolvedAt": "..."
    }
  ],
  "accessChecks": [
    {
      "id": "...",
      "externalUserId": "user@example.com",
      "hasAccess": true,
      "reportedAt": "..."
    }
  ]
}
```

```bash
curl https://your-domain.com/api/v1/data-management/users/550e8400-.../data-export \
  -H "Authorization: Bearer rev_your_api_key"
```

---

## Admin: Scans

Base path: `/api/v1/admin/scans`

Manage issue detection scans. Scans run on schedules automatically, but can also be triggered manually.

### POST /api/v1/admin/scans/trigger

Trigger an issue detection scan immediately.

**Auth:** Bearer token
**Scope:** `admin:write`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `detectorId` | string | No | Specific detector to run (e.g., `"unrevoked_refund"`). Default: `"all"` |

Validates that the detector exists and has a scheduled scan method.

**Response (200):**

```json
{
  "ok": true,
  "jobId": "scan_123",
  "detectorId": "unrevoked_refund",
  "orgId": "550e8400-...",
  "message": "Scan job queued. Check /admin/scans/history for results."
}
```

```bash
curl -X POST https://your-domain.com/api/v1/admin/scans/trigger \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"detectorId": "unrevoked_refund"}'
```

### GET /api/v1/admin/scans/history

View recent scan results, including active, waiting, completed, and failed scans.

**Auth:** Bearer token
**Scope:** `admin:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | `50` | Max completed results (max 200) |

**Response (200):**

```json
{
  "active": [
    {
      "id": "123",
      "name": "scheduled-scan",
      "detectorId": "unrevoked_refund",
      "orgId": "...",
      "status": "active",
      "scheduledAt": "...",
      "processedOn": "..."
    }
  ],
  "waiting": [ ... ],
  "completed": [
    {
      "id": "122",
      "name": "scheduled-scan",
      "detectorId": "all",
      "orgId": null,
      "status": "completed",
      "result": { "issuesCreated": 3, "detectorId": "all" },
      "scheduledAt": "...",
      "processedOn": "...",
      "finishedOn": "...",
      "duration": 12500
    }
  ],
  "failed": [ ... ],
  "nextScheduledRuns": [
    {
      "name": "scheduled-scan",
      "pattern": "0 */6 * * *",
      "next": "2026-02-10T18:00:00.000Z"
    }
  ],
  "timestamp": "2026-02-10T14:00:00.000Z"
}
```

```bash
curl "https://your-domain.com/api/v1/admin/scans/history?limit=20" \
  -H "Authorization: Bearer rev_your_api_key"
```

### GET /api/v1/admin/scans/schedules

List all configured scan schedules and available detectors.

**Auth:** Bearer token
**Scope:** `admin:read`

**Response (200):**

```json
{
  "schedules": [ ... ],
  "detectors": [
    {
      "id": "unrevoked_refund",
      "hasScheduledScan": true
    }
  ]
}
```

```bash
curl https://your-domain.com/api/v1/admin/scans/schedules \
  -H "Authorization: Bearer rev_your_api_key"
```

---

## Admin: Queue Monitor

Base path: `/api/v1/admin/queues`

Real-time health metrics for all BullMQ queues.

### GET /api/v1/admin/queues

Health overview for all queues.

**Auth:** Bearer token
**Scope:** Authenticated (auth middleware applied, no specific scope check)

**Response (200):**

```json
{
  "queues": {
    "webhook-processing": {
      "name": "webhook-processing",
      "counts": {
        "waiting": 3,
        "active": 1,
        "completed": 15420,
        "failed": 2,
        "delayed": 0,
        "paused": 0
      },
      "metrics": {
        "processingRatePerMinute": 12,
        "avgProcessingTimeMs": 85,
        "oldestWaitingAgeMs": 1500
      }
    }
  },
  "timestamp": "2026-02-10T14:00:00.000Z"
}
```

```bash
curl https://your-domain.com/api/v1/admin/queues \
  -H "Authorization: Bearer rev_your_api_key"
```

---

## Admin: Dead Letter Queue

Base path: `/api/v1/admin/dlq`

Manage webhook events that failed processing after 3 attempts.

### GET /api/v1/admin/dlq

List failed (DLQ) jobs.

**Auth:** Bearer token
**Scope:** Authenticated (auth middleware applied, no specific scope check)

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `offset` | number | `0` | Pagination offset |
| `limit` | number | `50` | Max results (max 200) |

**Response (200):**

```json
{
  "total": 2,
  "offset": 0,
  "limit": 50,
  "items": [
    {
      "id": "job_123",
      "orgId": "...",
      "source": "stripe",
      "webhookLogId": "...",
      "receivedAt": "2026-02-10T12:00:00.000Z",
      "attempts": 3,
      "failedReason": "Error: Failed to normalize event...",
      "stacktrace": ["..."],
      "timestamp": 1707523200000,
      "processedOn": 1707523200100,
      "finishedOn": 1707523200200
    }
  ]
}
```

```bash
curl "https://your-domain.com/api/v1/admin/dlq?limit=10" \
  -H "Authorization: Bearer rev_your_api_key"
```

### POST /api/v1/admin/dlq/:id/retry

Re-queue a specific failed job for processing.

**Auth:** Bearer token
**Scope:** Authenticated

**Response (200):**

```json
{
  "ok": true,
  "jobId": "job_123",
  "message": "Job re-queued for processing"
}
```

Returns 400 if the job is not in `"failed"` state.

```bash
curl -X POST https://your-domain.com/api/v1/admin/dlq/job_123/retry \
  -H "Authorization: Bearer rev_your_api_key"
```

### POST /api/v1/admin/dlq/retry-all

Re-queue all failed jobs.

**Auth:** Bearer token
**Scope:** Authenticated

**Response (200):**

```json
{
  "ok": true,
  "retried": 5,
  "errors": 0,
  "total": 5
}
```

```bash
curl -X POST https://your-domain.com/api/v1/admin/dlq/retry-all \
  -H "Authorization: Bearer rev_your_api_key"
```

---

## Admin: Circuit Breakers

Base path: `/api/v1/admin/circuit-breakers`

Monitor circuit breaker states for external service calls.

### GET /api/v1/admin/circuit-breakers

List all circuit breaker statuses.

**Auth:** Bearer token
**Scope:** Authenticated (auth middleware applied, no specific scope check)

**Response (200):**

```json
{
  "breakers": {
    "stripe-api": {
      "state": "closed",
      "failureCount": 0,
      "lastFailure": null
    },
    "apple-api": {
      "state": "open",
      "failureCount": 5,
      "lastFailure": "2026-02-10T12:00:00.000Z"
    }
  }
}
```

Circuit breaker states: `"closed"` (healthy), `"open"` (failing, requests blocked), `"half-open"` (testing recovery).

```bash
curl https://your-domain.com/api/v1/admin/circuit-breakers \
  -H "Authorization: Bearer rev_your_api_key"
```

---

## Domain Types Reference

### Billing Sources

`stripe` | `apple` | `google` | `recurly` | `braintree`

### Event Types

`purchase` | `renewal` | `cancellation` | `refund` | `chargeback` | `grace_period_start` | `grace_period_end` | `billing_retry` | `expiration` | `trial_start` | `trial_conversion` | `upgrade` | `downgrade` | `crossgrade` | `pause` | `resume` | `revoke` | `offer_redeemed` | `price_change`

### Event Statuses

`success` | `failed` | `pending` | `refunded`

### Entitlement States

`inactive` | `trial` | `active` | `offer_period` | `grace_period` | `billing_retry` | `on_hold` | `past_due` | `paused` | `expired` | `revoked` | `refunded`

### Issue Severities

`critical` | `warning` | `info`

### Issue Statuses

`open` | `acknowledged` | `resolved` | `dismissed`

### Alert Channels

`slack` | `email` | `webhook`

### Webhook Event Types (outbound)

`issue.created` | `issue.resolved` | `issue.dismissed` | `issue.acknowledged`
