# Information Security Policy

**RevBack, Inc.**
**Effective Date:** February 2026
**Last Reviewed:** February 2026
**Owner:** Engineering Lead
**Classification:** Internal

---

## 1. Purpose

This policy establishes the information security requirements for RevBack, a subscription revenue protection platform that processes billing data from enterprise customers' Stripe, Apple App Store, and Google Play integrations. RevBack handles sensitive credentials (API keys, private keys) and billing event data on behalf of customers, requiring rigorous controls commensurate with that trust.

## 2. Scope

This policy applies to:
- The RevBack application (backend API server, job queue workers, dashboard)
- All infrastructure: PostgreSQL database, Redis instance, application servers
- All personnel who access RevBack systems or source code
- All customer data ingested through webhooks or API backfill
- Third-party services integrated with RevBack (Stripe API, Apple App Store Server API, Anthropic AI)

## 3. Data Classification

RevBack classifies data into three tiers. See `data-classification-policy.md` for full details.

| Classification | Examples | Storage Requirements |
|---|---|---|
| **Confidential** | Stripe API keys, Apple private keys, webhook signing secrets, CREDENTIAL_ENCRYPTION_KEY, JWT_SECRET | AES-256-GCM encrypted at application layer (`src/security/encryption.ts`). Never logged. |
| **Internal** | Billing events, entitlement state, user identities, issue evidence, audit logs | Encrypted at rest (database-level). Org-scoped access only. PII redacted before storage where possible. |
| **Public** | Product catalog metadata, API documentation, security-info endpoint | No special handling required. |

## 4. Encryption Standards

### 4.1 Encryption at Rest

**Credential encryption:** Customer billing credentials (Stripe API keys, Apple private keys) are encrypted using AES-256-GCM before database storage. Implementation in `src/security/encryption.ts`:

- Algorithm: AES-256-GCM with 12-byte random IV and 16-byte authentication tag
- Key: 256-bit key derived from `CREDENTIAL_ENCRYPTION_KEY` environment variable (64 hex characters)
- Format: `enc:<iv>:<authTag>:<ciphertext>` (all base64-encoded)
- Each encryption operation uses a unique random IV
- The `src/security/credentials.ts` module provides `writeCredentials()` / `readCredentials()` for transparent encrypt/decrypt of the `billing_connections.credentials` column

**Database encryption:** PostgreSQL disk-level encryption via cloud provider managed keys.

### 4.2 Encryption in Transit

- All external API communication uses TLS 1.3
- HSTS header enforced: `Strict-Transport-Security: max-age=31536000; includeSubDomains` (`src/index.ts:88`)
- Internal Redis connections use the provider's TLS configuration when available

### 4.3 Key Management

- `CREDENTIAL_ENCRYPTION_KEY`: Stored as environment variable, never committed to source control. Validated at startup as exactly 64 hex characters via Zod schema (`src/config/env.ts:44`)
- `JWT_SECRET`: Minimum 16 characters, validated at startup (`src/config/env.ts:19`)
- API keys: Generated using `crypto.randomBytes(32)` and stored as SHA-256 hashes (`src/middleware/auth.ts:88-90`). The plaintext key is returned exactly once at organization creation and never stored.

## 5. Access Control

See `access-control-policy.md` for full details.

### 5.1 API Authentication

All API endpoints (except `/health`, `/setup/org`, `/setup/security-info`, and webhook receivers) require Bearer token authentication. API keys:

- Prefixed with `rev_` for identification (`src/middleware/auth.ts:34`)
- Stored as SHA-256 hashes with 8-character prefix for lookup (`src/middleware/auth.ts:88-90`)
- Support expiration dates, checked on every request (`src/middleware/auth.ts:56-58`)
- Track last-used timestamp for security auditing (`src/middleware/auth.ts:72-75`)

### 5.2 Authorization (Scope System)

API keys support granular scopes defined in `src/security/scopes.ts`:
- `issues:read`, `issues:write`, `alerts:read`, `alerts:write`, `admin:read`, `admin:write`, `setup:write`, `access-checks:read`, `access-checks:write`, `dashboard:read`, `users:read`, `*`
- Scope enforcement via `requireScope()` middleware (`src/middleware/require-scope.ts`)
- Empty scopes array grants full access for backward compatibility with existing keys

### 5.3 Multi-Tenancy Isolation

All data is scoped to organizations via `orgId`. Every database table includes an `orgId` column, and every query filters by the authenticated organization. Cross-tenant data access is architecturally impossible through the API layer.

## 6. Webhook Security

Incoming webhooks from billing providers are verified before processing:

- **Stripe:** Signature verification using `stripe-signature` header and per-organization webhook secret stored in `billing_connections.webhookSecret`
- **Apple:** JWS signature verification of App Store Server Notifications V2
- Verification happens synchronously before enqueuing to the job queue (`src/api/webhooks.ts:65-94`)
- Failed verification returns HTTP 401 and the payload is not processed

