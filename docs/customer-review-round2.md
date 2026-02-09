# RevBack Customer Review - Round 2

**Reviewer:** Sarah Chen, Head of Revenue Operations, FitTrack
**Date:** February 9, 2026
**Context:** Focused re-review of Round 1 critical items only. The team said they fixed several issues. Checking their work.

---

## 1. Dashboard (/)

### STILL BROKEN: "Subscription Guard" tagline
The sidebar still says "SUBSCRIPTION GUARD" directly under the RevBack logo. This was called out in Round 1 (#20) as vague. No change.

### STILL BROKEN: Sidebar badge count mismatch
The Issues nav item shows a badge of **3**, but the dashboard says **36 open issues** and the Issues page confirms 36. This was Round 1 Critical #4. Still wrong. The badge says 3, reality says 36. This is the single most visible number in the UI and it is wrong. Whatever "3" represents (new today? critical? unacknowledged?) is never explained.

### STILL BROKEN: "Revenue Saved: $0"
Still showing $0 with "0 issues resolved" and no contextual messaging. Round 1 #17 suggested something like "Resolve your first issue to start tracking savings." No change -- still looks like the tool is failing.

### STILL BROKEN: "Entitlement state distribution"
The Subscriber Health card still has the subheading "Entitlement state distribution." Round 1 (#34 area) flagged this as jargon. No change. Should say "Subscription status breakdown" or similar.

### NOT CHANGED: Issue type labels in "Issues by Type"
The dashboard "Issues by Type" section now shows human-readable names: "Unrevoked Refund," "Renewal Rate Drop," "Paid Without Access," "Payment Not Provisioned," "Expired Subscription Still Active," "Platform State Conflict," "Webhook Delivery Gap," "Trial Not Converted," "Unpaid Access." These are decent. However, I note some inconsistency -- on the Issues list the type labels show `Payment Not Provisioned` in monospace/code font while the dashboard shows them in regular text. Minor but noticeable.

---

## 2. Issues (/issues)

### STILL BROKEN: Revenue impact numbers unrealistic
The "Payment Not Provisioned" issues still show ~$1,500/mo per user ($1,554.38, $1,607.59, $1,544.01, $1,614.66, etc.). For a consumer fitness subscription app at $5-$80/year pricing, these numbers are absurd. This was Round 1 Critical #1. No fix.

Some issues DO show realistic numbers: $2.99 (Unpaid Access / Lite Weekly), $4.99, $13.33 (Renewal Rate Drop), $349.99 (Paid Without Access / Pro Annual), $6.67 (Trial Not Converted). So the problem is specifically in the "Payment Not Provisioned" and "Unrevoked Refund" detectors generating inflated amounts ($1,483-$1,617 range). The seed data appears to use random large numbers for those detector types while other detectors use realistic plan prices.

### STILL BROKEN: Badge count mismatch
Sidebar badge says "3" on the Issues page too. The page header says "36 open issues detected." Same problem as dashboard. Still broken.

### OBSERVATION: Issue type labels improved
The issue cards now show human-readable labels: "Payment Not Provisioned," "Webhook Delivery Gap," "Paid Without Access," "Unpaid Access," "Renewal Rate Drop," "Unrevoked Refund," "Platform State Conflict," "Expired Subscription Still Active," "Trial Not Converted." These are better than the internal code names. Partial improvement.

### NEW: "App Verified" badge
The "Paid Without Access" and "Unpaid Access" issues now show a green "App Verified" badge. This is a good addition -- it differentiates between webhook-only detection and SDK-verified detection. Nicely done.

---

## 3. Issue Detail (/issues/:id)

### STILL BROKEN: AI Investigation vaporware placeholder
Still prominently displayed on every issue page. Still says "AI-powered root cause analysis will be available here once enabled for your account." Still takes up a large section of the page. This was Round 1 #8. No change. The section is labeled "AI-Powered" with a sparkle icon, advertising a feature that does not exist.

### STILL BROKEN: Detector code names shown
The issue detail still shows `Detector: payment_without_entitlement` and `Detector: verified_access_no_payment` in monospace code font. Round 1 #14 specifically flagged this. On the issues LIST page, the type labels are now human-readable ("Payment Not Provisioned"), but on the detail page the raw detector code name is exposed. Inconsistent.

### STILL BROKEN: Evidence values not formatted
Evidence section still shows raw cents as integers:
- `Adjusted Impact: 155438` (should be $1,554.38)
- `Last Payment Amount: 13078` (should be $130.78)

This was Round 1 #15. No change. The formatted dollar amount appears in the header ($1,554.38) but the evidence table shows the raw integer. A business user will be confused by "155438" next to "$1,554.38" -- are these different numbers? Which is right?

### OBSERVATION: Issue type label on detail page
The issue detail header area does show the human-readable label ("Payment Not Provisioned," "Unpaid Access") which is an improvement from pure code names. But the detector field below still leaks the internal name.

---

## 4. Monitors (/monitors)

### STILL BROKEN: Not in navigation
The Monitors page exists at /monitors and renders well. The content is excellent -- clear explanations of each detector, open issue counts, links to filtered views. But it is STILL not in the sidebar navigation. Round 1 #12 flagged this specifically. The sidebar shows: Dashboard, Issues, Users, Events, Alerts, Insights, Setup. No "Monitors" link.

This is the single best page for understanding what RevBack does, and users can only find it by guessing the URL.

### OBSERVATION: Monitors page content is solid
The page is well-organized into categories (Integration Health, Cross-Platform Intelligence, Revenue Protection, Verified Issues). Each detector has a plain-language description, severity level, and link to filtered issues. The "Unlock Verified Detection" upsell banner for SDK integration is tasteful. This page should be front and center.

---

## 5. Overall Assessment

### What was FIXED or IMPROVED since Round 1:
1. Issue type labels on the Issues list page are now human-readable ("Payment Not Provisioned" instead of `payment_without_entitlement`)
2. "App Verified" badges added to SDK-verified issues -- good trust signal
3. The issue detail page shows the human-readable type label in the header area

### What was NOT fixed (Round 1 Critical items):
1. **Revenue impact numbers still inflated** -- "Payment Not Provisioned" issues at $1,500+/mo for consumer subscriptions (Critical #1, unfixed)
2. **Sidebar badge says "3" when 36 issues exist** -- fundamental data integrity issue (Critical #4, unfixed)
3. **"Subscription Guard" tagline still present** (#20, unfixed)
4. **"Revenue Saved: $0" empty state still demoralizing** (#17, unfixed)
5. **"Entitlement state distribution" jargon still there** (#34 area, unfixed)
6. **AI Investigation placeholder still on every issue page** (#8, unfixed)
7. **Detector code names still shown on issue detail** (#14, partially fixed -- list page improved, detail page not)
8. **Evidence values still raw cents** (#15, unfixed)
9. **Monitors page still not in sidebar navigation** (#12, unfixed)

### NEW issues introduced:
None observed. The fixes that were made (issue type labels, App Verified badges) did not break anything.

---

## Verdict

Out of 9 items I specifically checked, only 1 was meaningfully addressed (issue type labels on the list page), with partial improvement on detector labels. The 4 original Critical items remain:

| Round 1 Critical | Status |
|---|---|
| #1 Revenue impact numbers unreliable | **NOT FIXED** |
| #2 No actionable next steps | Not checked this round |
| #3 Setup page crash | Not checked this round |
| #4 Sidebar badge count wrong | **NOT FIXED** |

The team said they fixed "several issues." What I can see fixed is cosmetic labeling on the issues list. The structural problems -- data integrity (badge count), data credibility (revenue numbers), vaporware (AI section), and discoverability (Monitors nav) -- are all untouched.

**My recommendation remains the same as Round 1:** I cannot recommend this to my VP until the revenue numbers are credible and the badge count matches reality. These are table-stakes trust issues.
