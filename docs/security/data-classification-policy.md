# Data Classification Policy

**RevBack, Inc.**
**Effective Date:** February 2026
**Last Reviewed:** February 2026
**Owner:** Engineering Lead
**Classification:** Internal

---

## 1. Purpose

This policy classifies all data handled by RevBack according to sensitivity and defines handling requirements for each classification level. RevBack processes billing credentials and subscription data on behalf of enterprise customers, making accurate data classification essential for applying appropriate controls.

## 2. Scope

This policy covers all data stored, processed, or transmitted by RevBack systems, including:
- Data in PostgreSQL database tables
- Data in Redis (job queues, rate limit state)
- Data in application memory (during request processing)
- Data in logs (Pino structured output)
- Data transmitted to/from external services
- Configuration and secrets (environment variables)

## 3. Classification Levels

### 3.1 Confidential

**Definition:** Data whose exposure would directly compromise customer accounts or RevBack's security posture. Requires the strongest controls.

| Data Element | Storage Location | Protection Mechanism | Code Reference |
|---|---|---|---|
| Stripe API keys (customer) | `billing_connections.credentials` | AES-256-GCM encryption | `src/security/credentials.ts`, `src/security/encryption.ts` |
| Apple private keys (customer) | `billing_connections.credentials` | AES-256-GCM encryption | `src/security/credentials.ts`, `src/security/encryption.ts` |
| Stripe webhook signing secrets | `billing_connections.webhookSecret` | Database column | `src/models/schema.ts:117` |
| RevBack API keys (plaintext) | Returned once at creation, never stored | SHA-256 hash stored in `api_keys.keyHash` | `src/middleware/auth.ts:88-90` |
| `CREDENTIAL_ENCRYPTION_KEY` | Environment variable | Not stored in database or code | `src/config/env.ts:44` |
| `JWT_SECRET` | Environment variable | Not stored in database or code | `src/config/env.ts:19` |
| `API_KEY_SALT` | Environment variable | Not stored in database or code | `src/config/env.ts:20` |
| `ANTHROPIC_API_KEY` | Environment variable | Not stored in database or code | `src/config/env.ts:34` |
| SMTP credentials | Environment variables | Not stored in database or code | `src/config/env.ts:24-28` |
| Slack tokens | Environment variables | Not stored in database or code | `src/config/env.ts:38-41` |
| Customer webhook signing secrets | `alert_configurations.config` | JSONB column (contains `signingSecret`) | `src/models/types.ts:151` |

**Handling requirements:**
- Must be encrypted at rest using AES-256-GCM when stored in the database
- Must never appear in logs (enforced by Pino redaction paths in `src/config/logger.ts`)
- Must never be included in API responses (except API key returned once at org creation)
- Must never be committed to source control
- Access limited to the credential encryption/decryption code paths
- Rotation procedures documented and tested

### 3.2 Internal

**Definition:** Data that is sensitive but whose exposure would not directly compromise customer accounts. Requires access controls and encryption at rest but less restrictive handling than Confidential.

| Data Element | Storage Location | Protection Mechanism | Retention |
|---|---|---|---|
| Customer email addresses | `users.email` | Database encryption at rest, org-scoped access | Until account deletion |
| External user IDs | `user_identities.externalId` | Database encryption at rest, org-scoped access | Until account deletion |
| Billing event details | `canonical_events` | Database encryption at rest, org-scoped access, PII sanitized in raw payload | Events: indefinite; raw payload: 2 years |
| Entitlement state | `entitlements` | Database encryption at rest, org-scoped access | Indefinite |
| Detected issues and evidence | `issues` | Database encryption at rest, org-scoped access | Indefinite |
| Audit log entries | `audit_logs` | Database encryption at rest, org-scoped access | Indefinite |
| Alert configurations | `alert_configurations` | Database encryption at rest, org-scoped access | Until deleted |
| Alert delivery logs | `alert_delivery_logs` | Database encryption at rest, org-scoped access | Indefinite |
| Webhook payloads (raw) | `webhook_logs.rawBody` | Database encryption at rest, org-scoped access, headers sanitized | 90 days |
| Webhook headers | `webhook_logs.rawHeaders` | Sanitized to allowlist before storage | 90 days |
| Access check results | `access_checks` | Database encryption at rest, org-scoped access | Indefinite |
| Job queue payloads | Redis (BullMQ) | Redis access control | Transient (24h for completed, retained for failed) |

