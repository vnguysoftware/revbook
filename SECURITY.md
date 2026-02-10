# Security Policy

## Security Overview

RevBack processes sensitive billing data from multiple providers (Stripe, Apple App Store, Google Play, Recurly) on behalf of our customers. We treat security as a core product requirement, not an afterthought. Every layer of the system -- from webhook ingestion to credential storage to log output -- is designed with data protection in mind.

## Reporting a Vulnerability

We take security vulnerabilities seriously and appreciate responsible disclosure from the security community.

### How to Report

**Email:** [security@revback.io](mailto:security@revback.io)

Please include:

- **Description** of the vulnerability and its potential impact
- **Reproduction steps** with enough detail for us to verify the issue
- **Affected component** (API, dashboard, webhook processing, etc.)
- **Impact assessment** -- what data or functionality is at risk
- **Your contact information** for follow-up questions

### Response Timeline

| Stage | Timeframe |
|-------|-----------|
| Acknowledgment | Within 48 hours |
| Triage and severity assessment | Within 5 business days |
| Status update with remediation plan | Within 10 business days |
| Fix deployed (critical/high) | As soon as possible, typically within 30 days |

### Safe Harbor

We will not pursue legal action against individuals who:

- Report vulnerabilities in good faith through the process described above
- Make a reasonable effort to avoid privacy violations, data destruction, and service disruption
- Do not exploit the vulnerability beyond what is necessary to demonstrate it
- Do not access, modify, or delete data belonging to other users or organizations

We ask that you give us reasonable time to address the issue before making any public disclosure.

## Security Architecture

### Authentication

API access is authenticated via bearer tokens with the `rev_` prefix. API keys are **hashed with SHA-256** before storage -- the plaintext key is only returned once at creation time. Each key stores only a prefix (first 8 characters) for identification purposes.

Keys support:

- **Scope-based access control** with granular permissions (e.g., `read:issues`, `write:alerts`)
- **Expiration dates** -- expired keys are rejected at authentication time
- **Last-used tracking** for auditing key activity

### Encryption at Rest

Billing provider credentials (API keys, private keys, service account JSON) are encrypted at the application layer using **AES-256-GCM** before database storage.

- Each encrypted value uses a **unique initialization vector (IV)**
- Authentication tags ensure tamper detection
- **Key rotation** is supported: a current and previous encryption key can be configured simultaneously, allowing zero-downtime key rotation
- Encryption is applied via `CREDENTIAL_ENCRYPTION_KEY` (64 hex character / 32-byte key)
- Legacy plaintext values are handled gracefully during migration

### Encryption in Transit

- All API communications require **TLS 1.2+**
- **HSTS** is enforced with a one-year max-age including subdomains (`Strict-Transport-Security: max-age=31536000; includeSubDomains`)

### Multi-Tenancy Isolation

RevBack uses a shared-infrastructure, isolated-data model. Every database query is scoped to an `orgId`, enforced at the application layer across all tables. Cross-organization data access is architecturally prevented -- there is no API path that returns data without an org scope.

### Webhook Signature Verification

Incoming webhooks from billing providers are verified **before** any processing occurs:

- **Stripe:** HMAC signature verification via webhook signing secret
- **Apple:** App Store Server Notifications V2 signed payload verification
- **Google Play:** Pub/Sub push authentication
- **Recurly:** Webhook signing key verification

Invalid signatures are rejected with a 401 response and logged for monitoring.

### Rate Limiting

Request rates are enforced using a token bucket algorithm with three tiers:

| Tier | Limit | Scope |
|------|-------|-------|
| API (authenticated) | 100 requests/minute | Per organization |
| Webhook | 500 requests/minute | Per organization slug |
| Public | 30 requests/minute | Per IP address |

Rate limiting fails open -- if the rate limiter backend is unavailable, requests are allowed through to maintain availability.

### Security Headers

All responses include the following security headers:

