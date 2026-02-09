# Technical Architecture Review: Subscription Issue Detection Platform

**Reviewer**: Senior Staff Engineer (billing/subscription systems at scale)
**Date**: 2026-02-09
**Document Under Review**: plan.md

---

## Executive Summary

The plan identifies the right problem and the right high-level architecture. The "normalize events, not systems" insight is correct and battle-tested. However, the plan significantly underestimates complexity in several areas: the canonical event model is too thin, the identity graph is over-engineered for an MVP, the entitlement state machine is missing critical states, and there are no concrete answers for the hardest operational challenges (webhook reliability, Apple API quirks, data consistency under concurrent mutations). Below is a detailed, section-by-section teardown.

---

## 1. Canonical Event Model: Incomplete and Under-specified

### What the plan proposes

```json
{
  "source": "apple | google | stripe | ...",
  "external_user_id": "...",
  "product_id": "...",
  "event_type": "purchase | renewal | cancellation | refund | chargeback | grace | retry | expiration",
  "event_time": "...",
  "amount": 9.99,
  "currency": "USD",
  "status": "success | failed | pending",
  "raw_payload": { ... }
}
```

### What's actually needed

This schema is a sketch, not a foundation. Here is what's missing and why it matters:

**Missing fields (critical)**:

| Field | Why it matters |
|-------|---------------|
| `event_id` (idempotency key) | Without this, you cannot deduplicate. Apple and Google both send at-least-once. This is non-negotiable. |
| `original_transaction_id` | Apple's primary subscription identity. You literally cannot track a subscription lifecycle without it. |
| `purchase_token` (Google) | Google's equivalent. Required to call their API for full status. |
| `subscription_group_id` | Apple groups subscriptions. Upgrades/downgrades happen within groups. Without this, you cannot detect crossgrades. |
| `base_plan_id` + `offer_id` (Google) | Google's 2022+ subscription model uses base plans with offers. A single `product_id` is no longer sufficient. |
| `period_type` | trial / intro / normal / promotional. RevenueCat tracks this explicitly because entitlement logic differs. |
| `expiration_time` | When does the current period end? Essential for grace period and billing retry calculations. |
| `is_family_share` | Apple family sharing means payment came from a different account. Entitlement logic is different. |
| `offer_code` | Apple offer codes and Google promo codes create subscriptions with non-standard pricing. |
| `price_in_local_currency` + `proceeds` | Apple/Google take different cuts. Revenue calculations need both gross and net. |
| `environment` | sandbox vs production. If you don't filter sandbox events, your issue detection will be full of noise. |
| `storefront` / `country_code` | Tax, pricing, and regulatory rules vary by country. |
| `grace_period_expiration` | Separate from subscription expiration. Needed to know when to revoke access during billing retry. |
| `cancellation_reason` | Was it voluntary (user canceled), involuntary (billing failure), or a refund? Different issue detection logic for each. |
| `ownership_type` | Apple: PURCHASED vs FAMILY_SHARED. Google: similar concept for family groups. |
| `ingested_at` | When YOUR system received the event. Critical for debugging lag between event_time and processing. |

**Event types are too coarse.** The plan lists 8 event types. Here is what the real world looks like:

Apple App Store Server Notifications V2 has ~18 notification types, each with subtypes:
- `SUBSCRIBED` (subtypes: INITIAL_BUY, RESUBSCRIBE)
- `DID_RENEW` (no subtype)
- `DID_FAIL_TO_RENEW` (subtypes: GRACE_PERIOD, no subtype)
- `DID_CHANGE_RENEWAL_PREF` (subtypes: UPGRADE, DOWNGRADE, no subtype)
- `DID_CHANGE_RENEWAL_STATUS` (subtypes: AUTO_RENEW_ENABLED, AUTO_RENEW_DISABLED)
- `EXPIRED` (subtypes: VOLUNTARY, BILLING_RETRY_PERIOD, PRICE_INCREASE, PRODUCT_NOT_FOR_SALE)
- `GRACE_PERIOD_EXPIRED`
- `OFFER_REDEEMED` (subtypes: INITIAL_BUY, RESUBSCRIBE, UPGRADE, DOWNGRADE)
- `PRICE_INCREASE` (subtypes: PENDING, ACCEPTED)
- `REFUND` (no subtype)
- `REFUND_DECLINED`
- `REFUND_REVERSED`
- `RENEWAL_EXTENDED` / `RENEWAL_EXTENSION`
- `REVOKE`
- `CONSUMPTION_REQUEST`
- `EXTERNAL_PURCHASE_TOKEN`
- `ONE_TIME_CHARGE`

