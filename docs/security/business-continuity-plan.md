# Business Continuity Plan

**RevBack, Inc.**
**Effective Date:** February 2026
**Last Reviewed:** February 2026
**Owner:** Engineering Lead
**Classification:** Internal

---

## 1. Purpose

This plan defines how RevBack maintains service availability, recovers from disruptions, and protects customer data during adverse events. RevBack is a subscription revenue protection platform -- service interruptions mean billing issues go undetected, potentially costing customers revenue. This plan ensures continuity of the monitoring and detection capabilities that customers depend on.

## 2. Scope

This plan covers:
- RevBack application server and worker processes
- PostgreSQL database
- Redis instance (BullMQ job queues, rate limiting)
- Webhook ingestion pipeline from billing providers (Stripe, Apple, Google)
- Issue detection and alert delivery systems
- Customer dashboard

## 3. Recovery Objectives

| Metric | Target | Justification |
|---|---|---|
| **RTO (Recovery Time Objective)** | 4 hours | RevBack detects billing issues asynchronously; a 4-hour outage is tolerable. Billing providers retry webhooks for up to 72 hours, so no data is permanently lost during an outage. |
| **RPO (Recovery Point Objective)** | 1 hour | Hourly database backups ensure at most 1 hour of data loss. Webhook events can be re-delivered by Stripe/Apple after recovery. |
| **MTTR (Mean Time to Repair)** | 2 hours | Target for restoring core functionality after an infrastructure failure. |

## 4. Critical Systems and Dependencies

### 4.1 System Architecture

```
                  Stripe / Apple / Google
                          |
                    [Webhook Ingestion]
                          |
                   +------+------+
                   |             |
              [API Server]  [BullMQ Workers]
                   |             |
              +----+----+   +---+---+
              |         |   |       |
          [PostgreSQL] [Redis]  [External APIs]
              |                (Stripe, Apple,
          [Dashboard]          Anthropic)
```

### 4.2 Dependency Criticality

| Component | Criticality | Impact if Unavailable | Recovery Strategy |
|---|---|---|---|
| **PostgreSQL** | Critical | All API requests fail. No event storage, no issue detection, no dashboard. | Restore from automated backup. Cloud provider managed failover if available. |
| **Redis** | High | Job queue halts (webhooks received but not processed). Rate limiting disabled (fails open per `src/middleware/rate-limit.ts:68-70`). | Restart Redis. Queued jobs persist in Redis AOF/RDB. Unprocessed webhooks will be retried by providers. |
| **Application Server** | Critical | All API and webhook endpoints down. Billing providers will queue retries. | Deploy to new instance. Stateless -- no local state to recover. |
| **BullMQ Workers** | High | Webhook processing stops. Events queue up in Redis. Detection halts. Alerts not sent. | Restart workers. Backlog processed automatically from Redis queue. |
| **Stripe API** | Low | Credential verification and backfill unavailable. Core webhook processing unaffected (uses webhookSecret locally). | Wait for Stripe recovery. No RevBack action needed. |
| **Apple API** | Low | Apple credential verification unavailable. Webhook processing unaffected. | Wait for Apple recovery. |
| **Anthropic API** | Low | AI investigation features unavailable. Core detection unaffected. | AI features gracefully degrade when `ANTHROPIC_API_KEY` is not set or API is unreachable (`src/index.ts:60-61`). |
| **SMTP / Email** | Low | Email alerts not delivered. Other alert channels (Slack, webhook) unaffected. | Wait for SMTP recovery. Failed deliveries logged in `alert_delivery_logs`. |

## 5. Backup Procedures

### 5.1 Database Backups

| Aspect | Specification |
|---|---|
| Method | Cloud provider automated backups (point-in-time recovery) |
| Frequency | Continuous WAL archiving + hourly snapshots |
| Retention | 30 days of point-in-time recovery |
| Testing | Monthly backup restoration test to verify data integrity |
| Encryption | Backups encrypted at rest using cloud provider managed keys |

