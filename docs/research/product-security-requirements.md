# Product Security Requirements: Enterprise-Grade Data Security

**Document Owner:** Product Management
**Last Updated:** 2026-02-09
**Status:** Requirements Definition (Pre-Implementation)

---

## Executive Summary

RevBack ingests sensitive billing data from Stripe, Apple App Store, and Google Play to detect revenue issues. Enterprise customers will require strong data security guarantees before connecting their billing systems. This document defines product requirements for enterprise-grade security, based on analysis of the current codebase and enterprise buyer expectations.

**Key finding:** The current architecture has solid multi-tenant foundations (orgId isolation, API key hashing, webhook signature verification) but has significant gaps in credential encryption, access controls, audit logging, and data lifecycle management that must be closed before enterprise sales.

---

## 1. Data Minimization: What We Actually Need vs. What We Ingest

### Current State (from codebase analysis)

RevBack stores the following data categories:

| Data Category | Where Stored | Contains PII? | Actually Needed? |
|---|---|---|---|
| Raw webhook payloads | `canonical_events.rawPayload`, `webhook_logs.rawBody` | Yes (emails, names, addresses in Stripe objects) | Partially -- needed for replay/debugging, but most fields are unused |
| Webhook headers | `webhook_logs.rawHeaders` | Possibly (forwarded IPs, auth tokens) | Only signature header needed |
| User emails | `users.email` | Yes | Yes, for identity resolution and display |
| External IDs | `user_identities.externalId` | Pseudonymous | Yes, core to identity graph |
| Transaction amounts | `canonical_events.amountCents` | No | Yes, core to revenue detection |
| Stripe API keys | `billing_connections.credentials` | Sensitive secret | Yes, for backfill. But stored as plaintext JSON today |
| Apple private keys | `billing_connections.credentials` | Sensitive secret | Yes, for App Store Server API |
| Alert webhook URLs | `alert_configurations.config` | Sensitive | Yes, for alert delivery |

### Requirements

**P0 (NOW -- before first enterprise customer):**

- **REQ-DM-1:** Strip PII from raw payloads before storage. Create a `rawPayload` sanitizer that removes `customer_email`, `customer_name`, `billing_details.address`, `shipping`, `metadata` (unless it contains our identity keys like `user_id`). Store stripped fields separately with encryption if needed for support cases.
- **REQ-DM-2:** Webhook headers: only store `stripe-signature`, `content-type`, and our custom headers. Drop `authorization`, `cookie`, `x-forwarded-for`.
- **REQ-DM-3:** Document exactly which Stripe/Apple/Google data fields RevBack reads vs. stores, and publish this in the security-info endpoint.

**P1 (Series A):**

- **REQ-DM-4:** Configurable per-org data retention policy that allows customers to choose what raw data is stored.
- **REQ-DM-5:** Data classification labels in schema (PII, financial, operational) for automated policy enforcement.

---

## 2. Encryption

### Current State

- **In transit:** TLS enforced at the infrastructure level (not application-level). Security headers set (X-Frame-Options, X-Content-Type-Options, Referrer-Policy).
- **At rest:** Relies on cloud provider disk encryption. No application-layer encryption.
- **Credentials:** Stored as **plaintext JSON** in `billing_connections.credentials`. The schema has a comment `// encrypted in practice` but no encryption is implemented.
- **API keys:** Properly hashed with SHA-256 before storage (good).
- **JWT secret:** Required to be 16+ characters via Zod validation.

### Requirements

**P0 (NOW):**

- **REQ-ENC-1:** Implement application-layer encryption for `billing_connections.credentials` using AES-256-GCM with a key derived from an environment variable (`ENCRYPTION_KEY`). This is the single highest-priority security fix -- Stripe API keys and Apple private keys are stored in plaintext.
- **REQ-ENC-2:** Encrypt `alert_configurations.config` (contains Slack webhook URLs, email recipient lists).
- **REQ-ENC-3:** Encrypt `users.email` at the application layer. Create a deterministic encryption scheme (HMAC-based) that allows exact-match lookups for identity resolution while keeping emails encrypted at rest.
- **REQ-ENC-4:** Add `ENCRYPTION_KEY` to `env.ts` schema as a required 32-byte hex string. Implement key rotation support (store key version alongside ciphertext).