Outgoing webhooks to customers use HMAC-SHA256 signing (`src/alerts/webhook-signing.ts`):
- Signing secrets prefixed with `whsec_`, generated using `crypto.randomBytes(32)`
- Signature format: `t=<unix_seconds>,v1=<hex_hmac>`
- Constant-time signature comparison using `crypto.timingSafeEqual`
- Replay protection via 300-second timestamp tolerance

## 7. Data Sanitization

### 7.1 Payload Sanitization

PII is stripped from webhook payloads before database storage (`src/security/sanitize.ts`):
- Stripe PII fields redacted: `customer_email`, `customer_name`, `receipt_email`, `billing_details`, `shipping`
- Nested customer fields redacted: `email`, `name`, `phone`, `address`
- Full payload is held in memory only for signature verification; sanitized version is persisted

### 7.2 Header Sanitization

Only allowlisted headers are stored from webhooks (`src/security/sanitize.ts:51-56`):
- Allowed: `stripe-signature`, `content-type`, `content-length`, `user-agent`
- All other headers (including `Authorization`, cookies, etc.) are stripped

### 7.3 Log Sanitization

Pino logger configured with redaction paths (`src/config/logger.ts:9-63`):
- Redacts PII fields: `email`, `customer_email`, `customer_name`, `receipt_email`, `billing_details`, `shipping`
- Redacts secrets: `apiKey`, `api_key`, `secret`, `password`, `token`, `privateKey`, `private_key`, `credit_card`, `card_number`
- Redaction operates at three depth levels to catch nested objects
- All redacted values replaced with `[REDACTED]`

## 8. Rate Limiting

Token bucket rate limiting implemented via Redis (`src/middleware/rate-limit.ts`, `src/queue/rate-limiter.ts`):

| Tier | Scope | Limit | Refill |
|---|---|---|---|
| `api` | Per organization | 100 requests | 100/minute |
| `webhook` | Per organization slug | 500 requests | 500/minute |
| `public` | Per IP address | 30 requests | 30/minute |

Rate limiting uses atomic Redis Lua scripts for distributed correctness. When limits are exceeded, the API returns HTTP 429 with a `Retry-After` header. Rate limiting fails open (allows requests through) if Redis is unavailable, to prevent service degradation.

## 9. Security Headers

Applied globally to all responses (`src/index.ts:82-89`):
- `X-Frame-Options: DENY` -- prevents clickjacking
- `X-Content-Type-Options: nosniff` -- prevents MIME sniffing
- `Referrer-Policy: strict-origin-when-cross-origin` -- limits referrer leakage
- `Permissions-Policy: microphone=(), camera=(), payment=()` -- disables unnecessary browser APIs
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` -- enforces HTTPS

## 10. Audit Logging

All security-relevant API operations are recorded to the `audit_logs` table (`src/security/audit.ts`):
- Fields: `orgId`, `actorType`, `actorId`, `action`, `resourceType`, `resourceId`, `metadata`, `createdAt`
- Actor types: `api_key`, `system`, `user`
- Audit writes are fire-and-forget to avoid blocking API responses
- Logged actions include: credential creation/update, issue resolution, alert configuration changes

## 11. Data Retention

Automated retention enforced by the data retention worker (`src/queue/retention-worker.ts`):

| Data Type | Retention Period | Action |
|---|---|---|
| Webhook logs | 90 days | Deleted |
| Raw event payloads | 2 years | `rawPayload` column set to NULL |
| Canonical events | Indefinite | Retained (metadata only after 2 years) |
| Issues | Indefinite | Retained for trend analysis |
| Audit logs | Indefinite | Retained for compliance |

Retention worker runs daily at 3 AM UTC via BullMQ scheduled job. Deletions are batched (1000 records per iteration) to avoid database lock contention.

## 12. Error Handling

- Production error responses exclude stack traces and internal details (`src/index.ts:141-148`)
- Development mode includes error messages for debugging
- All unhandled errors are logged with request path context

## 13. Graceful Shutdown

The application implements orderly shutdown on SIGTERM/SIGINT (`src/index.ts:152-191`):
1. Stop accepting new HTTP connections
2. Drain active queue workers (complete in-flight jobs)
3. Close all queue connections and Redis
4. Close database connection pool
5. Exit process

## 14. Environment Configuration

All configuration is validated at startup using Zod schemas (`src/config/env.ts`):
- Required: `DATABASE_URL`, `JWT_SECRET`, `API_KEY_SALT`
- Optional with secure defaults: `REDIS_URL`, `PORT`, `NODE_ENV`, `LOG_LEVEL`
- Sensitive optional: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APPLE_PRIVATE_KEY_PATH`, `CREDENTIAL_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`
- Invalid or missing required configuration causes immediate process exit

## 15. Incident Response

See `incident-response-plan.md` for the full incident response procedure. Security incidents should be reported to security@revback.io. Response time targets:
- Critical: 1 hour
- High: 4 hours
- Medium: 24 hours

## 16. Policy Review

This policy is reviewed quarterly and updated when significant changes are made to the application's security posture. Changes to security controls in the codebase trigger a review of this document.