**Tables requiring backup (all in `src/models/schema.ts`):**
- `organizations`, `api_keys` -- customer account data
- `billing_connections` -- encrypted credentials (AES-256-GCM)
- `users`, `user_identities` -- identity graph
- `canonical_events` -- normalized billing events (largest table)
- `entitlements` -- subscription state
- `issues` -- detected problems and resolution history
- `alert_configurations`, `alert_delivery_logs` -- alerting state
- `webhook_logs` -- audit trail (90-day retention)
- `access_checks` -- SDK-reported access state
- `audit_logs` -- security audit trail
- `products` -- product catalog

### 5.2 Redis Persistence

| Aspect | Specification |
|---|---|
| Method | Redis RDB snapshots + AOF (append-only file) |
| Purpose | Preserve BullMQ job queues across restarts |
| Data at risk | In-flight jobs, rate limit state (ephemeral) |
| Recovery | Queue state restored from RDB/AOF on restart. Rate limit state regenerates automatically. |

### 5.3 Source Code

| Aspect | Specification |
|---|---|
| Method | Git repository hosted on managed platform |
| Redundancy | Distributed across developer machines and Git hosting provider |
| Recovery | Clone from any copy of the repository |

### 5.4 Configuration / Secrets

| Aspect | Specification |
|---|---|
| Method | Environment variables managed through hosting provider |
| Backup | Secrets documented (not values) in `.env.example` and `src/config/env.ts` |
| Recovery | Re-provision secrets from secure storage. Note: `CREDENTIAL_ENCRYPTION_KEY` is critical -- losing it means all encrypted credentials in `billing_connections` are unrecoverable. |

**Critical secret for DR:** The `CREDENTIAL_ENCRYPTION_KEY` must be backed up securely and independently. If this key is lost, all customer billing credentials (Stripe API keys, Apple private keys) stored in the database are permanently unrecoverable. Customers would need to re-provision their credentials.

## 6. Disaster Recovery Procedures

### 6.1 Complete Application Failure

**Scenario:** Application server crashes or becomes unresponsive.

1. Deploy application to new instance (stateless -- requires only environment variables)
2. Verify environment variables are configured (`src/config/env.ts` validates at startup)
3. Application connects to existing PostgreSQL and Redis
4. Verify: `GET /health` returns `{ status: 'ok' }`
5. Verify workers: `GET /api/v1/admin/queues` shows active workers
6. Backlog of unprocessed webhooks will drain automatically
7. Billing providers (Stripe, Apple) will retry any webhooks that received no response during the outage

**Estimated recovery time:** 15-30 minutes

### 6.2 Database Failure

**Scenario:** PostgreSQL instance becomes unavailable or data corruption.

1. Activate cloud provider point-in-time recovery to the most recent consistent state
2. Verify database connectivity: application startup will log `Database connection pool created`
3. Run any pending migrations: `npm run migrate`
4. Verify data integrity: spot-check `organizations`, `billing_connections`, `canonical_events` tables
5. If `billing_connections.credentials` are corrupted, customers will need to re-provision credentials
6. Verify application: `GET /health`, then check `GET /setup/status` for a known organization

**Estimated recovery time:** 30 minutes to 2 hours (depending on database size)

**Data loss:** Up to 1 hour of data (RPO target). Billing events received during the gap will be retried by providers.

### 6.3 Redis Failure

**Scenario:** Redis instance becomes unavailable.

1. Restart or provision new Redis instance
2. Configure `REDIS_URL` environment variable
3. Application reconnects automatically (ioredis retry strategy: `src/config/queue.ts:30-33`)
4. BullMQ job state recovers from Redis persistence (RDB/AOF)
5. Rate limit state regenerates naturally -- brief period of no rate limiting (fails open: `src/middleware/rate-limit.ts:68-70`)
6. Re-register scheduled jobs: retention scheduler and scan scheduler re-create their repeatable jobs on startup

**Estimated recovery time:** 5-15 minutes

**Data loss:** In-flight jobs may be lost if AOF is behind. Webhook events will be retried by providers.