**P1 (Series A):**

- **REQ-ENC-5:** Field-level encryption for `canonical_events.rawPayload` sensitive fields using envelope encryption with per-org keys.
- **REQ-ENC-6:** Customer-managed encryption keys (CMEK/BYOK) -- enterprise customers bring their own KMS key, RevBack wraps data keys with it.
- **REQ-ENC-7:** TLS certificate pinning for outbound connections to Stripe/Apple/Google APIs.

---

## 3. Access Controls: RBAC, SSO, MFA, Audit Logs

### Current State

- **Authentication:** API key only (`src/middleware/auth.ts`). No user accounts, no SSO, no MFA.
- **Authorization:** Binary -- you either have an API key for an org or you don't. The `apiKeys.scopes` field exists in the schema but is **never checked** in the middleware.
- **Audit logging:** None. No record of who did what or when. `apiKeys.lastUsedAt` is updated but that's the extent of it.
- **Admin routes:** Exist at `/api/v1/admin/*` (DLQ, queues, scans) but use the same API key auth -- no privilege escalation required.

### Requirements

**P0 (NOW):**

- **REQ-AC-1:** Enforce API key scopes. Define and implement scope checking:
  - `read:issues` -- view issues, dashboard, users
  - `write:issues` -- resolve, dismiss, acknowledge issues
  - `admin:connections` -- manage billing connections, trigger backfill
  - `admin:alerts` -- manage alert configurations
  - `admin:system` -- access admin routes (DLQ, queues, scans)
  - `access_check:write` -- submit access check data (for SDK integration)
- **REQ-AC-2:** Implement audit logging. Create an `audit_logs` table recording: `orgId`, `apiKeyId`, `action`, `resourceType`, `resourceId`, `ipAddress`, `timestamp`, `requestDetails` (sanitized). Log all write operations and all data access.
- **REQ-AC-3:** Separate admin API keys from regular API keys. Admin operations require an API key with explicit admin scopes.

**P1 (Series A):**

- **REQ-AC-4:** User accounts with email/password login for the dashboard. Support inviting team members with roles: Owner, Admin, Viewer.
- **REQ-AC-5:** SSO integration via SAML 2.0 and OpenID Connect (Okta, Azure AD, Google Workspace). Enterprise customers will require this.
- **REQ-AC-6:** MFA enforcement (TOTP) for user accounts. Configurable per-org policy.
- **REQ-AC-7:** Session management with configurable timeout, concurrent session limits, and forced logout.

**P2 (Post Series A):**

- **REQ-AC-8:** IP-based access restrictions per API key (allowlisting).
- **REQ-AC-9:** Temporary access tokens for support/debugging (auto-expire after 1 hour).

---

## 4. Data Residency and Sovereignty

### Current State

- Single-region deployment. No data residency controls.
- No visibility into where data is processed or stored.

### Requirements

**P0 (NOW):**

- **REQ-DR-1:** Document current data residency (which cloud region, which provider). Add this to the `security-info` endpoint.
- **REQ-DR-2:** Ensure all data processing happens in the same region as storage (no cross-region API calls for normal operations).

**P1 (Series A):**

- **REQ-DR-3:** EU deployment option. Support deploying a full RevBack stack in eu-west-1 (or equivalent) for EU customers. This is a hard requirement for GDPR compliance with large EU enterprises.
- **REQ-DR-4:** Per-org data residency configuration. The org's region is chosen at creation time and enforced throughout the data lifecycle.

**P2 (Post Series A):**

- **REQ-DR-5:** Multi-region with data isolation guarantees. Data from org A (US) never touches infrastructure in org B's region (EU), even transiently.

---

## 5. Data Retention and Deletion

### Current State

- No data retention policies. All data is stored indefinitely.
- No data deletion capability. The `security-info` endpoint claims retention periods (2 years for events, 90 days for webhook logs) but **none of this is implemented**.
- No right-to-delete support despite claiming GDPR compliance.

### Requirements

**P0 (NOW -- the security-info endpoint is making false claims):**