**Handling requirements:**
- Must be scoped to the owning organization (`orgId` on every query)
- Must be encrypted at rest (database-level encryption)
- PII within payloads must be sanitized before storage where possible (`src/security/sanitize.ts`)
- Must not appear in logs unless redacted (Pino redaction for email, name, etc.)
- Access via authenticated API endpoints with appropriate scope enforcement
- Subject to data retention schedules (see Section 5)

### 3.3 Public

**Definition:** Data that can be freely shared without security implications.

| Data Element | Access Method | Notes |
|---|---|---|
| Product catalog metadata | `products` table (name, external IDs) | Non-sensitive product identifiers |
| API documentation | `/setup/security-info` endpoint | Public security posture overview |
| Health check response | `GET /health` | Returns `{ status: 'ok', version: '0.1.0' }` |
| Error messages (production) | API error responses | Generic messages only, no internal details |
| Organization slugs | Webhook URL paths | Used in public webhook URLs |
| Issue type definitions | `src/detection/detector-meta.ts` | Category and recommended action templates |

**Handling requirements:**
- No special protection required
- Should not inadvertently include Internal or Confidential data
- Production error responses must not include stack traces or internal paths (`src/index.ts:141-148`)

## 4. PII Handling

### 4.1 PII Inventory

RevBack processes limited PII as part of billing event data:

| PII Type | Source | Storage | Sanitization |
|---|---|---|---|
| Customer email | Stripe webhook payloads | `users.email` column; stripped from raw payload before storage | `src/security/sanitize.ts:8-13` (Stripe fields), Pino redaction for logs |
| Customer name | Stripe webhook payloads | Not stored in canonical model; stripped from raw payload | `src/security/sanitize.ts:8-13` |
| Billing details | Stripe webhook payloads | Not stored; stripped from raw payload | `src/security/sanitize.ts:8-13` |
| Shipping address | Stripe webhook payloads | Not stored; stripped from raw payload | `src/security/sanitize.ts:8-13` |
| Phone number | Stripe nested customer object | Not stored; stripped from raw payload | `src/security/sanitize.ts:39-46` |

### 4.2 PII Minimization

- Full webhook payloads are held in application memory only for signature verification
- Before database storage, PII fields are replaced with `[REDACTED]` (`src/security/sanitize.ts:35`)
- The canonical event model (`canonical_events` table) does not include PII columns -- it stores billing identifiers only
- Email addresses are stored in the `users` table for identity resolution but not propagated to other tables

### 4.3 Logging Safeguards

Pino logger redaction prevents PII from appearing in logs (`src/config/logger.ts:9-63`):

Redacted fields at three nesting levels:
- `email`, `customer_email`, `receipt_email`, `customer_name`, `name`
- `billing_details`, `shipping`
- `apiKey`, `api_key`, `secret`, `password`, `token`
- `credit_card`, `card_number`, `privateKey`, `private_key`

All redacted values appear as `[REDACTED]` in log output.

## 5. Data Retention

Data retention is enforced automatically by the retention worker (`src/queue/retention-worker.ts`):