Google Play RTDN has 20+ notification types including `SUBSCRIPTION_PAUSED`, `SUBSCRIPTION_ON_HOLD`, `SUBSCRIPTION_DEFERRED`, `SUBSCRIPTION_ITEMS_CHANGED`, `SUBSCRIPTION_PRICE_STEP_UP_CONSENT_UPDATED`, and more.

Collapsing all of this into 8 event types means you lose the semantic richness that makes issue detection accurate. You need to preserve the source-specific type/subtype and ALSO have a canonical higher-level category for cross-platform logic.

### Recommendation

The canonical model should be two-layered:

1. **Raw normalized event**: Preserves all source-specific semantics. ~30 fields minimum.
2. **Derived subscription state change**: The simplified projection used by the entitlement engine and issue detectors.

RevenueCat uses 17 event types. Adapty uses 18. Both arrived at this level of granularity after years of production use. Starting with 8 types means you will be refactoring your schema within weeks of hitting real data.

---

## 2. Identity Graph: Over-Engineered for MVP, Under-specified for Production

### The problem is real

The plan correctly identifies that identity resolution is where products die. This is true. The problem:
- A single user might have an Apple `original_transaction_id`, a Stripe `customer_id`, a Google `purchase_token`, and an internal `user_id`.
- These are not reliably linked unless the customer's app explicitly passes the mapping.

### Why a graph is overkill for Phase 1

A full identity graph (nodes, edges, merge logic, conflict resolution) is a 3-6 month project by itself if done properly. It requires:
- Merge/split semantics (what happens when you discover two "users" are actually one?)
- Conflict resolution (what if two identity nodes have conflicting subscription states?)
- Audit trail (regulators and customers will want to know why identities were merged)
- Undo capability (false merges happen and are catastrophic)

**RevenueCat's approach is instructive.** They use a simpler model:
- `app_user_id`: The latest known ID for a customer
- `original_app_user_id`: The first ID ever seen
- `aliases`: An array of all known IDs

This is not a graph. It's an alias table with a canonical key. It works because RevenueCat requires customers to call `logIn()` with a known user ID, which creates the link. Anonymous users get an `$RCAnonymousID:` prefix.

### Minimum viable identity for Phase 1

```
customer_accounts (
  id UUID PRIMARY KEY,
  created_at TIMESTAMP
)

customer_identifiers (
  id UUID PRIMARY KEY,
  account_id UUID REFERENCES customer_accounts(id),
  source ENUM('apple', 'google', 'stripe', 'internal', 'email'),
  identifier TEXT,
  created_at TIMESTAMP,
  UNIQUE(source, identifier)
)
```

That's it. One account, many identifiers. The customer maps them via API/SDK. You don't do automatic merging in Phase 1. You surface "possible duplicate accounts" as an issue type and let the customer resolve it.

### What you're punting on (and should document)

- **Anonymous users**: If the customer's app doesn't pass an identifier, you get Apple's `original_transaction_id` as the only anchor. This is fine for issue detection but breaks cross-platform correlation. Document this limitation clearly.
- **Family sharing**: Apple family sharing means the purchaser and the user are different accounts. Your identity model needs to handle this or explicitly exclude it.
- **Account transfers**: When a customer migrates users between systems, their identifiers change. You need an "unlink" operation eventually, but not for MVP.

---

## 3. Entitlement State Machine: Incomplete

### What the plan proposes

```
INACTIVE -> TRIAL -> ACTIVE -> GRACE -> PAST_DUE -> EXPIRED -> REFUNDED
```

### What's actually missing

This state machine is missing states that exist in production Apple and Google subscriptions:

**Missing states:**

