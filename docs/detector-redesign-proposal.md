# RevBack Detector Redesign Proposal

## Executive Summary

The current detectors fall into a trap: they alert customers about internal data consistency issues that the customer cannot act on. A customer receiving "Payment succeeded but entitlement is inactive" will check Stripe, see the subscription is active, and wonder why we bothered them.

This proposal restructures detectors around a single principle: **every alert must tell the customer something they can't see elsewhere and give them a specific action to take.**

The result is two tiers:
- **Tier 1 (Billing Only)**: Cross-platform visibility, integration health, aggregate anomaly patterns -- things no single billing dashboard can show
- **Tier 2 (App Verified)**: Per-user access verification via SDK -- the only way to confirm "paid but no access" with certainty

---

## Core Principles

1. **CRITICAL alerts must be ACTIONABLE** -- the customer must be able to DO something specific when they see it.
2. **Internal data consistency issues are NOT customer alerts** -- if our pipeline had a temporary glitch or a webhook arrived out of order, we handle it ourselves.
3. **Billing-only tier focuses on**: aggregate patterns, cross-platform insights, infrastructure health, and revenue trends.
4. **Per-user "paid but no access" only exists in Tier 2** (app-verified via SDK) -- from billing data alone we cannot know if the user actually has access in the customer's app.
5. **RevBack's unique value is cross-platform visibility** -- things Stripe/Apple/Google dashboards cannot show individually.

---

## Disposition of Current Detectors

| # | Current Detector ID | Current Name | Disposition | Reason |
|---|---|---|---|---|
| 1 | `payment_without_entitlement` | Payment Not Provisioned | **DEMOTE to internal** | This detects our own pipeline inconsistency (payment event vs entitlement state). Customer checks Stripe, sees subscription is active, says "so what?" Not actionable from billing data alone. We should auto-heal this internally. |
| 2 | `entitlement_without_payment` | Expired Subscription Still Active | **DEMOTE to internal** | Same problem. Our entitlement state machine may lag behind reality. Customer cannot verify if the user actually has app access from this alert. |
| 3 | `refund_not_revoked` | Refund Not Revoked | **MODIFY -> `unrevoked_refund`** | Keep but reframe. See detailed analysis below. |
| 4 | `webhook_delivery_gap` | Webhook Delivery Gap | **KEEP as-is** | Already excellent. Clear action: "check your webhook configuration." Uniquely valuable because we monitor all providers in one place. |
| 5 | `cross_platform_mismatch` | Cross-Platform State Mismatch | **MODIFY -> split into two** | The "conflicting states" case and the "duplicate active subscriptions" case are both valuable but need different framing and actions. Split into `cross_platform_conflict` and `duplicate_billing`. |
| 6 | `silent_renewal_failure` | Silent Renewal Failure | **MODIFY -> merge into aggregate** | Individual "renewal didn't arrive" is noisy (could be 5-minute webhook lag). Reframe as aggregate: "X% of renewals are missing on [source]." |
| 7 | `trial_no_conversion` | Trial Expired Without Conversion | **REMOVE from alerts, move to analytics** | Low actionability. Trial-to-paid conversion is a product metric, not an issue to alert on. Show it in a dashboard chart, not as an issue. |
| 8 | `stale_subscription` | Stale Subscription | **MODIFY -> merge into aggregate** | Individual stale subscriptions are a data quality signal. Aggregate them: "47 subscriptions have gone quiet on Apple." |
| 9 | `verified_paid_no_access` | Paid But No Access (Tier 2) | **KEEP as-is** | This is the real deal -- app-confirmed. Genuinely critical and actionable. |
| 10 | `verified_access_no_payment` | Access Without Payment (Tier 2) | **KEEP as-is** | Same -- app-confirmed revenue leakage. |

---

## Detailed Analysis: Refund Not Revoked

The refund detector is a special case that deserves careful analysis.

