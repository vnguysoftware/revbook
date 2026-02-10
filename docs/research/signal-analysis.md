# RevBack Signal Analysis for Agentic AI Integration

## Overview

This document analyzes RevBack's 14 detector implementations (8 customer-facing, 6 internal/demoted) to determine how each signal maps to agent-consumable payloads and automated remediation actions. The goal is to define exactly what an AI agent would need to understand, triage, and act on each issue type RevBack produces.

---

## 1. Detector Inventory

RevBack has 14 detector files organized into two tiers:

### Tier 1: Billing-Only Detectors (no SDK required)

| # | Detector ID | Category | Trigger Mode | Customer-Facing? |
|---|------------|----------|-------------|-----------------|
| 1 | `webhook_delivery_gap` | Integration Health | Scheduled only | Yes |
| 2 | `data_freshness` | Integration Health | Scheduled only | Yes |
| 3 | `duplicate_billing` | Cross-Platform Intelligence | Real-time + Scheduled | Yes |
| 4 | `cross_platform_conflict` | Cross-Platform Intelligence | Real-time | Yes |
| 5 | `unrevoked_refund` | Revenue Protection | Real-time + Scheduled | Yes |
| 6 | `renewal_anomaly` | Revenue Protection | Scheduled only | Yes |
| 7 | `payment_without_entitlement` | Revenue Protection | Real-time + Scheduled | Demoted (internal) |
| 8 | `entitlement_without_payment` | Revenue Protection | Real-time + Scheduled | Demoted (internal) |
| 9 | `cross_platform_mismatch` | Cross-Platform Intelligence | Real-time | Demoted (legacy, overlaps with 3+4) |
| 10 | `stale_subscription` | Integration Health | Scheduled only | Demoted (superseded by data_freshness) |
| 11 | `silent_renewal_failure` | Revenue Protection | Scheduled only | Demoted (superseded by renewal_anomaly) |
| 12 | `trial_no_conversion` | Revenue Protection | Scheduled only | Demoted (low priority) |

### Tier 2: App-Verified Detectors (requires SDK)

| # | Detector ID | Category | Trigger Mode | Customer-Facing? |
|---|------------|----------|-------------|-----------------|
| 13 | `verified_paid_no_access` | Verified | Scheduled only | Yes |
| 14 | `verified_access_no_payment` | Verified | Scheduled only | Yes |

---

## 2. Detector-by-Detector Analysis

### 2.1 webhook_delivery_gap

**Signal:** No webhooks received from a billing source beyond provider-specific thresholds (Stripe: 4h warning / 12h critical, Apple: 12h / 48h, Google: 8h / 24h).

**What an agent needs to understand:**
- Which billing source has gone silent
- How long since last webhook
- Whether the connection was ever working (lastWebhookAt null vs. stale)
- Provider-specific thresholds

**Possible remediation actions:**
1. Check the provider's status page for outages (Stripe: status.stripe.com, Apple: developer.apple.com/system-status/)
2. Verify webhook endpoint configuration in provider dashboard
3. Send a test webhook via provider API (Stripe: `POST /v1/webhook_endpoints/{id}/test`)
4. Check server logs for 4xx/5xx errors on webhook endpoint
5. Verify webhook signing secret hasn't rotated

**Automation safety matrix:**

| Action | Automatable? | Risk Level | Notes |
|--------|-------------|-----------|-------|
| Check provider status page | Fully | None | Read-only HTTP call |
| Verify endpoint config via API | Fully | None | Read-only API call |
| Send test webhook | Fully | Low | No side effects |
| Re-register webhook endpoint | Human-approved | Medium | Could break if wrong URL |
| Rotate webhook secret | Human-approved | High | Could break all delivery |

**API calls needed:**
- Stripe: `GET /v1/webhook_endpoints`, `POST /v1/webhook_endpoints/{id}/test`
- Apple: Server-to-Server notification URL verification (App Store Connect API)
- Google: `GET /androidpublisher/v3/applications/{packageName}/notifications` (RTDN config)

---

### 2.2 data_freshness

**Signal:** >10% (warning) or >25% (critical) of active subscriptions for a billing source have had no billing events in 35+ days.

**What an agent needs to understand:**
- Which billing source is affected
- Percentage and count of stale subscriptions
- This is an aggregate signal (systemic issue, not per-user)
- Usually indicates webhook delivery failure at scale, not individual subscription issues