| State | Platform | Why it matters |
|-------|----------|---------------|
| `BILLING_RETRY` | Apple, Google | Different from GRACE. User may or may not have access depending on grace period config. Apple retries for up to 60 days. |
| `PAUSED` | Google only | User explicitly paused. Not expired, not canceled. Will auto-resume. Google-specific but you need it for Phase 2. |
| `ON_HOLD` (Account Hold) | Google only | After grace period fails. User loses access but sub isn't expired. Can recover. |
| `REVOKED` | Apple, Google | Different from REFUNDED. Revoked means Apple/Google pulled the subscription (e.g., family sharing revocation, fraud). |
| `PENDING_UPGRADE` | Apple | When a downgrade is scheduled for next renewal. Current entitlement is still active at old level. |
| `OFFER_PERIOD` | Apple, Google | Intro pricing period. Different from trial (paid but at reduced rate). |
| `PENDING_PRICE_INCREASE` | Apple | User hasn't consented to price increase. Subscription may expire if they don't. |
| `DEFERRED` | Google | Subscription renewal date has been pushed forward (e.g., customer support action). |

**Transition issues:**

The proposed linear flow (`INACTIVE -> TRIAL -> ACTIVE -> ...`) implies a single path. Real subscriptions are a directed graph, not a linear sequence:

- `ACTIVE` can go directly to `EXPIRED` (voluntary cancellation at end of period)
- `ACTIVE` can go to `GRACE` (billing failure with grace period enabled)
- `GRACE` can go back to `ACTIVE` (payment recovered)
- `GRACE` can go to `BILLING_RETRY` / `ON_HOLD` (grace period expired, still retrying)
- `BILLING_RETRY` can go back to `ACTIVE` (payment recovered after grace)
- `ACTIVE` can go to `REFUNDED` directly (Apple processes refund on active sub)
- `REFUNDED` is a terminal state (but the user might resubscribe, creating a NEW subscription)
- `EXPIRED` is NOT terminal on Google (user can restore from Play Store)
- `PAUSED` goes to `ACTIVE` or `ON_HOLD` (depending on payment success at resume)

### Recommended state machine

```
                      +---> TRIAL --------+
                      |                   |
                      |                   v
INACTIVE --+---------+---> OFFER -----> ACTIVE <------+
            |                             |   |        |
            |                             |   |        |
            |              +----- GRACE <-+   |        |
            |              |       |          |        |
            |              |       v          |        |
            |              +-- BILLING_RETRY  |        |
            |              |       |          |        |
            |              |       v          |        |
            |              +-- ON_HOLD        |        |
            |                    |            |        |
            |                    v            v        |
            |              EXPIRED <------- CANCELED   |
            |                |                         |
            |                +--- (resubscribe) -------+
            |
            +---> PAUSED (Google only)
            +---> REVOKED
            +---> REFUNDED
            +---> PENDING_PRICE_INCREASE
```

Each transition should be driven by an event and logged. The state machine should be per-(user, product, subscription_instance), NOT per-(user, product), because a user can have multiple sequential subscriptions to the same product.

### Critical edge cases to handle

1. **Upgrade mid-period (Apple)**: Immediate upgrade with prorated refund of old subscription. This creates a REFUNDED event on the old sub and a SUBSCRIBED event on the new sub *in the same subscription group*. If you don't link them, it looks like a refund issue.

2. **Downgrade scheduled (Apple)**: User downgrades but it takes effect at next renewal. For potentially weeks, the subscription is "active at old level, pending downgrade." Your entitlement engine needs to know the current entitlement vs. the future state.

3. **Google proration modes**: Google offers 5 proration modes for upgrades/downgrades (IMMEDIATE_WITH_TIME_PRORATION, IMMEDIATE_AND_CHARGE_PRORATED_PRICE, IMMEDIATE_WITHOUT_PRORATION, DEFERRED, IMMEDIATE_AND_CHARGE_FULL_PRICE). Each creates different event sequences and different revenue implications.

4. **Apple refund + resubscribe**: User gets refunded, then resubscribes the same day. If your state machine treats REFUNDED as terminal, you miss the new subscription.

---

## 4. Issue Detectors: Mostly Right, Needs Prioritization

### Assessment of proposed detectors

| Detector | Verdict | False Positive Risk | Customer Value | Priority |
|----------|---------|-------------------|----------------|----------|
| Active entitlement + last payment failed | **Ship first** | Low | Very High - direct revenue leak | P0 |
| Payment succeeded but entitlement inactive | **Ship first** | Low | Very High - users locked out, support tickets | P0 |
| Apple says active, Stripe says canceled | Medium | **High** - timing differences cause false positives | Medium | P1 |
| Duplicate active subscriptions for same user | **Ship first** | Low if identity is right | High - user is being double-charged | P0 |
| Refunded but still active after N hours | Good | Medium - "N hours" needs to be platform-aware | High | P1 |
| Trial expired but no conversion event | Good | **High** - many trials just expire intentionally | Low - expected churn | P2 |
| Chargeback without entitlement revocation | **Ship first** | Low | Very High - compliance risk | P0 |

