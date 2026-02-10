# Access Control Policy

**RevBack, Inc.**
**Effective Date:** February 2026
**Last Reviewed:** February 2026
**Owner:** Engineering Lead
**Classification:** Internal

---

## 1. Purpose

This policy defines how access to RevBack systems and data is granted, managed, and revoked for both internal personnel and API consumers (customers). RevBack operates as a multi-tenant system where each customer organization's data must be strictly isolated.

## 2. Scope

This policy covers:
- Customer API access to the RevBack platform
- Internal team access to production systems (database, Redis, hosting, source code)
- Webhook endpoint access from billing providers (Stripe, Apple, Google)
- Dashboard access for customer organizations

## 3. API Consumer Access Control

### 3.1 Authentication

Customer API access is authenticated via API keys with Bearer token authentication (`src/middleware/auth.ts`).

**API key properties:**
- Format: `rev_` prefix followed by 64 hex characters (32 random bytes via `crypto.randomBytes`)
- Storage: SHA-256 hash stored in `api_keys.keyHash` column. The plaintext key is never stored.
- Prefix: First 8 characters stored in `api_keys.keyPrefix` for identification without exposing the full key
- Expiration: Optional `expiresAt` timestamp checked on every request (`src/middleware/auth.ts:56-58`)
- Last used: `lastUsedAt` updated on every authenticated request for security monitoring (`src/middleware/auth.ts:72-75`)

**Authentication flow:**
1. Client sends `Authorization: Bearer rev_xxxx...` header
2. Server extracts the key, validates `rev_` prefix
3. Server computes SHA-256 hash of the key
4. Server looks up hash in `api_keys` table
5. Server checks expiration date
6. Server resolves the associated organization
7. Auth context (`orgId`, `orgSlug`, `apiKeyId`, `scopes`) set on request

**API key lifecycle:**
- **Creation:** Generated during organization setup (`POST /setup/org`). The plaintext key is returned exactly once in the response (`src/api/onboarding.ts:140-161`). Audit log entry created.
- **Usage tracking:** `lastUsedAt` updated on each request. Keys not used for an extended period should be investigated or revoked.
- **Revocation:** Delete the key record from `api_keys` table. Takes effect immediately since keys are verified on every request.
- **Rotation:** Create a new key, update integrations, then revoke the old key. Both keys work simultaneously during the transition.

### 3.2 Authorization (Scope System)

API keys support granular permission scopes (`src/security/scopes.ts`):

| Scope | Access Granted |
|---|---|
| `issues:read` | View detected billing issues |
| `issues:write` | Resolve, dismiss, acknowledge issues |
| `alerts:read` | View alert configurations and delivery history |
| `alerts:write` | Create, update, delete alert configurations |
| `admin:read` | View queue health, DLQ, scan history |
| `admin:write` | Retry DLQ jobs, trigger scans |
| `setup:write` | Connect billing providers, start backfills |
| `access-checks:read` | View access check results |
| `access-checks:write` | Submit access check reports |
| `dashboard:read` | View dashboard metrics |
| `users:read` | Search and view user profiles |
| `*` | Full access (wildcard) |

**Scope enforcement:**
- Implemented via `requireScope()` middleware (`src/middleware/require-scope.ts`)
- Applied per-route: e.g., `app.get('/issues', requireScope('issues:read'), handler)`
- Scope check runs after authentication, before the route handler
- Missing scope returns HTTP 403 with `{ error: 'Insufficient permissions', requiredScope: '...' }`
- Scopes are independent: `issues:write` does NOT imply `issues:read` -- both must be explicitly granted

**Backward compatibility:**
- API keys with an empty scopes array (`[]`) are granted full access
- This preserves functionality for keys created before the scope system was introduced
- New keys should always be created with explicit, minimal scopes

### 3.3 Principle of Least Privilege

When creating API keys for customers:
- Grant only the scopes required for the key's intended use
- Read-only integrations should use read scopes only (e.g., `issues:read`, `dashboard:read`)
- Setup/onboarding keys need `setup:write` but may not need `admin:write`
- Monitoring integrations only need `dashboard:read` and `alerts:read`

## 4. Multi-Tenant Data Isolation

### 4.1 Organization-Scoped Data

All data tables include an `orgId` column that enforces tenant isolation (`src/models/schema.ts`):

| Table | Scoped Column | Description |
|---|---|---|
| `billing_connections` | `orgId` | Encrypted credentials per billing provider |
| `users` | `orgId` | Canonical user records |
| `user_identities` | `orgId` | Cross-platform identity mappings |
| `canonical_events` | `orgId` | Normalized billing events |
| `entitlements` | `orgId` | Subscription state per user/product |
| `issues` | `orgId` | Detected billing problems |
| `alert_configurations` | `orgId` | Alert routing rules |
| `alert_delivery_logs` | `orgId` | Alert delivery history |
| `webhook_logs` | `orgId` | Incoming webhook audit trail |
| `access_checks` | `orgId` | SDK-reported access state |
| `audit_logs` | `orgId` | Security audit trail |
| `products` | `orgId` | Normalized product catalog |