**Possible remediation actions:**
1. Investigate webhook endpoint health (overlaps with webhook_delivery_gap)
2. Trigger a backfill/reconciliation from the billing provider
3. Spot-check a sample of stale subscriptions against provider API
4. Re-register webhook notifications

**Automation safety matrix:**

| Action | Automatable? | Risk Level | Notes |
|--------|-------------|-----------|-------|
| Spot-check sample via provider API | Fully | None | Read-only |
| Report affected subscription count | Fully | None | Informational |
| Trigger backfill sync | Human-approved | Medium | Can be expensive, may create duplicate events |
| Re-register webhooks | Human-approved | Medium | Could disrupt active delivery |

**API calls needed:**
- Stripe: `GET /v1/subscriptions/{id}` (spot-check), `GET /v1/events` (backfill)
- Apple: App Store Server API `GET /inApps/v1/subscriptions/{transactionId}` (spot-check)

---

### 2.3 duplicate_billing

**Signal:** User has active paid subscriptions on 2+ billing platforms (e.g., Stripe + Apple) for the same product. They are being double-billed.

**What an agent needs to understand:**
- Which user is affected
- Which platforms have active subscriptions
- The product being duplicated
- Entitlement state on each platform
- Which subscription is likely the "intended" one vs. the "accidental" one

**Possible remediation actions:**
1. Identify which subscription is newer (likely the duplicate)
2. Contact the user to confirm which platform they prefer
3. Cancel the duplicate subscription
4. Issue a prorated refund for the overlap period
5. Update entitlement to point to the correct subscription

**Automation safety matrix:**

| Action | Automatable? | Risk Level | Notes |
|--------|-------------|-----------|-------|
| Identify newer subscription | Fully | None | Data analysis |
| Generate user notification draft | Fully | Low | Agent drafts, human sends |
| Cancel duplicate subscription | Human-approved | High | Financial impact, could cancel wrong one |
| Issue refund | Human-approved | High | Revenue impact |
| Auto-cancel if <24h old duplicate | Agent-with-guardrails | Medium | Time-bound safety |

**API calls needed:**
- Stripe: `POST /v1/subscriptions/{id}` (cancel), `POST /v1/refunds` (refund)
- Apple: No API to cancel — must be done by user in Settings
- Google: `POST /androidpublisher/v3/applications/{packageName}/purchases/subscriptions/{subscriptionId}/tokens/{token}:revoke`

**Key constraint:** Apple subscriptions cannot be cancelled programmatically by the developer. An agent can only advise the user to cancel through their Apple device settings. This is a fundamental platform asymmetry that agents must understand.

---

### 2.4 cross_platform_conflict

**Signal:** User has conflicting subscription states across platforms — active on one, expired/revoked/refunded on another for the same product.

**What an agent needs to understand:**
- Which platforms disagree
- What each platform's current state is
- Which state is likely "correct" (usually the more recent one)
- Whether the inactive state is the result of a user action (cancellation/refund) or system issue

**Possible remediation actions:**
1. Determine the "truth" by querying the provider API for real-time status
2. Sync the stale platform's entitlement to match reality
3. If user cancelled on one platform, prompt them to cancel on the other
4. If refunded on one platform, consider whether to refund on the other

**Automation safety matrix:**

| Action | Automatable? | Risk Level | Notes |
|--------|-------------|-----------|-------|
| Query provider API for current status | Fully | None | Read-only |
| Update RevBack entitlement state | Agent-with-guardrails | Low | Internal state only |
| Cancel subscription on active platform | Human-approved | High | Financial impact |
| Notify user of conflict | Agent-with-guardrails | Low | Informational |

**API calls needed:**
- Stripe: `GET /v1/subscriptions/{id}`
- Apple: `GET /inApps/v1/subscriptions/{originalTransactionId}/all`
- Google: `GET /androidpublisher/v3/applications/{packageName}/purchases/subscriptionsv2/tokens/{token}`

---

### 2.5 unrevoked_refund

**Signal:** A refund or chargeback was processed but the user's entitlement is still in an active state (active, trial, grace_period, or billing_retry). Access should have been revoked.

**What an agent needs to understand:**
- Whether it's a refund vs. chargeback (chargebacks are more urgent)
- The refund amount and currency
- How long ago the refund was processed (1h grace for real-time, 24h+ for scheduled)
- Current entitlement state
- The customer's intent (voluntary refund vs. billing dispute)