### Detectors the plan is missing

| Detector | Why it matters |
|----------|---------------|
| **Subscription in billing retry > 30 days** | These are zombies. The user probably doesn't know they're being retried. Revenue is at risk and the user experience is degrading. |
| **Grace period active but app not granting access** | The whole point of grace period is to keep users happy while payment recovers. If the app isn't doing this, it's a bug. |
| **Price increase pending, no user consent** | Apple will expire the subscription if the user doesn't consent. This is a ticking time bomb for revenue. |
| **Subscription renewed but amount changed unexpectedly** | Could indicate currency fluctuation, tax changes, or Apple/Google price adjustments. |
| **Webhook delivery gap** | If you haven't received any webhooks from a source in N hours, something is probably wrong with the integration, not the subscriptions. This is a meta-detector and it's arguably the most important one. |
| **Event sequence anomaly** | A renewal event without a preceding purchase. An expiration followed by a renewal. These indicate missed events or processing bugs. |
| **Stale subscription status** | Subscription shows active but last event was > billing_period ago. Either you missed a renewal event or the status is stale. |

### Recommended launch set (Phase 1, Stripe + Apple)

**P0 (ship day 1):**
1. Payment succeeded, entitlement inactive ("paid but locked out")
2. Active entitlement, last payment failed ("free access leak")
3. Chargeback/refund without entitlement revocation ("compliance risk")
4. Webhook delivery gap ("integration health")

**P1 (ship within 2 weeks):**
5. Duplicate active subscriptions
6. Cross-platform state mismatch (Apple vs Stripe)
7. Subscription in extended billing retry
8. Event sequence anomaly

**P2 (iterate based on customer feedback):**
9. Trial conversion tracking
10. Price increase consent monitoring
11. Grace period access verification

---

## 5. Phase 1 (Stripe + Apple) Assessment

### Is this the right combo?

**Yes, but with caveats.**

**Why Stripe + Apple is correct:**
- Stripe is the dominant web/API billing platform for SaaS and subscription businesses. It has the best webhooks, best documentation, and most of your early customers will use it.
- Apple IAP is the platform that causes the most pain. Apple's notification system is unreliable, their APIs are quirky, and subscription state is genuinely hard to track. This is where your value proposition is strongest.
- Together, they cover the "SaaS company that also has an iOS app" segment, which is large and underserved.

**Why NOT Google + Stripe:**
- Google Play Billing is significantly better than Apple in terms of API quality, notification reliability, and documentation.
- The pain point is lower, so the willingness to pay for a solution is lower.
- Google's Real-time Developer Notifications via Pub/Sub are more reliable than Apple's webhooks.
- Save Google for Phase 2 when you've proven the value with the harder platform.

**Market coverage estimate:**
- Stripe: ~60-70% of B2B/B2C SaaS subscription billing
- Apple IAP: ~80% of iOS subscription apps
- Together: Covers the majority of companies that have cross-platform subscription pain
- Adding Google in Phase 2 captures ~95% of the mobile app subscription market

### Hardest integration challenges

1. **Apple receipt validation is being deprecated.** Apple is moving from receipt-based validation to the App Store Server API (JWS transactions). You MUST build on the new API, not the legacy `verifyReceipt` endpoint. Many tutorials and even some SDKs still reference the old approach.

2. **Apple's notification delivery is unreliable.** You will need to build a reconciliation job that polls the App Store Server API (Get Transaction History, Get All Subscription Statuses) to catch events that notifications missed. This is not optional.

3. **Stripe webhook ordering.** Stripe does not guarantee webhook delivery order. You will receive `invoice.payment_succeeded` before `customer.subscription.updated` sometimes, and the reverse other times. Your processing must be order-independent.

4. **Stripe's subscription model is flexible to the point of complexity.** Customers use Stripe in wildly different ways: metered billing, tiered pricing, multi-product subscriptions, subscription schedules, trials with and without payment methods. Your normalization layer needs to handle all of these or explicitly scope what you support.

---

## 6. Technical Risks: What's Underestimated

### Webhook reliability at scale