### 6.4 Encryption Key Loss

**Scenario:** `CREDENTIAL_ENCRYPTION_KEY` is lost or compromised.

**If lost (cannot decrypt):**
1. All encrypted credentials in `billing_connections.credentials` are unrecoverable
2. Notify all affected customers that they must re-provision their Stripe/Apple credentials
3. Generate new `CREDENTIAL_ENCRYPTION_KEY` (64 hex characters from `crypto.randomBytes(32)`)
4. Customers re-submit credentials via `POST /setup/stripe` and `POST /setup/apple`

**If compromised (attacker may have it):**
1. Follow incident response plan (`incident-response-plan.md`, SEV-1)
2. Generate new `CREDENTIAL_ENCRYPTION_KEY`
3. Re-encrypt all `billing_connections.credentials` values with the new key
4. Notify all customers to rotate their Stripe API keys and Apple private keys
5. Revoke and re-issue all API keys

### 6.5 Provider Outage (Stripe, Apple)

**Scenario:** Billing provider API or webhook delivery is down.

1. RevBack continues operating with existing data
2. Webhook gap detection (`webhook_delivery_gap` detector) will alert customers to the gap
3. Data freshness detection (`data_freshness` detector) will flag stale subscriptions
4. Once the provider recovers, webhooks are retried automatically by the provider
5. For Stripe: manual backfill can be triggered via `POST /setup/backfill/stripe` to catch any missed events

**No RevBack action required** -- the system is designed to detect and report these gaps.

## 7. Graceful Degradation

The application is designed to degrade gracefully when non-critical services are unavailable:

| Service Down | Behavior | Code Reference |
|---|---|---|
| Redis unavailable | Rate limiting disabled (requests allowed through). Job queue halts. | `src/middleware/rate-limit.ts:68-70` |
| Anthropic API unavailable | AI investigation features return "unavailable". Core detection unaffected. | `src/index.ts:60-61` |
| SMTP unavailable | Email alerts fail (logged to `alert_delivery_logs`). Slack and webhook alerts unaffected. | Alert dispatcher error handling |
| Slack unavailable | Slack alerts fail. Email and webhook alerts unaffected. | Alert dispatcher error handling |

## 8. Application Resilience Features

### 8.1 Graceful Shutdown

The application handles SIGTERM and SIGINT for orderly shutdown (`src/index.ts:152-191`):
1. Stop accepting new HTTP connections
2. Drain active BullMQ workers (complete in-flight jobs, stop accepting new ones)
3. Close queue connections and Redis
4. Close database connection pool
5. Exit cleanly

### 8.2 Job Queue Resilience

BullMQ provides built-in resilience (`src/config/queue.ts`):
- Failed jobs are retained in the dead letter queue for manual review (`removeOnFail: false`)
- Completed jobs kept for 24 hours or 10,000 count for debugging
- Workers can be restarted independently of the API server
- Job processing is idempotent (canonical events use `idempotencyKey` for deduplication)

### 8.3 Webhook Idempotency

Canonical events have a unique `idempotencyKey` column (`src/models/schema.ts:202`). If a billing provider retries a webhook that was already processed, the duplicate is rejected at the database level, preventing double-processing.

## 9. Testing and Maintenance

| Activity | Frequency | Owner |
|---|---|---|
| Database backup restoration test | Monthly | Engineering |
| Disaster recovery tabletop exercise | Quarterly | Engineering |
| Failover test (if applicable) | Semi-annually | Engineering |
| Review and update this plan | Quarterly | Engineering Lead |
| Verify retention worker is running | Weekly | Automated (queue monitoring) |
| Verify backup retention compliance | Monthly | Engineering |

## 10. Communication During Outages

| Audience | Channel | Timing |
|---|---|---|
| Customers | Email + status page | Within 30 minutes of confirmed outage |
| Internal team | Internal messaging | Immediately upon detection |
| Post-recovery | Email to affected customers | Within 24 hours of resolution |

Communication includes: what happened, what services were affected, current status, estimated resolution time, and any customer actions needed.