**When is this actionable?**
- When the customer's app does NOT have a webhook handler for `customer.subscription.deleted` / `charge.refunded` that automatically revokes access
- When refunds happen on Apple and the customer's server-to-server notifications aren't configured to handle `REFUND` type
- When chargebacks occur (Stripe `charge.dispute.created`) and the customer has no automated handler

**When is this NOT actionable?**
- When the customer's app already auto-revokes access on refund events (many modern apps do this)
- When the "still active" state is just our pipeline being slow to process the cascading events

**Verdict**: Keep, but reframe. The customer action is: "Check whether your app automatically revokes access after refunds. If not, these N users may still have access after being refunded." This is especially valuable for chargebacks where the customer is at risk of losing the dispute if they don't revoke access.

**For aggregate framing**: "You had 12 refunds this month where no revocation event followed within 24 hours." This is more useful than per-user alerts for apps that do auto-handle refunds (they'll see zero and know things are working).

---

## Proposed Tier 1 Detectors (Billing Only)

### 1. `webhook_delivery_gap` -- Webhook Delivery Gap

- **Status**: KEEP (already exists, well-implemented)
- **Name**: "Webhook Delivery Gap"
- **What it detects**: No webhooks received from a billing provider within its expected interval (Stripe: 4h warning/12h critical, Apple: 12h/48h, Google: 8h/24h)
- **Severity**: Warning at threshold, Critical at 2x threshold
- **Customer action**: "Check your [Stripe/Apple/Google] webhook endpoint configuration. Verify the signing secret matches. Check [provider] status page for outages."
- **Why only RevBack can see this**: Individual provider dashboards show webhook delivery logs, but RevBack monitors all providers from a single pane AND tracks historical reliability. A customer with Stripe + Apple + Google would need to check 3 dashboards.
- **Framing**: Per-provider (system-wide)
- **Implementation**: No changes needed. Current implementation at `/src/detection/detectors/webhook-gap.ts` is solid.

---

### 2. `duplicate_billing` -- Duplicate Cross-Platform Billing

- **Status**: NEW (extracted from `cross_platform_mismatch`)
- **Name**: "Duplicate Cross-Platform Billing"
- **What it detects**: Same user (resolved via identity graph) has active paid subscriptions on 2+ billing platforms for the same product. They are being double-billed.
- **Severity**: Critical -- real money being lost, customer must refund one subscription
- **Customer action**: "These users are paying for the same product on both [Stripe] and [Apple]. Review each case and cancel/refund the duplicate subscription. Consider adding cross-platform subscription checks to your app's purchase flow."
- **Why only RevBack can see this**: Stripe has zero visibility into Apple subscriptions and vice versa. This is literally impossible to detect without a unified view. This is RevBack's killer feature.
- **Framing**: Per-user (each duplicate is individually actionable -- customer needs to refund a specific user)
- **Data pattern**: Query entitlements table grouped by (orgId, userId, productId), filter for 2+ rows with active states from different sources.
- **Implementation**: Extract the `activeEnts.length > 1` branch from current `cross-platform-mismatch.ts` into its own detector. The current code already does this but emits `duplicate_subscription` as the issueType -- make it a first-class detector.

---

### 3. `cross_platform_conflict` -- Cross-Platform State Conflict

- **Status**: MODIFY (from `cross_platform_mismatch`)
- **Name**: "Cross-Platform State Conflict"
- **What it detects**: Same user has conflicting states across providers -- active on one, expired/revoked/refunded on another. This suggests one platform processed a cancellation/refund that the other didn't.
- **Severity**: Warning -- needs investigation, not always a real problem (user may have legitimately cancelled on one platform and kept the other)
- **Customer action**: "This user's subscription is active on [Stripe] but [expired/refunded] on [Apple]. Verify whether the user should still have access and whether the cancellation on [Apple] was intentional."
- **Why only RevBack can see this**: Same as above -- requires cross-platform view.
- **Framing**: Per-user (individual investigation needed)
- **Data pattern**: Same as current cross-platform-mismatch.ts minus the duplicate detection (which moves to `duplicate_billing`).
- **Implementation**: Refactor `cross-platform-mismatch.ts` to only emit `cross_platform_conflict` issues, removing the duplicate-subscription branch.

---

### 4. `unrevoked_refund` -- Unrevoked Refund/Chargeback

- **Status**: MODIFY (from `refund_not_revoked`)
- **Name**: "Refund Without Access Revocation"
- **What it detects**: A refund or chargeback was processed, but no subsequent state change to "refunded" or "revoked" was observed within a grace window (e.g., 1 hour for event-triggered, 24 hours for scheduled scan).
- **Severity**: Critical for chargebacks (financial liability), Warning for refunds
- **Customer action**: For chargebacks: "A chargeback was filed. If you haven't revoked this user's access, do so immediately -- this strengthens your dispute response." For refunds: "These refunds were processed but no access revocation followed. Verify your app's refund webhook handler is working. If you don't auto-revoke on refund, consider implementing it."
- **Why only RevBack can see this**: Stripe shows the refund, but doesn't know if the customer's app actually revoked access. RevBack correlates the refund event with the absence of a state change.
- **Framing**: Per-user for chargebacks (urgent, immediate action needed). Aggregate for refunds ("12 refunds without revocation this month" with drill-down to individual users).
- **Key change from current**: Add a 1-hour grace period on event-triggered detection (current code fires immediately on refund event, which may be before the revocation webhook arrives). The scheduled scan should look for refunds with no state change after 24 hours.
- **Data pattern**: On refund/chargeback event, wait 1 hour then check if entitlement transitioned to refunded/revoked. On scheduled scan, find all refund/chargeback events from last 30 days where the entitlement never transitioned.

---

### 5. `renewal_anomaly` -- Renewal Rate Anomaly

- **Status**: NEW (replaces `silent_renewal_failure` and partially `stale_subscription`)
- **Name**: "Unusual Renewal Pattern"
- **What it detects**: The rate of successful renewals for a billing source has dropped significantly compared to the rolling average. For example, "Apple renewals are running 40% below your 30-day average" or "0 Stripe renewals in the last 6 hours (expected ~15 based on history)."
- **Severity**: Warning when 30%+ below average, Critical when 60%+ below or zero renewals when >10 expected
- **Customer action**: "Your [Apple] renewal rate has dropped [X]% below normal. This could indicate: (1) a webhook delivery problem, (2) a billing system issue, (3) a provider outage, or (4) increased involuntary churn. Check your [Apple] server notification configuration and the Apple System Status page."
- **Why only RevBack can see this**: Individual provider dashboards show totals but not cross-provider comparison or historical anomaly detection. RevBack tracks the expected baseline and flags deviations.
- **Framing**: Aggregate (system-wide per source). Never per-user.
- **Data pattern**: Count renewal events per source in sliding windows (1h, 6h, 24h). Compare to 7-day and 30-day rolling averages. Flag when current window is statistically below baseline.
- **Why this replaces `silent_renewal_failure`**: Individual "this user's renewal didn't arrive" is noisy and often self-resolves. The aggregate signal -- "your overall renewal rate dropped" -- is reliable, high-confidence, and actionable.
- **Why this partially replaces `stale_subscription`**: Many stale subscriptions are a symptom of the same root cause (missed webhooks). The aggregate detector catches the root cause faster.

---

### 6. `data_freshness` -- Data Freshness Alert

- **Status**: NEW (replaces `stale_subscription`)
- **Name**: "Stale Billing Data"
- **What it detects**: A significant number of subscriptions (>10% of active base) have gone one full billing cycle without any event. This is a stronger signal than individual staleness -- it means we're systematically missing events from a source.
- **Severity**: Warning at 10% stale, Critical at 25% stale
- **Customer action**: "25% of your [Apple] subscriptions have had no billing events in over 35 days. This suggests systematic webhook delivery failure. Re-register your Apple Server-to-Server notification URL and verify with a test subscription."
- **Why only RevBack can see this**: Requires tracking expected event cadence across the full subscription base. No single-provider dashboard shows "X% of your subscriptions went quiet."
- **Framing**: Aggregate (per source). Include count and percentage.
- **Data pattern**: For each source, count entitlements in active-like states where last event is >35 days old. Compare to total active entitlements for that source. Flag when ratio exceeds threshold.
- **What this replaces**: The per-user `stale_subscription` detector, which creates one issue per stale subscription (noisy, not individually actionable). The aggregate framing tells the customer "you have a systemic problem" rather than "here are 200 individual stale subscriptions."

---

## Tier 2 Detectors (App Verified -- Requires SDK)

### 7. `verified_paid_no_access` -- Paid But No Access

- **Status**: KEEP (already exists)
- **Name**: "Paid But No Access (Verified)"
- **What it detects**: User is paying (active entitlement) but the customer's app confirmed via access-check API that the user does NOT have access.
- **Severity**: Critical -- paying customer is not getting what they paid for
- **Customer action**: "This paying customer cannot access your product. Check your provisioning system. The issue may be in your entitlement check logic, a caching problem, or a feature flag misconfiguration."
- **Why only RevBack can see this**: Requires both billing data AND app-side access verification. No other tool correlates these.
- **Framing**: Per-user (each case needs individual investigation and fix)
- **Implementation**: No changes. Current code at `verified-paid-no-access.ts` is correct.

---

### 8. `verified_access_no_payment` -- Access Without Payment

- **Status**: KEEP (already exists)
- **Name**: "Access Without Payment (Verified)"
- **What it detects**: User's app reports `hasAccess=true` but all entitlements are expired/revoked/refunded/inactive.
- **Severity**: Critical -- revenue leakage, user is using the product for free
- **Customer action**: "This user has access to your product but is not paying. Check your access control logic. They may be exploiting a caching bug, using a hardcoded bypass, or their access wasn't properly revoked."
- **Why only RevBack can see this**: Same as above -- requires app + billing correlation.
- **Framing**: Per-user
- **Implementation**: No changes. Current code at `verified-access-no-payment.ts` is correct.

---

## Detectors to Demote to Internal

These detectors should still run but should NOT create customer-facing issues. Instead, they should feed into an internal data quality dashboard and trigger auto-healing where possible.

### `payment_without_entitlement` (currently "Payment Not Provisioned")

- **Why internal**: This is OUR data consistency problem. Payment arrived but entitlement state didn't update. The customer's Stripe dashboard shows everything is fine. Our pipeline should auto-heal: if we see a successful payment for a user whose entitlement is inactive, re-process the state machine.
- **Internal action**: Log to internal monitoring, trigger auto-reconciliation, track as a data quality metric.

### `entitlement_without_payment` (currently "Expired Subscription Still Active")

- **Why internal**: Same reasoning. Our entitlement state may lag behind the billing provider. This is a pipeline latency issue, not a customer problem.
- **Internal action**: Log to internal monitoring, trigger reconciliation check against provider API.

---

## Detectors to Remove from Issues (Move to Analytics)

### `trial_no_conversion` (currently "Trial Expired Without Conversion")

- **Why remove**: Trial conversion rate is a product metric, not a billing issue. Showing "User X's trial expired" as an issue is not actionable. Instead, show trial-to-paid conversion rates on the analytics dashboard as a time-series chart with breakdowns by source and product.
- **Where it goes**: Dashboard analytics widget: "Trial Conversion Rate: 12% (Stripe), 8% (Apple), 15% (Google)" with trends.

---

## Summary: New Detector Registry

| Priority | Detector ID | Name | Tier | Framing | Severity |
|---|---|---|---|---|---|
| P0 | `webhook_delivery_gap` | Webhook Delivery Gap | 1 | Per-provider | Warning/Critical |
| P0 | `duplicate_billing` | Duplicate Cross-Platform Billing | 1 | Per-user | Critical |
| P0 | `unrevoked_refund` | Refund Without Access Revocation | 1 | Per-user (chargeback) / Aggregate (refund) | Critical/Warning |
| P1 | `cross_platform_conflict` | Cross-Platform State Conflict | 1 | Per-user | Warning |
| P1 | `renewal_anomaly` | Unusual Renewal Pattern | 1 | Aggregate per-source | Warning/Critical |
| P1 | `data_freshness` | Stale Billing Data | 1 | Aggregate per-source | Warning/Critical |
| P0 | `verified_paid_no_access` | Paid But No Access (Verified) | 2 | Per-user | Critical |
| P0 | `verified_access_no_payment` | Access Without Payment (Verified) | 2 | Per-user | Critical |

Internal only (no customer-facing issues):
- `payment_without_entitlement` -> auto-reconciliation trigger
- `entitlement_without_payment` -> auto-reconciliation trigger

Removed (moved to analytics):
- `trial_no_conversion` -> dashboard metric
- `stale_subscription` -> absorbed by `data_freshness`
- `silent_renewal_failure` -> absorbed by `renewal_anomaly`

---

## Implementation Notes

### Data model changes needed

None for the issues table -- the existing schema supports all proposed detectors. The `issueType` field is a varchar, so new detector IDs work without migration.

For `renewal_anomaly`, we need a way to compute rolling averages. Options:
1. **Materialized view** on `canonical_events` grouping by source + hour (preferred for performance)
2. **In-detector query** with window functions (simpler, works for MVP)
3. **Redis counter** updated on each event (fastest, but adds Redis dependency to detection)

Recommendation: Start with option 2 (in-detector query) for MVP. If scan time becomes a problem, add the materialized view.

### Migration path

1. **Phase 1**: Add `duplicate_billing` and `cross_platform_conflict` (split from existing). Add grace period to `unrevoked_refund`. Deploy alongside existing detectors.
2. **Phase 2**: Add `renewal_anomaly` and `data_freshness`. These are new scheduled-scan detectors.
3. **Phase 3**: Demote `payment_without_entitlement` and `entitlement_without_payment` to internal. Remove `trial_no_conversion` from detector list. Move `stale_subscription` logic into `data_freshness`.
4. **Phase 4**: Build analytics dashboard for trial conversion and other metrics that were removed from the issue system.

### Backward compatibility

Existing issues in the database with old `issueType` values will remain. The API should continue to return them. New scans will use new detector IDs. Old detector IDs will simply stop producing new issues after Phase 3.

---

## What This Gets Us

**Before**: 10 detectors, most alerting on internal data quality issues that confuse customers.

**After**: 8 detectors (6 Tier 1 + 2 Tier 2), every one with a clear customer action:

| Alert | Customer Does... |
|---|---|
| Webhook Delivery Gap | Checks webhook config, verifies signing secrets, checks provider status page |
| Duplicate Cross-Platform Billing | Refunds duplicate subscription for specific users |
| Refund Without Revocation | Verifies refund webhook handler, manually revokes if needed |
| Cross-Platform State Conflict | Investigates specific user's subscription state across providers |
| Unusual Renewal Pattern | Checks provider webhook config, investigates sudden churn spike |
| Stale Billing Data | Re-registers server notification URLs, tests webhook delivery |
| Paid But No Access (Verified) | Fixes provisioning bug for specific user |
| Access Without Payment (Verified) | Fixes access control bug for specific user |

The key shift: Tier 1 detectors tell customers about their **infrastructure and cross-platform blind spots**. Tier 2 detectors tell them about **specific users with access problems**. Nothing alerts on "our internal state machine might be slightly off."