**Possible remediation actions:**
1. Revoke the entitlement (set state to `refunded` or `revoked`)
2. For chargebacks: immediately revoke + submit chargeback evidence
3. Investigate why the refund handler didn't fire (webhook handler bug?)
4. If systematic, investigate the refund webhook processing pipeline

**Automation safety matrix:**

| Action | Automatable? | Risk Level | Notes |
|--------|-------------|-----------|-------|
| Revoke entitlement after refund | Agent-with-guardrails | Medium | User loses access; correct in 95%+ of cases |
| Revoke entitlement after chargeback | Fully automatable | Low | Nearly always correct |
| Submit chargeback evidence | Human-approved | Medium | Legal/financial implications |
| Investigate webhook handler | Agent-with-guardrails | None | Code analysis |

**API calls needed:**
- RevBack internal: Update entitlement state to `refunded`
- Stripe: `GET /v1/charges/{charge}/dispute` (for chargeback evidence)
- Customer's app API: Revoke access (app-specific, needs API key)

**This is the strongest candidate for full automation.** Refund-without-revocation is almost always a bug, not an intentional state. An agent that automatically revokes access after a confirmed refund (with a 1h grace period) would be correct >95% of the time.

---

### 2.6 renewal_anomaly

**Signal:** Renewal rate for a billing source has dropped 30%+ (warning) or 60%+ (critical) below the 30-day rolling average, measured in 6-hour windows.

**What an agent needs to understand:**
- Which billing source is affected
- Magnitude of the drop (percentage and absolute counts)
- Whether this correlates with a webhook gap (compound signal)
- Historical baseline for context
- Time of onset

**Possible remediation actions:**
1. Cross-reference with webhook_delivery_gap — compound signal is very high confidence
2. Check provider status page for outages
3. Check if a recent code deploy broke webhook processing
4. Review failed payment logs for sudden spikes
5. Alert the engineering team

**Automation safety matrix:**

| Action | Automatable? | Risk Level | Notes |
|--------|-------------|-----------|-------|
| Correlate with webhook gap | Fully | None | Data analysis |
| Check provider status | Fully | None | HTTP read-only |
| Generate incident report | Fully | None | Informational |
| Page on-call engineer | Agent-with-guardrails | Low | Could over-alert |
| Trigger backfill | Human-approved | Medium | Resource-intensive |

**API calls needed:** Same as webhook_delivery_gap (status checks, webhook endpoint verification).

---

### 2.7 verified_paid_no_access (Tier 2)

**Signal:** User has an active/trial entitlement (they are paying) but the app's access-check SDK reports `hasAccess = false`. Verified by the customer's app.

**What an agent needs to understand:**
- The user is a paying customer who cannot use the product (churn risk)
- This is the highest-urgency customer-facing issue type
- The access check was reported by the app itself, not inferred
- Time since the access check was reported

**Possible remediation actions:**
1. Grant access immediately in the app (highest priority)
2. Check the app's provisioning logic for bugs
3. Verify the entitlement state matches the billing provider
4. Proactively reach out to the user before they contact support
5. If pattern-wide, investigate the provisioning system

**Automation safety matrix:**

| Action | Automatable? | Risk Level | Notes |
|--------|-------------|-----------|-------|
| Grant access via app API | Agent-with-guardrails | Low | User is already paying |
| Verify with billing provider | Fully | None | Read-only |
| Send proactive support message | Human-approved | Medium | Reputation risk if wrong |
| Log provisioning investigation | Fully | None | Internal |

**API calls needed:**
- Customer's app API: Grant entitlement/access (app-specific)
- Stripe: `GET /v1/subscriptions/{id}` (verify payment status)
- Apple: `GET /inApps/v1/subscriptions/{originalTransactionId}/all` (verify)

**This is the second-strongest candidate for automation.** Granting access to a paying customer is almost always the correct action — the downside of incorrectly granting access is negligible compared to the downside of a paying customer not having access (churn, support tickets, chargebacks).

---

### 2.8 verified_access_no_payment (Tier 2)

**Signal:** App reports `hasAccess = true` but entitlement is expired/revoked/refunded/inactive. User has the product without paying.

**What an agent needs to understand:**
- The user currently has free access to a paid product
- Entitlement state(s) and why they're inactive
- Whether this is a single user or a pattern
- Potential revenue leakage per user

**Possible remediation actions:**
1. Revoke access in the app
2. Check if the user has an active subscription on another platform
3. Investigate the access control logic for bugs
4. If the user's subscription just expired, this may be a grace period — verify before revoking