### 4.2 Isolation Enforcement

- Every database query includes an `orgId` filter derived from the authenticated API key context
- The `orgId` is set by the auth middleware and cannot be overridden by the client
- Database indexes include `orgId` as the leading column for efficient tenant-scoped queries (e.g., `events_org_user_idx`, `issues_org_status_idx`)
- No API endpoint accepts `orgId` as a query parameter -- it is always derived from the authenticated session

### 4.3 Webhook Endpoint Isolation

Webhook endpoints use organization slug in the URL path for routing:
- `POST /webhooks/:orgSlug/stripe`
- `POST /webhooks/:orgSlug/apple`
- `POST /webhooks/:orgSlug/google`

The organization is resolved from the slug, and the corresponding billing connection credentials are used for signature verification. This prevents one organization's webhooks from being processed under another organization's account.

## 5. Webhook Source Authentication

Incoming webhooks from billing providers do not use RevBack API keys. Instead, they are authenticated via provider-specific signature verification:

| Provider | Verification Method | Implementation |
|---|---|---|
| Stripe | `stripe-signature` header + webhook signing secret | `src/ingestion/providers/stripe.ts` |
| Apple | JWS signature on App Store Server Notifications V2 | `src/ingestion/providers/apple.ts` |

- Webhook signing secrets are stored per-organization in `billing_connections.webhookSecret`
- Signature verification runs before the webhook is enqueued for processing (`src/api/webhooks.ts:65-94`)
- Failed signature verification returns HTTP 401 and is logged at WARN level

## 6. Internal Team Access

### 6.1 Source Code

- Source code hosted in private Git repository
- Access limited to authorized development team members
- All changes go through pull request review (see `change-management-policy.md`)

### 6.2 Production Database

- Access restricted to authorized personnel only
- Connections require credentials managed through the hosting provider
- Connection pool configured with limits: max 20 connections, 20s idle timeout, 10s connect timeout (`src/config/database.ts:16-19`)
- Direct database access should be used only for incident response and debugging, not routine operations

### 6.3 Redis

- Access restricted to the application and authorized personnel
- Connection managed via `ioredis` with automatic reconnection (`src/config/queue.ts:24-50`)
- Used for job queues (BullMQ) and rate limiting only -- not for session storage or caching sensitive data

### 6.4 Environment Variables and Secrets

- Sensitive configuration stored as environment variables, never in source control
- Access to production environment variables limited to authorized personnel
- Validated at application startup via Zod schema (`src/config/env.ts`)
- Changes to secrets follow the change management process with security review

## 7. Access Revocation

### 7.1 API Key Revocation

When a customer API key needs to be revoked:
1. Delete the key record from `api_keys` table
2. Revocation is immediate -- the next API call with that key will receive HTTP 401
3. Audit log entry should be created for the revocation action

### 7.2 Employee Offboarding

When a team member leaves:
1. Remove access to source code repository
2. Remove access to production database and hosting
3. Remove access to monitoring and logging systems
4. Rotate any shared secrets the departing member had access to
5. Review audit logs for the member's recent access patterns

### 7.3 Customer Offboarding

When a customer organization is decommissioned:
1. Revoke all API keys for the organization
2. Remove billing connections (delete encrypted credentials)
3. Retain data per the data retention policy (`data-classification-policy.md`) for the required period
4. After retention period, purge all organization data

## 8. Rate Limiting as Access Control

Rate limiting provides a layer of abuse prevention (`src/middleware/rate-limit.ts`):

| Tier | Key | Limit | Purpose |
|---|---|---|---|
| `api` | `orgId` | 100 req/min | Prevent API abuse by authenticated clients |
| `webhook` | Org slug from URL | 500 req/min | Prevent webhook flooding |
| `public` | Client IP (`X-Forwarded-For`) | 30 req/min | Protect unauthenticated endpoints |

Rate limiting is implemented using a Redis-backed token bucket algorithm (`src/queue/rate-limiter.ts`) with atomic Lua scripts for distributed correctness.

## 9. Audit Trail

All access-related actions are logged to the `audit_logs` table (`src/security/audit.ts`):
- `actorType`: `api_key`, `system`, or `user`
- `actorId`: The API key UUID or system identifier
- `action`: The operation performed (e.g., `billing_connection.created`, `issue.resolved`)
- `resourceType` and `resourceId`: What was accessed or modified
- `metadata`: Additional context (e.g., billing source, parameters)
- `createdAt`: Timestamp, indexed for efficient time-range queries

Audit logs are retained indefinitely for compliance purposes.

## 10. Policy Review

This policy is reviewed quarterly. Changes to the authentication, authorization, or multi-tenancy architecture trigger an immediate review.