- **REQ-RET-1:** Implement the retention policies already documented in `security-info`:
  - Webhook logs (`webhook_logs`): auto-delete after 90 days
  - Raw payloads in `canonical_events.rawPayload`: redact after 2 years (keep the normalized fields, null out the raw payload)
  - Implementation: a BullMQ scheduled job that runs daily and enforces retention.
- **REQ-RET-2:** Right-to-delete API endpoint: `DELETE /api/v1/users/:userId` that:
  - Deletes all `user_identities` for the user
  - Anonymizes `canonical_events` referencing the user (null out `userId`, redact PII from `rawPayload`)
  - Deletes `entitlements` for the user
  - Anonymizes `issues` referencing the user
  - Deletes `access_checks` for the user
  - Logs the deletion in `audit_logs`
  - Returns a confirmation receipt with deletion timestamp
- **REQ-RET-3:** Org deletion: `DELETE /setup/org` that performs cascading deletion of all org data with a 30-day grace period (soft delete first, hard delete after 30 days).

**P1 (Series A):**

- **REQ-RET-4:** Configurable retention policies per org. Let customers choose: 30 days, 90 days, 1 year, 2 years for each data category.
- **REQ-RET-5:** Data export API: `GET /api/v1/export` that generates a JSON/CSV export of all data for an org (GDPR portability requirement).
- **REQ-RET-6:** Automated data retention reports showing what data exists, when it was created, and when it will be purged.

---

## 6. OAuth vs. API Key: Platform Authentication

### Current State

- **Stripe:** Customer pastes their Stripe secret key directly into RevBack (`POST /setup/stripe`). This is the simplest approach but means RevBack has full Stripe API access forever.
- **Apple:** Customer pastes App Store Connect API credentials (keyId, issuerId, bundleId, privateKey). Similar concern.
- **Google:** Not yet implemented.

### Platform OAuth Support Analysis

| Platform | OAuth Available? | Recommended Approach | Notes |
|---|---|---|---|
| **Stripe** | Yes -- Stripe Connect (OAuth 2.0) | Use Stripe Connect OAuth flow for onboarding. Customer authorizes specific scopes. Token is refreshable and revocable. | Supports `read_only` and `read_write` modes. We only need `read_only`. Customer can revoke access from their Stripe dashboard. |
| **Apple** | No -- API key only | Continue with API key approach. App Store Server API uses JWT signed with a private key. No OAuth option. | Mitigate by requesting minimum-scope keys and documenting which App Store Connect role is sufficient. |
| **Google** | Yes -- Google Cloud service account or OAuth 2.0 | Use service account with minimum IAM roles for Google Play Developer API. | `androidpublisher` API requires specific scopes. Service account keys should be rotated. |

### Requirements

**P0 (NOW):**

- **REQ-AUTH-1:** Implement Stripe Connect OAuth flow as the primary Stripe onboarding method. Keep API key paste as a fallback for customers who can't use OAuth (self-hosted Stripe, etc.). OAuth benefits: revocable, scoped, no secret key stored.
- **REQ-AUTH-2:** For Apple: document the minimum App Store Connect role required (Finance or App Manager, NOT Admin). Add this guidance to the onboarding flow and security-info.
- **REQ-AUTH-3:** Implement credential rotation reminders. Track when credentials were last rotated and alert the customer if they haven't rotated in 90 days.

**P1 (Series A):**

- **REQ-AUTH-4:** Google Play integration using service account with minimum IAM permissions (`androidpublisher.readonly` scope).
- **REQ-AUTH-5:** Automatic token refresh for OAuth-connected platforms. Handle refresh failures with graceful degradation and customer notification.

---

## 7. Network Security

### Current State

- CORS configured with `ALLOWED_ORIGINS` env var (defaults to `localhost:5173`).
- Security headers set (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy).
- No rate limiting on any endpoints.
- No IP allowlisting.
- Webhook endpoints are publicly accessible (by design -- billing platforms need to reach them).
- No VPC peering or private connectivity option.

### Requirements

**P0 (NOW):**