The plan mentions "strict signature verification" and "idempotency keys" but doesn't address the hard parts:

**Queue-first architecture is mandatory.** Your webhook endpoint must do three things: verify signature, enqueue to a durable queue, return 200. Period. Any processing in the request path will eventually cause timeouts, which causes the provider to retry, which causes duplicate processing.

Recommended pattern:
```
Webhook received -> Verify signature -> Write to queue (SQS/Redis/Postgres) -> Return 200
Background worker -> Dequeue -> Check idempotency -> Process -> Update state
```

**Dead letter queues.** You need a DLQ for events that fail processing after N retries. Without this, you silently lose events. This is table stakes, not a nice-to-have.

**Provider-specific retry behavior:**
- Stripe: Retries up to ~72 hours with exponential backoff. Sends same event ID.
- Apple: Retries for several hours. May or may not send the same notification ID (depends on version). May just... stop trying.
- Google: Pub/Sub retries until acknowledged. If you don't ack, messages pile up. If your subscriber crashes, you can get a thundering herd on restart.

### Data consistency

**The plan doesn't address concurrent mutations.** Consider: an Apple renewal notification and a Stripe payment webhook arrive within milliseconds of each other for the same user. Both try to update the entitlement state. Without proper concurrency control (row-level locks, optimistic concurrency, or event sourcing), you get data corruption.

**Event ordering is not guaranteed by ANY provider.** You will receive events out of order. Your state machine must be resilient to this. Options:
1. **Event sourcing**: Store all events, rebuild state from the full event history. Correct but expensive.
2. **Last-writer-wins with timestamp**: Simple but lossy. An out-of-order event with an earlier timestamp could overwrite a later state.
3. **Version vectors / logical clocks**: Correct and efficient but complex.

Recommendation for MVP: Use event sourcing for the entitlement state. Store every event, replay to compute current state. Use caching/materialized views for read performance. This gives you correctness AND debuggability, which is critical for a product whose value proposition is "we tell you what's wrong."

### Apple API quirks

**Rate limits are worse than documented.** Apple's official docs mention per-hour limits, but developers report an undocumented per-minute limit of ~300 requests. After 300-350 requests in a clock minute, you get 429 errors. Plan for this in your reconciliation job design.

**JWS token verification is non-trivial.** Apple signs notifications with JWS. You need to verify the full certificate chain, check revocation, and handle certificate rotation. Libraries exist but they're not all correct. Test thoroughly.

**Sandbox vs production behavior differs.** Apple's sandbox environment behaves differently from production in timing, event delivery, and even available notification types. Don't assume sandbox testing validates production behavior.

**Get All Subscription Statuses API can be slow.** Reports of requests taking extremely long (hours) or never completing when fetching more than ~200 items. You need timeouts and pagination handling.

### PCI/Security considerations

**You are handling financial data.** Even if you're read-only and not processing payments, you are storing:
- Transaction amounts and currencies
- Subscription status
- User billing identifiers
- Raw webhook payloads (which may contain PII)

You need:
- Encryption at rest for raw payloads
- Audit logging for all data access
- Data retention policies (GDPR, CCPA)
- Webhook signature verification (not optional, not "nice to have")
- API authentication for your customers (JWT/API keys with rotation)
- SOC 2 compliance path (your enterprise customers will ask for this before they send you their billing data)

**Webhook endpoints are attack surfaces.** If an attacker can send fake webhook events to your system, they can corrupt your entire dataset. Signature verification must be bulletproof and must fail closed (reject if verification fails, never skip).

---

## 7. Tech Stack Recommendation

### What similar systems use

**RevenueCat**: Built on AWS. Backend services in multiple languages. Data pipeline into Snowflake. They've mentioned optimizing for low-latency read paths with caching layers.

**Stripe**: Primarily Ruby (API), with critical paths in Go and Java. PostgreSQL as primary datastore. Heavy use of Apache Kafka for event streaming.

**General fintech pattern in 2025-2026**: PostgreSQL for transactional data, Kafka/SQS for event streaming, Redis for caching and rate limiting, Go or TypeScript for services.

### Recommended stack for this project

**Language: TypeScript (Node.js) or Go**