**Automation safety matrix:**

| Action | Automatable? | Risk Level | Notes |
|--------|-------------|-----------|-------|
| Verify entitlement with provider API | Fully | None | Read-only |
| Revoke access | Human-approved | High | Could be wrong (grace period, etc.) |
| Flag for review | Fully | None | Just creates a ticket |
| Investigate pattern | Agent-with-guardrails | None | Data analysis |

**This requires more caution than its counterpart (verified_paid_no_access).** Revoking access from a user who believes they should have it carries customer satisfaction risk. The agent should verify the subscription status with the billing provider before recommending revocation.

---

## 3. Demoted/Internal Detectors

These detectors are not customer-facing but still exist in the codebase. An agent system should be aware of them as supporting signals.

| Detector ID | Why Demoted | Agent Relevance |
|------------|-------------|-----------------|
| `payment_without_entitlement` | Noise-prone; difficult to make actionable | Use as supporting evidence for verified_paid_no_access |
| `entitlement_without_payment` | Noise-prone; overlaps with verified_access_no_payment | Use as supporting evidence |
| `cross_platform_mismatch` | Superseded by cross_platform_conflict + duplicate_billing | Ignore — deduplicated |
| `stale_subscription` | Per-user noise; superseded by aggregate data_freshness | Use for targeted investigation after data_freshness fires |
| `silent_renewal_failure` | Short-lived signal; superseded by renewal_anomaly | Ignore — aggregate is more reliable |
| `trial_no_conversion` | Low severity, rarely actionable | Monitor as health signal only |

---

## 4. Agent Remediation Safety Tiers

Based on the analysis above, every possible remediation action falls into one of four safety tiers:

### Tier A: Fully Automatable (no human approval needed)
- Read-only API calls to billing providers (status checks, subscription lookups)
- Data analysis and correlation across signals
- Generating incident reports and summaries
- Internal state updates to RevBack's own data
- Checking provider status pages

### Tier B: Agent-with-Guardrails (automated with safety constraints)
- Revoking access after a confirmed chargeback (nearly always correct)
- Granting access to a verified paying customer (low risk of being wrong)
- Updating RevBack entitlement state to match provider reality
- Sending informational notifications to internal Slack/email
- Revoking access after a confirmed refund with >1h grace period

**Guardrails for Tier B:**
- Confidence score threshold (e.g., >0.90)
- Maximum revenue impact threshold (e.g., <$500 without approval)
- Rate limit (e.g., max 10 automated actions per hour per org)
- Rollback window (actions can be undone within 15 minutes)
- Audit log of every automated action

### Tier C: Human-Approved (agent proposes, human confirms)
- Cancelling subscriptions
- Issuing refunds
- Re-registering webhook endpoints
- Sending external messages to end users
- Triggering bulk backfills
- Submitting chargeback evidence

### Tier D: Human-Only (agent should not propose automation)
- Changing pricing or plan configurations
- Modifying billing provider credentials
- Deleting user accounts or data
- Legal/compliance decisions

---

## 5. Ideal Agent Payload Structure

Based on the current `DetectedIssue` interface and the needs identified above, here is the ideal payload structure for agent consumption:

