# UX Research: Detector Communication Strategy

**RevBack -- How to Communicate 8 Detectors to Customers**
**Date:** 2026-02-09

---

## Executive Summary

RevBack's 8 detectors fall into two natural tiers (billing-only vs. app-verified) and three conceptual categories (system health, cross-platform, and per-user correctness). The current UI treats all issues as a flat list with type labels in monospace font. This research recommends a shift to **category-grouped information architecture**, **action-first framing**, and **progressive disclosure of Tier 2** that makes the initial Tier 1 experience feel complete while planting clear upgrade hooks.

Key recommendations:
1. Group detectors into 3 categories in the UI, not by tier
2. Rename detectors using plain-language, outcome-focused labels
3. Add a persistent "Recommended Action" block to every issue card and detail page
4. Introduce a "Detectors" status page showing what is active, what requires SDK setup, and historical detection rates
5. Design empty states that show detection *capability* rather than absence of data

---

## 1. Information Architecture

### Current State

The Issues page (`/issues`) displays all detector outputs in a single flat list. The only grouping mechanism is the "All types" dropdown filter, which lists 11 issue type IDs. The Dashboard's "Issues by Type" card also presents a flat count table.

**Problem:** A customer scanning the issues list has no mental model for *why* these different issues exist or how they relate to each other. "Webhook Gap" and "Paid But No Access" look structurally identical despite being fundamentally different (system health vs. per-user correctness).

### Recommendation: Three Category Groups

Organize detectors into three conceptual categories that map to customer mental models:

**Category 1: System Health** (infrastructure-level, affects all users)
- Webhook Delivery Gap
- Stale Billing Data
- Unusual Renewal Pattern