- **TypeScript** if the team is small (1-3 engineers) and needs to move fast. The ecosystem for webhook handling, JSON processing, and API building is mature. Most webhook SDKs from Stripe/Apple/Google are TypeScript-first. Downside: Not great for CPU-intensive reconciliation jobs.
- **Go** if you want to optimize for reliability, concurrency, and operational simplicity. Single binary deployment. Excellent for background workers and reconciliation jobs. Downside: Slightly slower iteration speed.
- **Not Rust**: Rust is great for latency-sensitive, safety-critical systems, but the complexity tax is too high for an MVP. You're not building a database or a payment processor; you're building an event pipeline and rule engine.

For an MVP with a small team, **TypeScript is the pragmatic choice**. You can always rewrite hot paths in Go later.

**Database: PostgreSQL**

Non-negotiable for the primary datastore. You need:
- ACID transactions for entitlement state updates
- JSONB columns for raw payloads (queryable without a separate document store)
- Row-level locking for concurrent webhook processing
- Excellent ecosystem for migrations, ORMs, and tooling

**Queue: Start with PostgreSQL (SKIP/LISTEN or pgmq), graduate to SQS/Redis**

For MVP, using Postgres as your queue (via `SKIP LOCKED` or a library like pgmq) reduces operational complexity. You don't need Kafka or SQS until you're processing >10K events/minute.

**Cache: Redis**

For idempotency key storage (TTL-based), rate limiting, and caching computed entitlement state.

**Infrastructure: AWS or GCP**

- AWS: Better Stripe integration, more mature billing tooling ecosystem
- GCP: Required if you want to use Google Pub/Sub natively for Google Play RTDN

Either works. Don't overthink this for MVP.

**Recommended specific stack:**

```
Runtime:        Node.js 20+ / TypeScript 5+
Framework:      Fastify or Hono (not Express - you need speed for webhook endpoints)
Database:       PostgreSQL 16+ (via Drizzle ORM or Kysely for type safety)
Queue:          pgmq or BullMQ (Redis-backed) for MVP
Cache:          Redis 7+
Auth:           API keys (customer-facing), JWT (dashboard)
Hosting:        AWS (ECS/Fargate or Lambda for webhook endpoints)
Monitoring:     Datadog or Grafana Cloud
CI/CD:          GitHub Actions
```

---

## 8. Summary of Critical Gaps

| Gap | Severity | Recommendation |
|-----|----------|---------------|
| Canonical event model is too thin | **High** | Expand to ~30 fields. Two-layer model (raw + derived). |
| Identity graph is over-scoped for MVP | **Medium** | Use simple alias table. Surface duplicates as issues. |
| State machine missing 6+ states | **High** | Add BILLING_RETRY, PAUSED, ON_HOLD, REVOKED, OFFER_PERIOD, PENDING states. Model as directed graph. |
| No concurrency/consistency strategy | **High** | Use event sourcing for entitlement state. Queue-first webhook processing. |
| No webhook reliability architecture | **High** | Queue-first ingestion, DLQ, idempotency store, provider-specific retry handling. |
| Apple API quirks not addressed | **Medium** | Plan for undocumented rate limits, reconciliation polling, JWS verification. |
| Security/compliance not mentioned | **Medium** | Encryption at rest, audit logging, SOC 2 path, GDPR. |
| Issue detectors not prioritized | **Low** | See P0/P1/P2 ranking above. Ship 4 detectors on day 1, not 7. |

---

## 9. Bottom Line

The plan is directionally correct. The insight about normalizing events (not systems) and the focus on entitlement correctness are exactly right. The phased approach (Stripe + Apple first) is smart.

But the plan reads like a senior engineer's whiteboard sketch, not a buildable architecture doc. The gaps are all in the "devil is in the details" category: the specific fields that make or break your event model, the specific states that your state machine needs to handle, the specific failure modes that your webhook ingestion must survive.

The biggest single risk is building the event model too thin and having to refactor it after onboarding your first customer. Spend 2 weeks getting the canonical event model right. Study RevenueCat's 17 event types, Adapty's 18 event types, Apple's ~18 notification types with subtypes, and Google's 20+ RTDN types. Your event model is your foundation -- everything else is built on top of it.

The second biggest risk is treating webhook ingestion as a solved problem. It is not. At-least-once delivery, out-of-order events, provider-specific retry behavior, and concurrent processing are all hard problems that need explicit architectural decisions before you write code.

If you get the event model and the ingestion layer right, everything else (entitlement engine, issue detection, dashboard) is straightforward application logic. If you get them wrong, you'll be fighting your own data model for the life of the product.