```typescript
interface AgentIssuePayload {
  // === Identity ===
  issueId: string;                    // RevBack issue UUID
  orgId: string;                      // Tenant context
  issueType: string;                  // Detector ID (e.g., "unrevoked_refund")

  // === Classification ===
  category: "integration_health" | "cross_platform" | "revenue_protection" | "verified";
  severity: "critical" | "warning" | "info";
  confidence: number;                 // 0.0 - 1.0
  detectionTier: "billing_only" | "app_verified";

  // === Human-Readable Context ===
  title: string;                      // One-line summary
  description: string;                // Detailed explanation with context

  // === Affected Entity ===
  affectedUser?: {
    userId: string;                   // RevBack canonical user ID
    email?: string;
    externalIds: Record<string, string>;  // { stripe: "cus_xxx", apple: "txn_xxx" }
  };
  affectedProduct?: {
    productId: string;
    name: string;
    externalIds: Record<string, string>;  // { stripe: "prod_xxx", apple: "com.app.premium" }
  };

  // === Financial Impact ===
  revenueImpact?: {
    estimatedCents: number;
    currency: string;
    direction: "leakage" | "overbilling" | "unknown";
    period: "one_time" | "recurring";
    recurringIntervalDays?: number;   // 30 for monthly, 365 for yearly
  };

  // === Evidence (structured, not opaque) ===
  evidence: {
    // Platform states at time of detection
    platformStates?: Array<{
      source: string;                 // "stripe" | "apple" | "google"
      state: string;                  // Entitlement state
      subscriptionId?: string;        // External subscription ID
      lastEventTime?: string;         // ISO timestamp
    }>;

    // Relevant events
    triggeringEvents?: Array<{
      eventId: string;
      eventType: string;
      eventTime: string;
      source: string;
      amountCents?: number;
    }>;

    // Aggregate metrics (for system-level detectors)
    aggregateMetrics?: {
      affectedCount?: number;
      totalCount?: number;
      percentAffected?: number;
      baselineValue?: number;
      currentValue?: number;
      changePercent?: number;
      windowHours?: number;
    };

    // Time-based context
    timing?: {
      detectedAt: string;            // ISO timestamp
      issueStartedAt?: string;       // When the issue likely began
      durationHours?: number;
      gracePeriodHours?: number;      // How long we waited before flagging
    };
  };

  // === Recommended Actions (the key addition for agents) ===
  recommendedActions: Array<{
    actionId: string;                 // e.g., "revoke_entitlement"
    priority: number;                 // 1 = highest
    description: string;             // Human-readable: "Revoke access for this user"
    safetyTier: "fully_automated" | "guardrailed" | "human_approved";

    // What the agent needs to execute this action
    execution?: {
      // RevBack API call
      revbackAction?: {
        method: string;              // "PATCH"
        path: string;                // "/api/v1/entitlements/{id}"
        body: Record<string, unknown>;
      };

      // External provider API call
      providerAction?: {
        provider: string;            // "stripe"
        apiCall: string;             // "POST /v1/subscriptions/{id}"
        parameters: Record<string, unknown>;
      };

      // App-specific action (customer's API)
      appAction?: {
        description: string;         // "Call your access control API to revoke"
        requiredCapability: string;   // "access_management"
      };
    };

    // Safety constraints
    constraints?: {
      requiresConfidence?: number;    // Minimum confidence to auto-execute
      maxRevenueCents?: number;       // Maximum revenue impact for auto-execution
      rateLimitPerHour?: number;      // Maximum auto-executions per hour
      rollbackAvailable: boolean;     // Whether the action can be undone
    };
  }>;

  // === Compound Signal Links ===
  relatedIssues?: string[];           // Other issue IDs that form a pattern
  correlatedSignals?: Array<{
    issueType: string;
    relationship: "confirms" | "contradicts" | "supplements";
    description: string;
  }>;
}
```

---

## 6. Recommended Action Plans per Detector

### webhook_delivery_gap
```
1. [fully_automated] Check provider status page
2. [fully_automated] Verify webhook endpoint config via API
3. [fully_automated] Send test webhook
4. [guardrailed] Alert engineering team via Slack
5. [human_approved] Re-register webhook endpoint
```

### data_freshness
```
1. [fully_automated] Correlate with webhook_delivery_gap signals
2. [fully_automated] Spot-check 5 stale subscriptions via provider API
3. [fully_automated] Generate freshness report with affected segments
4. [guardrailed] Alert engineering team
5. [human_approved] Trigger full backfill reconciliation
```

### duplicate_billing
```
1. [fully_automated] Identify which subscription is newer (likely duplicate)
2. [fully_automated] Calculate overlap period and excess charges
3. [fully_automated] Check if user has contacted support about this
4. [guardrailed] Draft customer notification email
5. [human_approved] Cancel duplicate subscription
6. [human_approved] Issue prorated refund for overlap period
```

### cross_platform_conflict
```
1. [fully_automated] Query both providers for real-time subscription status
2. [fully_automated] Determine which state is more recent
3. [guardrailed] Update RevBack entitlement to match reality
4. [guardrailed] Notify internal team of conflict
5. [human_approved] Cancel or reactivate subscription to resolve conflict
```

### unrevoked_refund
```
1. [fully_automated] Verify refund/chargeback status with provider
2. [guardrailed] Revoke entitlement (set state to refunded/revoked)
3. [guardrailed] For chargebacks: revoke immediately
4. [human_approved] Submit chargeback evidence to provider
5. [human_approved] Contact user about refund status
```

### renewal_anomaly
```
1. [fully_automated] Correlate with webhook_delivery_gap signals
2. [fully_automated] Check provider status page
3. [fully_automated] Analyze failed payment spike
4. [fully_automated] Generate anomaly incident report
5. [guardrailed] Alert engineering team
6. [human_approved] Trigger targeted backfill for affected period
```