**Category 2: Cross-Platform Conflicts** (RevBack's unique value -- cross-provider view)
- Duplicate Cross-Platform Billing
- Cross-Platform State Conflict

**Category 3: User-Level Correctness** (individual subscriber issues)
- Refund Without Access Revocation
- Paid But No Access (Tier 2)
- Access Without Payment (Tier 2)

### Why Not Group by Tier?

Grouping by "Tier 1 / Tier 2" exposes internal implementation details. Customers do not care about tiers. They care about *what kind of problem this is*. The tier distinction (billing-only vs. app-verified) is better communicated via a badge on individual issues rather than as an organizational axis.

### Why Not Group by Severity or Provider?

- **Severity** changes over time and is already filterable. Making it the primary grouping axis means items jump between groups.
- **Provider** (Stripe/Apple/Google) is useful as a filter but not as a category, because cross-platform detectors span multiple providers.

### UI Implementation

**On the Issues page:**
- Add a segmented control or tab row above the list: `All | System Health | Cross-Platform | User Correctness`
- These are additive to the existing status tabs (Open/Acknowledged/Resolved/Dismissed)
- Display category as a colored tag on each issue row, replacing the current monospace type label

**On the Dashboard:**
- Replace the flat "Issues by Type" card with a "Detection Categories" card showing three rows:
  - System Health: N issues, $X at risk
  - Cross-Platform: N issues, $X at risk
  - User Correctness: N issues, $X at risk
- Each row links to the Issues page pre-filtered to that category

**Competitive reference:** Sentry uses "For Review / Regressed / Escalating" tabs that cross-cut issue types. Datadog uses "monitor groups" and tags for organizing alerts. PagerDuty has "Incident Types" as a first-class concept. RevBack's category system is closest to PagerDuty's approach.

---

## 2. Naming and Language

### Current Naming Audit

| Current Internal ID | Current UI Label | Problem |
|---|---|---|
| `payment_without_entitlement` | "Payment Not Provisioned" | "Provisioned" is developer jargon |
| `entitlement_without_payment` | "Expired Subscription Still Active" | Clear but long |
| `refund_not_revoked` | "Refund Not Revoked" | OK but passive |
| `cross_platform_mismatch` | "Cross-Platform Mismatch" | Vague -- mismatch of what? |
| `duplicate_subscription` | "Duplicate Subscription" | Missing "cross-platform" context |
| `silent_renewal_failure` | "Silent Renewal Failure" | "Silent" is confusing -- it did not fail silently, we detected it |
| `webhook_delivery_gap` | "Webhook Gap" | Too abbreviated |
| `stale_subscription` | "Stale Subscription" | "Stale" is technical |
| `verified_paid_no_access` | "Paid But No Access" | Good, clear |
| `verified_access_no_payment` | "Access Without Payment" | Good, clear |

### Recommended Naming

The naming strategy: **[What happened] + [Why it matters]** in the short label, with a one-sentence explanation for tooltips.

| Detector | Short Label (Issue List) | Category Badge | Tooltip |
|---|---|---|---|
| Webhook Delivery Gap | **Webhook Delivery Gap** | System Health | No webhooks received from [Provider] in [N] hours. Check endpoint configuration. |
| Duplicate Cross-Platform Billing | **Duplicate Billing** | Cross-Platform | Same user paying on both [Provider A] and [Provider B] for the same product. |
| Refund Without Revocation | **Unrevoked Refund** | User Correctness | Refund or chargeback processed but subscription access was not revoked. |
| Cross-Platform State Conflict | **Platform State Conflict** | Cross-Platform | User is [state] on [Provider A] but [state] on [Provider B]. |
| Unusual Renewal Pattern | **Renewal Rate Drop** | System Health | Renewal rate dropped [N]% vs. rolling average for [Provider]. |
| Stale Billing Data | **Missing Billing Updates** | System Health | [N]% of subscriptions have no events in [N]+ days. |
| Paid But No Access | **Paid Without Access** | User Correctness | User is paying but your app confirms they cannot access the product. |
| Access Without Payment | **Unpaid Access** | User Correctness | User has access but all subscriptions are expired or revoked. |

### Audience Considerations

The target audience (engineering leads at mid-size SaaS companies) will understand "webhook" but may not immediately parse "entitlement" or "provisioned." The recommended names prioritize:
- Outcome over mechanism ("Renewal Rate Drop" over "Silent Renewal Failure")
- Plain language over internal jargon ("Missing Billing Updates" over "Stale Subscription")
- Brevity for scan-ability (all short labels are 1-3 words)

---

## 3. Action-Oriented Framing

### Current State

The current Issue Detail page shows description text and has an AI Investigation section with a "Recommendation" field, but there is no persistent, standardized "what to do next" block. The action is buried in free-text descriptions.

### Recommendation: Recommended Action Block

Every issue (in both list view and detail view) should have a structured action block.

**In the issue list (Issues page):**
- Add a single-line "action hint" below the description text, visually distinct (e.g., blue text with arrow icon)
- Example: "-> Check your Stripe webhook endpoint configuration"
- This replaces the need to click into every issue to understand what to do

**In the issue detail page:**
- Add a prominent "Recommended Action" card between the issue header and AI Investigation
- Structure:

```
+--------------------------------------------------+
|  RECOMMENDED ACTION                               |
|                                                    |
|  Check your refund webhook handler. For charge-   |
|  backs, revoke this user's access immediately.    |
|                                                    |
|  [View Stripe Dashboard ->]  [Mark as Resolved]  |
+--------------------------------------------------+
```

- Include deep links to relevant external dashboards (Stripe refund page, Apple subscription management) when possible
- The action should be detector-specific and static (not AI-generated), ensuring consistency

### Action Templates per Detector

| Detector | Recommended Action |
|---|---|
| Webhook Delivery Gap | "Check your [Provider] webhook endpoint configuration. Verify signing secrets are correct." |
| Duplicate Billing | "Refund the duplicate subscription on [Provider B] for this user. Consider adding cross-platform dedup logic." |
| Unrevoked Refund | "Verify your refund webhook handler revokes access. For chargebacks, revoke access for this user immediately." |
| Platform State Conflict | "Investigate whether this user should have access on both platforms. Sync entitlement state." |
| Renewal Rate Drop | "Check [Provider] webhook configuration. Investigate if this is a genuine churn spike or a data pipeline issue." |
| Missing Billing Updates | "Re-register server notification URLs for [Provider]. Test webhook delivery." |
| Paid Without Access | "Fix the provisioning bug for this user. Check your entitlement granting logic." |
| Unpaid Access | "Revoke access for this user or investigate why their subscription state is incorrect." |

---

## 4. Progressive Disclosure: Tier 1 vs. Tier 2

### The Challenge

Tier 1 (6 detectors) works immediately after connecting billing. Tier 2 (2 detectors) requires SDK integration. The risk: Tier 1 feels "incomplete" if users see references to Tier 2, but Tier 2 is never discovered if we hide it entirely.

### Recommendation: "Active Detectors" Status Page

Create a new page or section: **Settings > Detectors** (or **Dashboard > Detection Status**).

**Wireframe:**

```
DETECTION STATUS
8 detectors available, 6 active

ACTIVE DETECTORS (6)
+-----------------------------------------------+
| [green dot] Webhook Delivery Gap       Active  |
|             Last checked: 5 min ago            |
+-----------------------------------------------+
| [green dot] Duplicate Billing          Active  |
|             Last checked: 2 min ago            |
+-----------------------------------------------+
| [green dot] Unrevoked Refund           Active  |
|             ...                                |
+-----------------------------------------------+
| [green dot] Platform State Conflict    Active  |
+-----------------------------------------------+
| [green dot] Renewal Rate Drop          Active  |
+-----------------------------------------------+
| [green dot] Missing Billing Updates    Active  |
+-----------------------------------------------+

AVAILABLE WITH APP INTEGRATION (2)
+-----------------------------------------------+
| [lock icon] Paid Without Access     Requires   |
|             Catch paying users who   SDK setup  |
|             can't access your app               |
|                          [Enable ->]            |
+-----------------------------------------------+
| [lock icon] Unpaid Access           Requires   |
|             Catch users with free    SDK setup  |
|             access after expiration             |
|                          [Enable ->]            |
+-----------------------------------------------+

These detectors require your app to report access
status via the RevBack SDK. Setup takes ~10 minutes.
[Set Up App Integration ->]
```

### Progressive Disclosure Strategy

1. **Onboarding:** Do NOT mention Tier 2 during initial setup. The first-run experience should feel complete: "6 detectors are now monitoring your billing."

2. **Dashboard:** Show a subtle prompt after the customer has been active for 1+ week and has resolved at least 1 issue:
   ```
   +--------------------------------------------------+
   |  Unlock 2 more detectors                          |
   |  Catch paid-but-no-access and free-access bugs   |
   |  by connecting your app. [Learn more ->]          |
   +--------------------------------------------------+
   ```

3. **Issue Detail (Tier 1 issues):** When showing a "Payment Not Provisioned" issue (billing-only version), add a subtle note:
   ```
   "This issue was detected from billing data only.
    Enable App Verification for higher confidence
    detection. [Learn more]"
   ```

4. **Detection Status page:** Always show all 8 detectors, with the 2 Tier 2 detectors in a separate "Available with App Integration" section.

### What NOT to Do

- Do not show "2/8 detectors disabled" on the dashboard -- this makes Tier 1 feel incomplete
- Do not use the word "tier" in customer-facing UI
- Do not gate any existing Tier 1 functionality behind SDK setup
- Do not show a persistent banner nagging about SDK installation

---

## 5. Aggregate vs. Per-User Display

### The Problem

Three detectors produce aggregate issues (Webhook Delivery Gap, Renewal Rate Drop, Missing Billing Updates). These are system-wide signals, not tied to a specific user. The current UI is 100% per-user oriented, with "Affected User" links on every issue.

### Recommendation: Distinct Visual Treatment

**Aggregate issues should look different from per-user issues:**

1. **Issue list row:** Replace the user-specific title pattern ("Payment succeeded for Ava Kim") with a system-level title pattern ("Apple App Store: No webhooks in 2+ hours"). Remove the user avatar/link. Add a "System" badge instead of a user badge.

2. **Issue detail page:** For aggregate issues:
   - Remove the "Affected User" card
   - Replace with an "Affected Scope" card showing:
     - Which provider(s) are affected
     - How many subscribers are potentially impacted
     - Historical context (e.g., "Normally receive 50+ webhooks/day from Apple")
   - Show a "Subscriber Impact" estimate rather than per-user revenue impact

3. **Dashboard "Recent Issues" card:** Aggregate issues should show with a different icon (e.g., a server/globe icon instead of a user icon) to distinguish them at a glance.

**Wireframe for aggregate issue row:**

```
[warning] [System Health]
Apple App Store: No webhooks in 2+ hours
Normal webhook frequency is every 5-15 min. Last received 2h ago.
                                          ~$4,500 at risk   5h ago
```

**vs. per-user issue row:**

```
[critical] [User Correctness] [App Verified]
Paying customer without access: Jennifer Adams
User has active entitlement for Pro Annual but app reported no access.
                                          $349.99 at risk   6h ago
```

---

## 6. Onboarding and Education

### How Customers Learn What Each Detector Does

**Strategy: Contextual education, not upfront education.**

Customers should NOT need to read documentation before using RevBack. Instead:

1. **First detection email/notification:** When the first issue of a given type is detected, include an educational block:
   ```
   WHAT THIS MEANS
   RevBack detected that a user's refund was processed but their
   subscription access was not revoked. This happens when refund
   webhooks are not properly handled by your application.

   WHY THIS MATTERS
   This user still has access to your product despite receiving
   a refund. Estimated revenue impact: $X/month.
   ```

2. **Issue Detail page -- first occurrence:** When a customer sees a detector type for the first time, show a one-time educational banner:
   ```
   +--------------------------------------------------+
   |  [i] ABOUT THIS DETECTOR                         |
   |                                                    |
   |  "Unrevoked Refund" monitors for cases where a   |
   |  refund or chargeback was processed but your app  |
   |  did not revoke subscription access.              |
   |                                                    |
   |  RevBack can detect this because Stripe reports   |
   |  the refund but has no visibility into whether    |
   |  your app actually revoked access.                |
   |                                                    |
   |  [Got it]                              [Learn more]|
   +--------------------------------------------------+
   ```

3. **Detection Status page (recommended in Section 4):** Each detector has a one-line description and an expandable "How it works" explanation. This serves as the reference documentation.

4. **Tooltips on type badges:** In the Issues list, hovering over the category badge (e.g., "Cross-Platform") shows a brief tooltip explaining the category.

### What NOT to Do

- Do not create a separate "Detectors" documentation page that customers are expected to read before using the product
- Do not show a "tour" or modal walkthrough of all 8 detectors during onboarding -- this is premature information
- Do not explain detection methodology in the issue description itself -- keep descriptions focused on the specific finding

---

## 7. Empty States

### The Challenge

A new customer connects Stripe and runs a backfill. Three scenarios:

**Scenario A:** Issues found immediately (the current happy path -- the First Look report handles this well)

**Scenario B:** No issues found (a good sign, but the customer may wonder if RevBack is working)

**Scenario C:** Waiting for webhooks (backfill complete, but real-time monitoring has not triggered yet)

### Recommendation: Show Capability, Not Absence

**Dashboard empty state (no issues yet):**

```
+--------------------------------------------------+
|                                                    |
|  ALL CLEAR                                         |
|  No billing issues detected across 500 subscribers |
|                                                    |
|  RevBack is actively monitoring:                   |
|                                                    |
|  [checkmark] Webhook delivery health               |
|  [checkmark] Cross-platform billing conflicts      |
|  [checkmark] Refund handling verification          |
|  [checkmark] Renewal pattern anomalies             |
|  [checkmark] Billing data freshness                |
|  [checkmark] Platform state consistency            |
|                                                    |
|  We check for issues every 15 minutes. You'll be  |
|  notified immediately when something needs         |
|  attention.                                        |
|                                                    |
+--------------------------------------------------+
```

This approach, inspired by NN/g's empty state guidelines, achieves three goals:
1. **Communicates system status** -- "We are monitoring, things are healthy"
2. **Provides learning cues** -- Lists what RevBack checks, teaching detector capabilities
3. **Builds confidence** -- Shows the product is working even when there is nothing wrong

**Issues page empty state (no open issues):**

Instead of just "No open issues -- Your billing looks healthy":

```
+--------------------------------------------------+
|                                                    |
|  [green checkmark icon]                           |
|                                                    |
|  No open issues                                   |
|  RevBack is monitoring 500 subscribers across     |
|  2 billing platforms with 6 active detectors.     |
|                                                    |
|  Last full scan: 12 minutes ago                   |
|  Next scheduled scan: in 3 minutes                |
|                                                    |
|  [View resolved issues]    [Detection settings]   |
|                                                    |
+--------------------------------------------------+
```

**First-time dashboard (no data at all -- pre-connection):**

```
+--------------------------------------------------+
|                                                    |
|  Start monitoring your billing health              |
|                                                    |
|  RevBack detects subscription issues that cost     |
|  companies an average of $3,200/month.             |
|                                                    |
|  [Connect Stripe]     [Connect Apple]              |
|                                                    |
|  What RevBack monitors:                            |
|  - Duplicate billing across platforms              |
|  - Unrevoked refunds and chargebacks              |
|  - Webhook delivery gaps                           |
|  - Subscription state conflicts                    |
|  - ... and more                                    |
|                                                    |
+--------------------------------------------------+
```

**Competitive reference:** Sentry shows a "Set up your project" empty state with step-by-step instructions and sample code. Datadog shows "Install the Datadog Agent" with a clear single CTA. The pattern: empty states should tell you what to do next, not just that nothing has happened yet.

---

## 8. Competitive UX Patterns

### Sentry

**What works well:**
- **Fingerprint-based grouping** reduces noise: many events become one issue. RevBack already does this at the detector level.
- **"For Review" tab** separates new/regressed issues from the backlog. RevBack could benefit from a "New this week" filter.
- **Issue status workflow** (Unresolved -> Ongoing -> Resolved -> Archived) with automatic regression detection. RevBack's Open/Acknowledged/Resolved/Dismissed is similar.
- **Priority system:** Sentry recently added priority (P1-P4) on top of severity levels. This is worth considering if RevBack's issue volume grows.

**What to adapt:**
- Sentry's "Trends" sort (escalating + new issues first) would be valuable for RevBack when customers have many issues.

### Datadog

**What works well:**
- **Monitor groups with tags** for flexible organization. Tags like `team:payments`, `env:production` help route alerts. RevBack could tag issues by product, platform, or team.
- **Notification routing** separate from monitor configuration. RevBack should support per-detector or per-category notification channels.
- **Algorithmic feeds** (Watchdog) that surface anomalies without configuration. RevBack's "Unusual Renewal Pattern" and "Stale Billing Data" detectors are similar in concept.

**What to adapt:**
- Datadog's "Manage Monitors" page shows all configured monitors with status. This maps directly to the "Detection Status" page recommended in Section 4.

### PagerDuty

**What works well:**
- **Incident Priority** (P1-P5) as a first-class concept displayed prominently on the dashboard. RevBack uses severity (critical/warning/info), which serves a similar purpose.
- **Incident Types** allow custom categorization and custom fields per type. RevBack's three categories (System Health, Cross-Platform, User Correctness) could use this pattern.
- **Customizable alert table columns** let users choose what information matters to them.

**What to adapt:**
- PagerDuty's incident type system where different types have different required fields. For RevBack, aggregate issues and per-user issues naturally have different fields.

### LaunchDarkly

**What works well:**
- **Feature-level attribution** in alerts ("error rate increased when you toggled the new-payment-processor flag"). RevBack could attribute issues to specific products or subscription plans.
- **Progressive complexity** -- basic flags are simple, advanced targeting rules layer on complexity. Mirrors RevBack's Tier 1 (simple) vs Tier 2 (requires integration) approach.

---

## 9. Summary of Recommendations

### Must-Have (implement before first customer)

| # | Recommendation | Effort | Impact |
|---|---|---|---|
| 1 | Rename detectors using plain-language labels | Small | High -- reduces confusion |
| 2 | Add "Recommended Action" block to issue detail page | Small | High -- makes issues actionable |
| 3 | Distinguish aggregate vs. per-user issues visually | Medium | High -- prevents confusion |
| 4 | Improve empty states to show detection capability | Small | High -- builds confidence |
| 5 | Add category badges to issue rows (System Health / Cross-Platform / User Correctness) | Small | Medium -- provides context |

### Should-Have (implement within first month)

| # | Recommendation | Effort | Impact |
|---|---|---|---|
| 6 | Add category filter tabs to Issues page | Medium | Medium -- improves navigation |
| 7 | Create Detection Status page showing all 8 detectors | Medium | High -- drives SDK adoption |
| 8 | Add action hints to issue list rows | Small | Medium -- reduces click-through |
| 9 | Add first-occurrence educational banners | Medium | Medium -- teaches detector value |

### Nice-to-Have (iterate based on feedback)

| # | Recommendation | Effort | Impact |
|---|---|---|---|
| 10 | Deep links to provider dashboards from issue detail | Medium | Medium -- reduces context switching |
| 11 | "New this week" filter inspired by Sentry's "For Review" | Small | Low-Medium |
| 12 | Per-category notification channel configuration | Large | Medium -- enterprise readiness |

---

## Appendix A: Updated Constants File

Proposed update to `dashboard/src/lib/constants.ts`:

```typescript
// Detection categories
export const DETECTION_CATEGORIES = {
  system_health: {
    label: 'System Health',
    color: 'blue',
    description: 'Infrastructure-level monitoring across all subscribers',
    detectors: ['webhook_delivery_gap', 'stale_subscription', 'silent_renewal_failure'],
  },
  cross_platform: {
    label: 'Cross-Platform',
    color: 'purple',
    description: 'Issues that span multiple billing providers',
    detectors: ['duplicate_subscription', 'cross_platform_mismatch'],
  },
  user_correctness: {
    label: 'User Correctness',
    color: 'amber',
    description: 'Per-user billing and access discrepancies',
    detectors: ['refund_not_revoked', 'verified_paid_no_access', 'verified_access_no_payment'],
  },
} as const;

// Renamed issue type labels
export const ISSUE_TYPE_LABELS: Record<string, string> = {
  webhook_delivery_gap: 'Webhook Delivery Gap',
  duplicate_subscription: 'Duplicate Billing',
  refund_not_revoked: 'Unrevoked Refund',
  cross_platform_mismatch: 'Platform State Conflict',
  silent_renewal_failure: 'Renewal Rate Drop',
  stale_subscription: 'Missing Billing Updates',
  verified_paid_no_access: 'Paid Without Access',
  verified_access_no_payment: 'Unpaid Access',
  // Legacy IDs
  payment_without_entitlement: 'Payment Not Provisioned',
  entitlement_without_payment: 'Expired Sub Still Active',
  paid_no_access: 'Paid Without Access',
  access_no_payment: 'Unpaid Access',
  refund_still_active: 'Unrevoked Refund',
  trial_no_conversion: 'Trial Not Converted',
};

// Recommended actions per detector
export const DETECTOR_ACTIONS: Record<string, string> = {
  webhook_delivery_gap: 'Check your webhook endpoint configuration and verify signing secrets are correct.',
  duplicate_subscription: 'Refund the duplicate subscription for this user. Consider adding cross-platform dedup logic.',
  refund_not_revoked: 'Verify your refund webhook handler revokes access. For chargebacks, revoke access immediately.',
  cross_platform_mismatch: 'Investigate whether this user should have access on both platforms. Sync entitlement state.',
  silent_renewal_failure: 'Check provider webhook configuration. Investigate whether this is a churn spike or data issue.',
  stale_subscription: 'Re-register server notification URLs for this provider. Test webhook delivery.',
  verified_paid_no_access: 'Fix the provisioning bug for this user. Check your entitlement granting logic.',
  verified_access_no_payment: 'Revoke access for this user or investigate why their subscription state is incorrect.',
};
```

## Appendix B: Issue Category Mapping Logic

```typescript
export function getIssueCategory(issueType: string): keyof typeof DETECTION_CATEGORIES {
  for (const [category, config] of Object.entries(DETECTION_CATEGORIES)) {
    if (config.detectors.includes(issueType)) {
      return category as keyof typeof DETECTION_CATEGORIES;
    }
  }
  // Default fallback
  return 'user_correctness';
}
```