- **REQ-NET-1:** Rate limiting on all API endpoints. Suggested limits:
  - Webhook ingestion: 1000 req/min per org (to handle burst webhook delivery)
  - API reads (dashboard, issues, users): 100 req/min per API key
  - API writes (resolve issue, update config): 30 req/min per API key
  - Onboarding endpoints: 10 req/min per IP
  - Implementation: use Redis-backed rate limiter (we already have Redis)
- **REQ-NET-2:** Webhook endpoint IP validation. Verify that incoming webhooks come from known Stripe/Apple/Google IP ranges. Log (but don't block initially) requests from unknown IPs to avoid false positives during rollout.
  - Stripe IP ranges: published at [https://stripe.com/docs/ips](https://stripe.com/docs/ips)
  - Apple: verify via JWS certificate chain (already implemented)
  - Google: published at Google Cloud documentation
- **REQ-NET-3:** Add `Strict-Transport-Security` (HSTS) header to enforce HTTPS.
- **REQ-NET-4:** Add `Content-Security-Policy` header for the dashboard.

**P1 (Series A):**

- **REQ-NET-5:** Customer-configurable IP allowlisting for API access. Enterprise customers can restrict API key usage to their office/VPN IP ranges.
- **REQ-NET-6:** VPC peering option for customers who want private connectivity (no public internet traversal). Relevant for AWS PrivateLink, GCP Private Service Connect.
- **REQ-NET-7:** Outbound IP documentation: publish the exact IP ranges RevBack uses for outbound connections (to Stripe API, Apple API) so customers can add them to their firewall rules.

---

## 8. Monitoring and Incident Response

### Current State

- Structured logging with Pino (good foundation).
- No centralized log aggregation.
- No security event monitoring.
- No alerting on suspicious activity (failed auth, unusual access patterns).
- No incident response runbook.
- Basic error handling in the Hono error middleware.
- Queue monitoring exists at `/api/v1/admin/queues` and DLQ at `/api/v1/admin/dlq`.

### Requirements

**P0 (NOW):**

- **REQ-MON-1:** Security event logging. Log these events to a dedicated security log stream:
  - Failed authentication attempts (invalid API key, expired key)
  - API key creation and deletion
  - Billing connection changes (new connection, credential update)
  - Data access patterns (unusual volume of reads)
  - Admin endpoint access
  - Webhook signature verification failures (potential tampering)
- **REQ-MON-2:** Alert on security anomalies:
  - >10 failed auth attempts from same IP in 5 minutes
  - API key used from a new IP for the first time (informational)
  - Billing credentials changed
  - Mass data access (>100 user profiles viewed in 1 hour)
- **REQ-MON-3:** Incident response playbook documenting:
  - How to rotate a compromised API key
  - How to revoke a compromised billing connection
  - How to identify data exposed during a breach
  - Communication templates for affected customers
  - Internal escalation path

**P1 (Series A):**

- **REQ-MON-4:** SIEM integration (export security logs to customer's SIEM via webhook or syslog).
- **REQ-MON-5:** SOC 2 evidence collection automation. Automatically generate evidence for SOC 2 audits: access logs, change logs, encryption verification, etc.
- **REQ-MON-6:** Customer-facing security dashboard showing: last API key usage, failed auth count, active sessions, data access summary.

---

## 9. Prioritized Implementation Roadmap

### Phase 1: NOW (Pre-Revenue / First Enterprise Customers)

These are **blockers for enterprise sales**. An enterprise buyer will ask about each of these during security review.

| Priority | Requirement | Effort | Why Now |
|---|---|---|---|
| P0-CRITICAL | REQ-ENC-1: Encrypt billing credentials | 2-3 days | Plaintext Stripe API keys in DB is a disqualifying finding |
| P0-CRITICAL | REQ-ENC-2: Encrypt alert configs | 1 day | Slack webhook URLs are bearer tokens |
| P0-CRITICAL | REQ-RET-1: Implement claimed retention policies | 2-3 days | security-info endpoint makes false claims |
| P0-HIGH | REQ-AC-1: Enforce API key scopes | 2-3 days | Admin operations need to be restricted |
| P0-HIGH | REQ-AC-2: Audit logging | 3-4 days | Enterprise compliance requirement |
| P0-HIGH | REQ-NET-1: Rate limiting | 1-2 days | Basic DoS protection |
| P0-HIGH | REQ-DM-1: Sanitize raw payloads | 2-3 days | Reduce PII surface area |
| P0-HIGH | REQ-AUTH-1: Stripe OAuth | 3-5 days | Eliminates secret key storage for Stripe |
| P0-MEDIUM | REQ-RET-2: Right-to-delete API | 2-3 days | GDPR requirement |
| P0-MEDIUM | REQ-MON-1: Security event logging | 2-3 days | Incident response capability |
| P0-MEDIUM | REQ-ENC-3: Encrypt user emails | 1-2 days | PII protection |
| P0-MEDIUM | REQ-NET-3: HSTS header | 0.5 day | Low effort, high signal to security reviewers |

**Estimated total: 4-6 weeks of focused engineering work**

### Phase 2: Series A (Enterprise Scale)

| Requirement | Effort | Trigger |
|---|---|---|
| REQ-AC-4-7: User accounts, SSO, MFA | 4-6 weeks | First enterprise with >5 team members |
| REQ-DR-3-4: EU data residency | 3-4 weeks | First EU enterprise customer |
| REQ-ENC-5-6: Field-level + BYOK encryption | 3-4 weeks | SOC 2 Type II audit |
| REQ-RET-4-5: Configurable retention + export | 2-3 weeks | GDPR audit or >10 customers |
| REQ-MON-4-5: SIEM + SOC 2 automation | 2-3 weeks | SOC 2 Type II audit |
| REQ-NET-5-6: IP allowlisting, VPC peering | 2-3 weeks | Fortune 500 customer |

### Phase 3: Post Series A (Market Expansion)

- Customer-managed encryption keys (BYOK/CMEK)
- Multi-region deployment with full isolation
- FedRAMP / HIPAA compliance (if entering healthcare vertical)
- Advanced threat detection (ML-based anomaly detection on access patterns)

---

## 10. Minimum Permission Scopes per Platform

### Stripe

**For webhook-only monitoring (recommended default):**
- No API key needed if only receiving webhooks
- Webhook events needed: `customer.subscription.*`, `invoice.payment_succeeded`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.*`

**For backfill + active monitoring (requires API key):**

| Stripe Permission | Why Needed | Can We Function Without? |
|---|---|---|
| `Subscriptions: Read` | Backfill active subscriptions | Yes, but no historical data |
| `Customers: Read` | Identity resolution, user lookup | Degraded -- can't link users across events |
| `Invoices: Read` | Financial details for revenue impact | Degraded -- estimated amounts only |
| `Events: Read` | Historical event backfill | Yes, but no historical data |
| `Charges: Read` | Refund and chargeback details | Degraded -- refund detection still works via webhooks |

**NOT needed (and we should explicitly NOT request):**
- Any `Write` permissions
- `Customers: Write`
- `PaymentIntents`
- `Checkout`
- `Products/Prices: Write`
- `Transfers`
- `Payouts`
- `Balance`
- `Account`

**RevBack should use Stripe Connect OAuth with `read_only` mode, which automatically restricts to read-only access.**

### Apple App Store

**Minimum App Store Connect role:** `Finance` or `App Manager`

| Apple Credential | Why Needed | Minimum Scope |
|---|---|---|
| Key ID + Issuer ID + Private Key | App Store Server API for transaction lookup | Finance role key is sufficient |
| Webhook notifications (V2) | Real-time subscription events | No API key needed -- Apple pushes to our URL |
| `appAccountToken` | Cross-platform identity resolution | Customer sets this in their app code -- we just read it |

**NOT needed:**
- Admin-level App Store Connect access
- TestFlight access
- App metadata access
- App Store Connect API (for app management)

### Google Play

**Minimum service account permissions:**

| Google Permission | Why Needed |
|---|---|
| `androidpublisher.readonly` | Read subscription status and purchase details |
| Real-time Developer Notifications (RTDN) | Push notifications for subscription changes |

**NOT needed:**
- `androidpublisher` write access
- Google Cloud Platform admin
- Firebase access
- Play Console admin

---

## Appendix A: Current Security Architecture Gaps (Codebase Audit)

| File | Issue | Severity |
|---|---|---|
| `src/api/onboarding.ts:195` | Stripe secret key stored as plaintext JSON: `credentials: { apiKey: stripeSecretKey }` with `// TODO: encrypt at rest` | CRITICAL |
| `src/api/onboarding.ts:245-250` | Apple private key stored as plaintext JSON | CRITICAL |
| `src/ingestion/backfill/stripe-backfill.ts:203-204` | Reads Stripe key from plaintext: `const creds = conn.credentials as { apiKey: string }` | CRITICAL (downstream of above) |
| `src/middleware/auth.ts:70-73` | `lastUsedAt` update is fire-and-forget with `.catch(() => {})` -- audit trail gaps | MEDIUM |
| `src/middleware/auth.ts` | API key scopes exist in schema but are never checked | HIGH |
| `src/api/onboarding.ts:48` | Security-info is a public endpoint (no auth) -- fine for static docs but verify no dynamic data | LOW |
| `src/index.ts:62-67` | CORS `origin` defaults to `localhost:5173` -- needs production configuration | MEDIUM |
| `src/index.ts:119-126` | Error handler leaks stack traces in dev mode -- ensure `NODE_ENV=production` in prod | LOW |
| `src/api/onboarding.ts:646-731` | security-info claims retention policies, encryption, and SOC 2 progress that are **not implemented** | HIGH (misleading claims) |
| `src/ingestion/pipeline.ts:44-53` | Raw webhook body stored in `webhook_logs.rawBody` with no PII sanitization | MEDIUM |
| All API routes | No rate limiting on any endpoint | HIGH |
| All API routes | No audit logging of operations | HIGH |

## Appendix B: Data Flow Diagram (Security Perspective)

```
External Billing Platforms                RevBack System                    Customer Dashboard
 +---------+                          +------------------+
 | Stripe  |--- webhook (HTTPS) ----->| Webhook Handler  |
 | Apple   |--- JWS signed ---------->| Sig Verification |
 | Google  |--- pub/sub ------------->| Normalization    |
 +---------+                          +--------+---------+
                                               |
        Backfill (API call using              |
        customer's credentials)        +-------v--------+
               |                       | Identity       |
               |                       | Resolution     |
               |                       +-------+--------+
               |                               |
        +------v-------+              +--------v--------+
        | Stripe API   |              | Canonical Event |
        | (read-only)  |              | Storage (PG)    |
        +--------------+              +--------+--------+
                                               |
                                      +--------v--------+
                                      | Entitlement     |     +------------+
                                      | Engine          |---->| Issues DB  |
                                      | Detection       |     +-----+------+
                                      +-----------------+           |
                                                              +-----v------+
                                                              | Dashboard  |
                                                              | API (auth) |
                                                              +-----+------+
                                                                    |
                                                              +-----v------+
                                                              | React App  |
                                                              +------------+

Data at risk:
- Stripe API keys (stored, used for backfill)
- Apple private keys (stored, used for JWT generation)
- User emails (stored for identity resolution)
- Transaction amounts (stored for revenue impact)
- Raw webhook payloads (stored, contain PII)
- Slack webhook URLs (stored for alert delivery)
```

## Appendix C: Compliance Readiness Checklist

| Requirement | SOC 2 | GDPR | CCPA | Current Status |
|---|---|---|---|---|
| Encryption at rest | Required | Required | Recommended | Partial (disk-level only) |
| Encryption in transit | Required | Required | Required | Yes (TLS) |
| Access controls | Required | Required | Required | Minimal (API key only) |
| Audit logging | Required | Required | Recommended | Not implemented |
| Data minimization | Recommended | Required | Recommended | Not implemented |
| Right to delete | N/A | Required | Required | Not implemented |
| Data portability | N/A | Required | N/A | Not implemented |
| Breach notification | Required | Required (72h) | Required (45 days) | No process defined |
| Data residency | Optional | Required for EU | N/A | Single region |
| Vendor risk management | Required | Required | Recommended | N/A |
| Incident response plan | Required | Required | Recommended | Not documented |
| Data retention policy | Required | Required | Required | Claimed but not enforced |