| Data Type | Retention Period | Deletion Method | Schedule |
|---|---|---|---|
| Webhook logs (`webhook_logs`) | 90 days | Full row deletion | Daily at 3 AM UTC |
| Raw event payloads (`canonical_events.rawPayload`) | 2 years | Column set to NULL | Daily at 3 AM UTC |
| Canonical events (metadata) | Indefinite | Not deleted | -- |
| Issues | Indefinite | Not deleted | -- |
| Entitlements | Indefinite | Not deleted | -- |
| Audit logs | Indefinite | Not deleted | -- |
| Users and identities | Until account deletion | Manual process | On request |
| BullMQ completed jobs | 24 hours / 10,000 count | BullMQ auto-cleanup | Continuous |
| BullMQ failed jobs | Until manually reviewed | Retained in DLQ | Manual review via `/api/v1/admin/dlq` |
| Redis rate limit state | 5 minutes of inactivity | Redis TTL | Automatic |

Retention deletions are processed in batches of 1,000 records to minimize database lock contention.

## 6. Data Handling Matrix

| Action | Confidential | Internal | Public |
|---|---|---|---|
| Store in database | AES-256-GCM + DB encryption | DB encryption + org-scoped | No restriction |
| Include in API response | Never (except one-time key return) | Only to authenticated, org-scoped requests with valid scope | Open |
| Include in logs | Never (Pino redaction enforced) | Only with PII redacted | Allowed |
| Include in error messages | Never | Never | Generic messages only |
| Transmit externally | Only to the owning provider | Only in signed outbound webhooks to customer-configured endpoints | Allowed |
| Store in Redis | Never | Transient job payloads only | Allowed |
| Commit to source control | Never | Never | Allowed for templates/examples |

## 7. Data Flow

### 7.1 Inbound Webhook Flow

```
Billing Provider (Stripe/Apple)
  |
  v
POST /webhooks/:orgSlug/:source
  |
  +-- Signature verification (using Confidential webhook secret)
  +-- Header sanitization (strip non-allowlisted headers)
  +-- Webhook log created (sanitized headers, raw body retained 90 days)
  +-- Enqueue to BullMQ
  |
  v
Webhook Worker
  |
  +-- Normalize event (extract billing data from raw payload)
  +-- Sanitize payload (strip PII before storage)
  +-- Resolve user identity
  +-- Store canonical event (Internal classification)
  +-- Update entitlement state
  +-- Run issue detectors
  +-- Dispatch alerts if issues found
```

### 7.2 Credential Storage Flow

```
Customer provides Stripe API key or Apple private key
  |
  v
POST /setup/stripe or /setup/apple
  |
  +-- Validate credentials work (test API call)
  +-- writeCredentials() -> encrypt(JSON.stringify(creds))
  +-- AES-256-GCM encryption with random IV
  +-- Store encrypted string in billing_connections.credentials
  +-- Audit log entry created
  |
  v
On use (webhook verification, backfill):
  +-- readCredentials() -> decrypt() -> JSON.parse()
  +-- Decrypted value exists in memory only during the operation
  +-- Never logged, never included in API responses
```

## 8. Third-Party Data Sharing

RevBack transmits data to third-party services only as follows:

| Service | Data Sent | Purpose | Classification |
|---|---|---|---|
| Stripe API | Stripe API key (Confidential), list queries | Credential verification, backfill import | API key sent in Authorization header over TLS |
| Apple App Store Server API | Signed JWT using Apple private key (Confidential) | Credential verification | JWT sent over TLS |
| Anthropic (Claude API) | Issue evidence, billing event summaries (Internal, anonymized) | AI-powered root cause analysis | Sent over TLS, subject to Anthropic's data policy |
| Customer Slack webhooks | Issue summaries (Internal) | Alert delivery | Sent to customer-configured webhook URL over HTTPS |
| Customer email (SMTP) | Issue summaries (Internal) | Alert delivery | Sent via configured SMTP server |
| Customer webhooks | Issue data (Internal), HMAC-signed | Alert delivery | Sent to customer-configured URL with HMAC-SHA256 signature |

## 9. Policy Review

This policy is reviewed quarterly and when new data types are introduced to the system or new third-party integrations are added. Changes to the data model (`src/models/schema.ts`) trigger a review of this document.