- `X-Frame-Options: DENY` -- prevents clickjacking
- `X-Content-Type-Options: nosniff` -- prevents MIME type sniffing
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: microphone=(), camera=(), payment=()`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`

## Data Protection

### PII Handling

RevBack minimizes PII exposure at multiple levels:

**Log redaction:** All structured logs use Pino with automatic redaction of sensitive fields including `email`, `customer_email`, `customer_name`, `billing_details`, `apiKey`, `secret`, `password`, `token`, `privateKey`, `credit_card`, and `card_number`. Redaction is applied at multiple nesting depths to catch nested objects.

**Payload sanitization:** Before webhook payloads are stored in the database, PII fields are stripped and replaced with `[REDACTED]`. Fields sanitized include customer email, name, receipt email, billing details, shipping address, and nested customer objects (email, name, phone, address).

**Header sanitization:** Only a defined allowlist of headers (`stripe-signature`, `content-type`, `content-length`, `user-agent`) is stored from incoming webhooks. All other headers, including authorization headers, are discarded before storage.

### Credential Storage

Billing provider credentials are:

- Encrypted with AES-256-GCM at the application layer (not just database-level encryption)
- Decrypted only in-memory during active API calls to the billing provider
- Never logged, even at debug level (covered by log redaction rules)
- Rotatable via dual-key support (current + previous key)

### Data Retention

Automated data retention is enforced by a scheduled worker that runs daily:

| Data Type | Retention Period | Cleanup Action |
|-----------|-----------------|----------------|
| Webhook logs | 90 days | Deleted |
| Raw event payloads | 2 years | Nullified (event metadata retained) |
| Issues and resolution history | Indefinite | Retained for trend analysis |
| User identity mappings | Until org deletion | Retained |

### Audit Logging

Security-relevant actions (credential changes, billing connection creation, data access) are recorded in an append-only audit log with the acting API key, organization, action type, resource, and metadata.

### GDPR Compliance

Data subject rights are supported through dedicated API endpoints:

- **Right to access:** `GET /api/v1/data-management/users/:userId/data-export`
- **Right to erasure:** `DELETE /api/v1/data-management/users/:userId/data`
- **Right to portability:** `GET /api/v1/data-management/users/:userId/data-export`
- **Right to rectification:** Supported via standard API operations

A Data Processing Agreement (DPA) is available upon request.

## Infrastructure Security

### Circuit Breakers

External service calls (Stripe API, Apple App Store API, Google Play API, Recurly API) are wrapped in circuit breakers that prevent cascading failures:

- **Failure threshold:** 5 consecutive failures opens the circuit
- **Reset timeout:** 60 seconds before attempting recovery (half-open state)
- **Recovery:** 3 successful calls in half-open state closes the circuit
- Circuit breaker status is exposed via an admin API for monitoring

### Graceful Degradation

The system is designed to degrade gracefully under failure conditions:

- Rate limiting fails open when the backend is unavailable
- Webhook processing returns 200 to providers even if internal enqueuing fails (preventing unnecessary retries)
- Background tasks (audit logging, timestamp updates) use fire-and-forget patterns that do not block API responses
- Graceful shutdown drains in-flight work before closing connections

### Error Handling

Production error responses never expose internal details. Stack traces and error messages are only included in responses when running in development mode. All errors are logged internally with full context for debugging.

## Compliance

| Standard | Status |
|----------|--------|
| **SOC 2 Type I** | Planned (target Q3 2026) |
| **GDPR** | Implemented -- data subject rights APIs available |
| **CCPA** | In progress -- data handling aligned with requirements |

SOC 2 audit reports will be available upon request once completed.

## Security Updates

Security patches are applied as soon as possible after discovery and verification. Customers are notified of security-relevant changes through:

- Email notification to organization administrators for critical issues
- Changelog entries for security improvements
- This document is updated to reflect any changes to our security posture

For questions about our security practices, contact [security@revback.io](mailto:security@revback.io).
