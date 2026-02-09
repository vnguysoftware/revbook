# RevBack Customer Review - Round 4

**Reviewer:** Dana Park, Director of Billing Operations, GameStream
**Date:** February 9, 2026
**Context:** We run a freemium-to-premium gaming subscription across iOS, Android, and web. 800K MAU, 45K paid subscribers. Stripe + Apple IAP + Google Play. I manage a 4-person team that handles billing escalations, refund disputes, and platform reconciliation. We lose ~$180K/year to billing bugs we catch too late.

**Core question: Can this replace our weekly manual reconciliation process?**

---

## Dashboard

**30-second verdict:** Strong at-a-glance summary. The category cards at the bottom are the best part — they map to exactly how I organize my team's work.

**Would use:** Yes

**Notes:**
- Revenue at Risk + Critical Issues as hero metrics make sense. 14 critical issues demanding attention is the right urgency signal.
- Revenue Saved showing "--" with "Resolve issues to start tracking savings" is honest. I actually prefer this to a fake number.
- The 4 category cards (Integration Health, Cross-Platform Intelligence, Revenue Protection, Verified Issues) are smart. My team already thinks in these buckets. Seeing "Unrevoked Refund: 22" tells me instantly where to focus today.
- Subscription Status Breakdown is useful — I can see 70% Active, 10% Expired, 5% Grace Period. State labels are clear (no jargon like "billing_retry" — it says "Payment Retry").
- The Verified Issues card with SDK upsell is tasteful. Shows what I'm missing without being pushy.

**Remaining gap:** No time-series chart showing issue volume trending over days/weeks. I need to know if things are getting better or worse.

---

## Issues

**30-second verdict:** This is the page my team would live in. Filtering, action hints, and category badges all work well.

**Would use:** Yes

**Notes:**
- Category filter dropdown (Integration Health, Cross-Platform Intelligence, Revenue Protection, Verified Issues) maps to my team's responsibilities perfectly.
- Every issue now has an inline action hint: "Check webhook processing pipeline" for Payment Not Provisioned, "Revoke access for refunded users immediately" for Unrevoked Refund, "Reconcile entitlement states across platforms" for Platform State Conflict. This is exactly what I'd tell my team.
- "App Verified" badge on Tier 2 issues (Paid Without Access, Unpaid Access) is a strong trust signal. Engineers care about confidence.
- Severity badges + category badges + type labels give me enough context without clicking into every issue.
- Status tabs (Open/Acknowledged/Resolved/Dismissed) map to a real triage workflow.

**Remaining gap:** No bulk actions. If 8 "Payment Not Provisioned" issues have the same root cause (webhook misconfiguration), I want to select all and acknowledge with a shared note.

---

## Issue Detail

**30-second verdict:** Recommended Action card is the standout feature. Stripe deep links in evidence are a major time saver.

**Would use:** Yes

**Notes:**
- "RECOMMENDED ACTION" card with specific guidance is excellent. For "Payment Not Provisioned": "Check webhook processing pipeline. A payment was received but the subscription state was not updated. Verify your webhook handler provisions entitlements after successful payments." — that's actionable and specific.
- Stripe deep links work: `sub_Bhp0ABoQFsIddr` links directly to `dashboard.stripe.com/subscriptions/sub_Bhp0ABoQFsIddr`. This saves 30 seconds per investigation.
- Evidence section formats currency values properly ($1,554.38 instead of raw cents) and uses human-readable labels ("Adjusted Impact", "Last Payment", "Subscription State" instead of camelCase field names).
- Acknowledge/Resolve/Dismiss workflow is clean. "View User Profile" and "Mark as Acknowledged" CTAs are the right next steps.
- Detector label shown as "Payment Not Provisioned" instead of raw `payment_without_entitlement`.

---

## Monitors

**30-second verdict:** Best "what does this tool actually do?" page I've seen. Each detector has a clear description, scope badge, and issue count.

**Would use:** Yes

**Notes:**
- 4 category sections match the Dashboard cards. Consistency builds trust.
- Per-detector descriptions are technically sound and specific. "Alerts when no webhooks are received from a billing provider for an unusual period. Catches webhook endpoint failures, provider outages, and misconfigured signing secrets before they cause data gaps." — that tells me exactly what it watches for.
- "Per user" vs "System-wide" scope labels help me understand blast radius.
- SDK-gated detectors show lock icon with "Requires SDK integration" — clear upsell path.
- "View N issues" links go directly to filtered issue list. Good workflow.

**Remaining gap:** No way to configure thresholds or snooze individual monitors. My webhook gap threshold should be different for Apple (slower) vs Stripe (faster).

---

## Insights

**30-second verdict:** The Detector Accuracy table now shows human-readable names. AI section is honest about being rule-based only.

**Would use:** Maybe (once AI features are live)

**Notes:**
- Detector names in the accuracy table are readable: "Trial Not Converted", "Payment Not Provisioned", "Platform State Conflict" instead of raw IDs. This is a big improvement.
- "Rule-based" badge is honest. The "Enable AI-Powered Analysis" card explains what AI would add without pretending it's already there.
- Billing Health Insights (anomaly/trend cards) provide useful signals: "Critical issue spike detected +200%", "$6407 revenue at risk +295%".

---

## Events

**30-second verdict:** Clean normalized event stream. Seeing Apple `DID_CHANGE_RENEWAL_STATUS` next to Stripe `invoice.payment_succeeded` in one view is genuinely useful.

**Would use:** Yes

**Notes:**
- Source tabs (All/Stripe/Apple/Google) work well.
- Multi-currency visible (USD, GBP, EUR) — matches our international user base.
- Raw event type shown below normalized type builds trust. I can see the translation RevBack made.
- $159.99 renewal for user d1238245 — amounts look like real subscription prices.

**Remaining gap:** No date range filter or event type filter. "Show me all refund events this week" is a common support workflow.

---

## Users

**30-second verdict:** Functional lookup tool. Search works well, but the table is too bare.

**Would use:** Conditionally

**Notes:**
- Search by email, user ID, or external ID covers main lookup methods.
- Every visible user shows "Clear" for issues — I'd rather see users WITH issues sorted to the top by default.

**Remaining gap:** No subscription status, plan name, or platform indicator in the table columns. I see a Stripe customer ID but can't tell if this is a $2.99 or $39.99 subscriber without clicking through.

---

## Final Verdict

**Can RevBack replace our weekly manual reconciliation?** For the detection part, yes. The 8 detectors cover our top billing failure modes: webhook gaps, unrevoked refunds, payment-without-provisioning, cross-platform mismatches, and silent renewal failures. The recommended actions and Stripe deep links mean my team can investigate issues 3x faster.

**Would I adopt it?** Yes, with caveats. The Issues page, Monitors page, and Issue Detail page are strong enough to use today. The Dashboard gives a good executive summary. Events and Users pages are functional but need more filtering.

**What sealed the deal:** Every issue has a specific recommended action AND a direct link to the relevant Stripe subscription. That's the difference between "here's a problem" and "here's a problem and here's how to fix it." My team currently spends 40% of their time just finding the right Stripe object — this eliminates that.

**Remaining asks (not dealbreakers):**
1. Bulk actions on Issues page (select + acknowledge multiple)
2. Configurable monitor thresholds
3. Date range filter on Events page
4. Trend chart on Dashboard
5. Subscription info on Users table