### verified_paid_no_access
```
1. [fully_automated] Verify payment status with billing provider
2. [guardrailed] Grant access via app API (if available)
3. [guardrailed] Send proactive support message to user
4. [guardrailed] Create support ticket if pattern detected
5. [human_approved] Investigate provisioning system for bugs
```

### verified_access_no_payment
```
1. [fully_automated] Verify subscription status with all providers
2. [fully_automated] Check for recent refund/cancellation events
3. [fully_automated] Determine if grace period applies
4. [guardrailed] Flag for review if single user
5. [human_approved] Revoke access if confirmed no active subscription
```

---

## 7. Compound Signal Analysis

Some of RevBack's most powerful insights come from correlating multiple detectors:

| Signal A | Signal B | Compound Insight | Confidence Boost |
|----------|----------|-----------------|-----------------|
| webhook_delivery_gap | data_freshness | Confirmed webhook failure — not just slow, data is stale | +15% |
| webhook_delivery_gap | renewal_anomaly | Webhook outage causing missed renewals — backfill urgently needed | +20% |
| duplicate_billing | cross_platform_conflict | User has subscriptions on both platforms but states disagree — likely one renewal failed | +10% |
| unrevoked_refund | verified_access_no_payment | Refund happened AND app confirms free access — very high confidence revenue leak | +10% |
| payment_without_entitlement (internal) | verified_paid_no_access | Both billing data AND app confirm paid user has no access — highest urgency | +15% |

An agent should actively look for these compound patterns when processing issues.

---

## 8. Platform Asymmetries Agents Must Understand

| Capability | Stripe | Apple | Google |
|-----------|--------|-------|--------|
| Cancel subscription via API | Yes | No (user must cancel) | Yes |
| Issue refund via API | Yes | Yes (limited) | Yes |
| Query real-time status | Yes | Yes | Yes |
| Send test webhook | Yes | No | No |
| Re-register webhook URL | Yes (API) | Yes (App Store Connect) | Yes (Cloud Pub/Sub) |
| Modify subscription | Yes | No | Yes (limited) |
| Access customer email | Yes | No (anonymized) | No |

**Critical implication:** An agent's remediation playbook must branch on platform. Actions that are automated on Stripe may require human intervention (or user self-service) on Apple.

---

## 9. Metadata That Helps Agents Make Good Decisions

Beyond the issue payload itself, agents benefit from:

1. **Organization context:** What platforms the org uses, expected subscription volume, billing intervals, average revenue per user
2. **Historical issue patterns:** Has this detector fired before for this org? How was it resolved?
3. **Resolution velocity:** How quickly does this org typically resolve issues?
4. **Revenue tier:** A $4.99/month consumer app vs. $499/month B2B SaaS needs different urgency calibration
5. **User lifetime value:** A 3-year customer with an unrevoked refund is a different conversation than a day-1 signup
6. **Platform mix:** An org that's 95% Stripe / 5% Apple has different cross-platform risk than 50/50

---

## 10. Key Recommendations

### For the Agent Integration Design:

1. **Structure issues as action plans, not just alerts.** The `recommendedActions` array in the payload is the most important addition. Agents need to know *what to do*, not just *what's wrong*.

2. **Support compound signal detection.** The ability to correlate multiple detectors produces higher-confidence signals. The agent payload should include `relatedIssues` and `correlatedSignals`.

3. **Implement safety tiers from day one.** The four-tier safety model (fully automated / guardrailed / human-approved / human-only) is essential. Start conservative (everything human-approved) and gradually unlock automation as confidence grows.

4. **Revenue impact drives prioritization.** The `revenueImpact` field should be mandatory on all user-level issues. Agents should prioritize by estimated revenue loss.

5. **Platform-aware action execution.** The agent must understand platform asymmetries. A "cancel duplicate subscription" action is a single API call on Stripe but requires user communication on Apple.

6. **Batch related issues.** When `data_freshness` fires, don't also send 200 individual `stale_subscription` alerts. The agent should receive the aggregate signal with the option to drill down.

7. **Include the "why" with every action.** Each recommended action should explain why it's the right thing to do, so the agent can communicate rationale to humans during approval flows.

8. **Design for partial automation.** The most realistic deployment starts with agents doing triage, investigation, and draft remediation — with humans approving the final action. Full automation is the end state, not the starting point.
