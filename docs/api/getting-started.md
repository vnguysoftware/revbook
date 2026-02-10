# Getting Started

**RevBack API** — 67 endpoints for detecting billing issues across Stripe, Apple App Store, Google Play, and Recurly.

**Version:** 0.1.0
**Base URL:** `https://your-domain.com`

### Quick Links

- [Setup & Onboarding](/docs/setup) — Connect your billing providers (Day 1)
- [Issues & Detection](/docs/issues) — The core value: find revenue leaks
- [Alerts & Notifications](/docs/alerts) — Get notified when issues are found
- [Types Reference](/docs/types) — All enums and domain types

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
{
  "error": "Rate limit exceeded"
}
```

The rate limiter fails open: if Redis is unavailable, requests are allowed through.

---

## Errors

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
- `issues:write` does NOT imply `issues:read` — grant both if needed.
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
{
  "ready": true
}
```

**Response (not ready):**

```json
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
