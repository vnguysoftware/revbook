# RevBack Customer Review - Round 1

**Reviewer:** Sarah Chen, Head of Revenue Operations, FitTrack
**Date:** February 9, 2026
**Context:** 50,000 paying subscribers across Stripe and Apple App Store. Evaluating RevBack for billing issue detection. First time through the product.

---

## Page-by-Page Evaluation

### 1. Dashboard (/)

**First impression:** Strong. The layout gives me a fast read on what matters: revenue at risk, critical issues, and integration health. I can immediately see $23,753 is at risk across 36 issues. That is a compelling number if accurate.

**What is confusing or unclear:**
- "Revenue Saved: $0" with "0 issues resolved" feels like an accusation. If I just connected the tool, this is expected -- but it looks like the tool is failing to deliver value. Needs context like "Resolve your first issue to start tracking savings."
- The Issues badge in the sidebar says "3" but the dashboard says 36 open issues and the Issues page confirms 36. This is a trust-destroying discrepancy. Which number is right? What does the "3" mean? New since last login? Unacknowledged? It is never explained.
- "12% vs last week" on Revenue at Risk -- 12% up or down? The arrow and color suggest up (bad), but this needs explicit directional language like "12% increase."
- "8% vs last week" on Revenue Saved -- 8% of what? $0 was saved, so what is the baseline? This metric feels broken.

**What would make me lose trust:**
- The $23,753 number is presented without any explanation of how it is calculated. At FitTrack our ARPU is maybe $15/month. Seeing "Payment Not Provisioned" issues at $1,554/mo makes me wonder if these are real or if the revenue impact calculation is wildly inflated. How can a single user represent $1,554/mo in revenue at risk for a fitness app? The number feels made up.
- "500 Active Subscribers" -- I have 50,000. If this is demo data, fine. But when it is my real data, I need to know this matches my source of truth (Stripe Dashboard) or I will not believe anything else.

**What is missing:**
- Date range selector. Am I looking at the last 7 days? 30 days? All time? No idea.
- No way to filter by billing provider (show me just Apple issues vs Stripe issues).
- No trend chart. Is my revenue leakage getting worse or better over time? A line chart showing issues over time would be the single most valuable addition.

**Signal vs noise:**
- "Trial Not Converted" (10 issues, $117.98) feels like noise mixed with "Unrevoked Refund" ($6,011 at risk). Trial non-conversion is a marketing/product problem, not a billing correctness issue. Mixing these dilutes the urgency.

**Is the language plain enough:**
- "Entitlement state distribution" in Subscriber Health is jargon. I would say "Subscription status breakdown."
- "Payment Not Provisioned" is unclear. "Payment received but access not granted" would be instantly clear.
- "Billing retry" in subscriber health -- my team calls this "dunning" or "past due." The internal terminology leaks through.

---

### 2. Issues List (/issues)

**First impression:** Good layout. The issue cards are scannable. Severity badges, dollar amounts, and confidence scores all visible at a glance. The filter bar is solid.

**What is confusing or unclear:**
- "Payment Not Provisioned" shows up 8 times as individual issues but they all look like the same root cause. If there is a systemic webhook failure causing 8 payment-not-provisioned issues, I want to see ONE grouped issue with "8 affected users" rather than 8 separate cards. Individual user issues are for my support team; I need to see systemic patterns.
- What does the checkbox on each issue row do? There is no bulk action bar visible. I see checkboxes but no indication of what selecting them enables.
- "Dismissed" vs "Resolved" -- what is the difference in RevBack's model? If I dismiss something, does it come back? Is it a false positive? No tooltips explain the workflow states.

**What would make me lose trust:**
- The issue type dropdown includes "Missing Billing Updates" and "Duplicate Billing" but zero issues exist for those types. Showing empty filter options makes me wonder if these detectors are actually working or are vaporware.
- "Payment Not Provisioned" issues all show ~$1,500/mo impact. For a fitness subscription at $15/mo, these numbers are impossible. The revenue impact calculation is clearly wrong or the demo data was not calibrated for a realistic use case.

**What is missing:**
- Search/filter by user name or email. If a customer writes in to support, I want to type their email and see their issues instantly.
- Assignee field. I need to assign an issue to someone on my team.
- Notes/comments on issues. I need to track what we did about each issue.
- Export to CSV. My finance team will want a spreadsheet, not a dashboard.
- SLA tracking. How long has this issue been open? Is it getting stale?

**Actionability:**
- Good: Each issue has a clear description of what went wrong.
- Bad: No issue tells me what to DO about it. "Payment of $1554.38/mo succeeded but entitlement state is inactive. This is likely a webhook processing failure or state machine bug." OK, so... do I fix it in Stripe? In my app? How? A "Suggested fix" or "Next step" would make this dramatically more useful.

---

### 3. Issue Detail (/issues/:id)

**First impression:** Clean. I can see the severity, status, description, and evidence. The "AI Investigation" placeholder is promising but currently empty.

**What is confusing or unclear:**
- The "Evidence" section shows raw JSON field names like `adjustedImpact: 155438`, `lastPaymentAmount: 13078`. These are in cents, right? But they are displayed as raw integers with no currency formatting. Meanwhile the header shows "$1,554.38". The evidence section feels like a developer debug view, not a business user view.
- `Detector: payment_without_entitlement` -- this is an internal code name. Means nothing to me. Either hide it or translate it.
- "Updated 2 days ago" but "Detected 5 hours ago" -- how was it updated before it was detected? This is likely a data issue but it is confusing.
- The "Affected User" shows a truncated UUID ("67f0831e-a339-40...") instead of the user's name or email. I do not care about UUIDs. Show me "Ava Kim (ava.kim@email.com)" so I can look them up in Stripe.

**What would make me lose trust:**
- "AI Investigation: AI-powered root cause analysis will be available here once enabled for your account." This feels like a bait-and-switch. The section is prominently displayed and takes up significant screen real estate advertising a feature that does not work. Either ship it or do not show it. Showing an empty placeholder on every single issue page makes the product feel incomplete.

**What is missing:**
- A link to the user's Stripe customer page (or Apple Connect page). If I am going to fix this, I need to go to the source system.
- Activity log / audit trail. Who acknowledged this? When? What did they do?
- Similar/related issues for this user. You show "No related issues found" but earlier the user profile showed the user has issues. The cross-referencing seems incomplete.
- "Resolve" should ask for a resolution note. Why was it resolved? What was the fix?

---

### 4. Users (/users)

**First impression:** Bare. This is essentially a phone book of subscribers. The primary identifier is a Stripe customer ID (`cus_NMioLYo0XRZvJy`), which is meaningless to me.

**What is confusing or unclear:**
- The "User" column shows Stripe customer IDs as the primary name, with a truncated UUID below. Neither of these means anything to a revenue ops person. Show me the person's actual name, then email, then external IDs as secondary info.
- "Issues" column says "Clear" for every visible user. "Clear" means... no issues? Then why is this page useful? I have 500 users and zero of the visible ones have issues. Sort by users WITH issues first.
- No indication of subscription status, plan tier, or MRR per user. This table lacks the context I need to prioritize.

**What would make me lose trust:**
- 500 users but I have 50,000 subscribers. If this tool only tracks a fraction of my user base, the revenue impact numbers are unreliable.

**What is missing:**
- Filter/sort by: has open issues, subscription status, billing platform, MRR.
- User names (not just emails and IDs).
- Subscription plan and amount visible in the table without clicking into each user.
- Bulk export.

---

### 5. User Profile (/users/:id)

**First impression:** Better than the list page. I can see the subscription status, event timeline, and billing events. The timeline view is helpful.

**What is confusing or unclear:**
- Inconsistent currency symbols in the event timeline: one event shows "GBP 39.99," another "EUR 39.99," another "$39.99" -- all for the same user. Is this one user paying in three different currencies? Or is this a display bug? Either way, it is alarming.
- The subscription section shows `sub_L6sPP9llUWrHbw` but not the product name (e.g., "FitTrack Pro Annual"). Subscription IDs are developer artifacts.

**What is missing:**
- Lifetime revenue for this user.
- Current plan name and price.
- Link back to issues affecting this user.
- Deep link to this user in Stripe/Apple.

---

### 6. Events (/events)

**First impression:** A raw event feed. This is useful for debugging but not for daily revenue ops work.

**What is confusing or unclear:**
- Mixed currencies without normalization: $19.99, GBP 79.99, EUR 9.99 all in the same feed. No indication of which currency is which beyond the symbol. Totals or aggregations would be meaningless.
- "100 events loaded" -- out of how many total? No total count, no date range, no way to know what I am looking at.

**What would make me lose trust:**
- Events showing amounts in different currencies for the same apparent product tier feels like data quality issues.

**What is missing:**
- Date range filter.
- Search by user.
- Event type filter (show me just refunds, just cancellations).
- The page has source tabs (Stripe, Apple, Google) which is good, but no way to combine filters (e.g., Apple + refund).

---

### 7. Alerts (/alerts)

**First impression:** Empty. No alert channels configured is expected for a new account. The form to add Slack/Email is clean and straightforward.

**What is missing:**
- Preview of what alert messages look like before I configure them. I want to see a sample Slack message so I know what my team will receive.
- Threshold configuration. I do not want a Slack notification for every $2.99 trial non-conversion. Let me set a minimum revenue impact threshold.
- Digest option. Instead of individual alerts, let me get a daily summary.
- PagerDuty/Opsgenie integration. For critical revenue issues, I want escalation to on-call.

---

### 8. Insights (/insights)

**First impression:** Disappointing. The page is 60% placeholder content for AI features that do not work yet. The "Enable AI-Powered Analysis" banner takes prime screen position for something that is unavailable.

**What is confusing or unclear:**
- "Overall TP Rate: 0%", "Actioned: 0" -- these metrics make the tool look broken. In reality, nobody has resolved/dismissed any issues yet so there is no data. But "0% True Positive Rate" sounds like the tool has zero accuracy. This is a terrible first impression. Either hide this section until there is data or change the empty state messaging.
- The Detector Accuracy table shows internal detector code names like `trial_no_conversion`, `payment_without_entitlement`, `cross_platform_mismatch`. These should be the user-facing names from the Monitors page.
- "Resolved: 0" is shown in green for every detector. Green usually means good. But zero resolved is not good -- it means I have not taken action on anything. The color is misleading.

**What would make me lose trust:**
- The entire "AI Insights" section feels like marketing vaporware pasted into the product. It occupies a main nav slot but delivers almost nothing. The three "insights" (Critical issue spike +200%, $6407 revenue at risk +295%, Issue volume increased +100%) are just reformatted dashboard stats, not actual insights.

**What is missing:**
- Real insights. Something like: "Your webhook failure rate from Apple increased 3x this week. This correlates with 8 new payment-not-provisioned issues. Investigate your Apple Server Notifications V2 configuration." THAT is an insight.
- Recommendations tied to actions.
- Trend charts showing issue volume over time.

---

### 9. Monitors (/monitors)

**First impression:** This is actually the most useful page in the app for understanding WHAT RevBack does. It clearly explains each detector type, shows which ones are active, and links to filtered issue views. This should be more prominent or integrated into the main flow.

**What is confusing or unclear:**
- This page is not in the main navigation. I only found it by trying /monitors in the URL bar. It should be accessible from the sidebar.
- "Unlock Verified Detection - 2 additional detectors available with SDK integration" -- good upsell, but what exactly does the SDK do? The "Set Up SDK" link goes to /connect-app which is also hidden from nav.

**What is missing:**
- Ability to enable/disable individual detectors. Maybe I do not care about "Trial Not Converted" and want to turn it off to reduce noise.
- Severity threshold configuration per detector.
- Schedule/frequency settings. How often does each detector run?

---

### 10. Setup / Onboarding (/setup)

**First impression:** Clean onboarding flow. The progressive steps (Get Started, Connect Billing, Import & Discover, Your First Look) are clear. The "Your First Look" summary with top issues and revenue at risk is a strong hook.

**What is confusing or unclear:**
- "Import complete -- 0 events processed" but the dashboard shows 5,000 events. Which is it?
- Direct URL navigation to /setup shows a raw JSON error (`{"error":"Missing or invalid Authorization header"}`). This is a critical bug. If someone bookmarks the setup page or shares the URL, they see a broken page instead of the app.

**What would make me lose trust:**
- The hard crash on direct URL navigation to /setup is a showstopper for a demo. If I am showing this to my VP and navigate to /setup directly, I get a raw error.

---

### 11. Connect App (/connect-app)

**First impression:** Well done. Code snippets in 4 languages (Node, Python, Swift, Kotlin) with copy buttons. The "Real-time vs Batch" toggle is smart. "App Integration Active" badge is reassuring.

**What is confusing or unclear:**
- Code snippets use `http://localhost:5173` as the API endpoint. In production this needs to be the real API URL. This is a demo issue but still jarring.
- "Send Test Check" button is good. Does it actually work in the demo?

---

## Prioritized Feedback Summary

### CRITICAL (Would prevent me from using this tool)

1. **Revenue impact numbers appear fabricated or uncalibrated.** $1,554/mo "at risk" for a single user on what looks like a standard subscription makes no sense. If I cannot trust the dollar amounts, I cannot justify this tool to my VP. The revenue impact calculation must be transparent and verifiable against my Stripe data.

2. **No actionable next steps on issues.** The tool tells me WHAT is wrong but never tells me HOW to fix it. "Payment succeeded but entitlement is inactive" -- OK, what do I do? Link me to the Stripe subscription. Tell me to check my webhook endpoint. Give me a one-click "grant access" button. Without actions, this is just an expensive alert system.

3. **Setup page crashes on direct URL navigation.** `/setup` returns raw JSON error `{"error":"Missing or invalid Authorization header"}` when accessed directly instead of via SPA navigation. Any page in the app should handle direct URL access gracefully.

4. **Sidebar badge count (3) does not match actual issue count (36).** This is a fundamental data integrity issue. If the most prominent number in the UI is wrong, nothing else can be trusted.

5. **No way to group/deduplicate systemic issues.** 8 separate "Payment Not Provisioned" issues that are clearly the same root cause (webhook failure) appear as 8 individual items. I need to see patterns, not a firehose of individual alerts. Without grouping, a real production system with 50K subscribers would generate hundreds of uncorrelated issues.

### IMPORTANT (Would frustrate me weekly)

6. **Users are identified by UUIDs and Stripe customer IDs, not names/emails.** Throughout the app, the primary identifier is a technical ID. Show me "Jennifer Adams (jennifer@email.com)" not "621f158a-5fb6-4e...". Revenue ops teams think in people, not database keys.

7. **No issue assignment, comments, or workflow tracking.** I cannot assign an issue to my billing engineer, leave a note about what we tried, or track resolution over time. This means I would need a separate project management tool alongside RevBack, which defeats the purpose.

8. **AI Investigation placeholder on every issue page is distracting vaporware.** The empty "Root Cause Analysis" section takes up prime real estate advertising a feature that does not exist. Either ship it or remove it. Showing it on every single issue makes the product feel 60% finished.

9. **Mixed currencies displayed without normalization or context.** Events and user profiles show amounts in USD, GBP, and EUR without explanation. Revenue impact totals presumably mix currencies. This makes the aggregate numbers unreliable.

10. **Trial Not Converted issues mixed with critical revenue issues.** A $6.67 trial non-conversion appearing alongside a $1,483 unrevoked refund dilutes urgency. These are fundamentally different issue categories. Let me disable low-value detectors or at least filter them out of my default view.

11. **No date range controls anywhere.** Dashboard, Issues, Events -- none of them let me specify a time window. Am I looking at this week? This month? All time? Time-based filtering is essential for weekly review meetings.

12. **Monitors page is hidden from navigation.** The best explanation of what RevBack actually does is on /monitors, but it is not linked from the sidebar. The page clearly explains each detector with plain-language descriptions. This content should be more discoverable.

### NICE TO HAVE (Polish items)

13. **Insight cards are just reformatted dashboard numbers.** "Critical issue spike detected +200%" is not an insight -- it is a metric. Real insights would correlate patterns and suggest causes. Until the AI features ship, consider removing the "AI Insights" label and just calling it "Trends."

14. **Detector code names leak into the UI.** `payment_without_entitlement`, `refund_not_revoked`, `trial_no_conversion` appear in issue details and the Insights table. Use human-readable names consistently.

15. **Evidence section on issue detail shows raw cents as integers.** `adjustedImpact: 155438` and `lastPaymentAmount: 13078` should be formatted as currency ($1,554.38 and $130.78) or at minimum labeled as "cents."

16. **No deep links to source billing systems.** When viewing a Stripe-sourced issue, there should be a "View in Stripe" button that opens the customer or subscription in the Stripe Dashboard.

17. **"Revenue Saved: $0" empty state is demoralizing.** For a new account that has not resolved anything yet, showing $0 saved with a red/neutral treatment feels like failure. Change the empty state to something encouraging like "Resolve your first issue to start tracking savings."

18. **Events page lacks filters.** No date range, no event type filter, no user search. The page is currently a raw feed that is only useful for debugging.

19. **User list default sort is unhelpful.** Shows all 500 users sorted by creation date. Users with open issues should surface first, or at least provide a filter for "has issues."

20. **"Subscription Guard" tagline below the logo is vague.** "Billing issue detection" or "Revenue leak detection" would be clearer about what the tool does.

---

## Bottom Line

RevBack has a compelling core concept: detect billing correctness issues across platforms and quantify the revenue impact. The detection categories (paid-no-access, unrevoked refunds, webhook gaps, cross-platform conflicts) directly map to real problems my team has encountered.

However, the tool is currently a **detection system without a resolution workflow**. It tells me what is wrong but provides no guidance on how to fix it, no way to assign work, no way to track progress, and no integration with the systems where I would actually fix the issues. It is like a smoke detector with no fire extinguisher and no way to call 911.

The revenue impact numbers -- the core value proposition -- feel unreliable in the demo. If the first number a customer sees feels wrong, every subsequent number is suspect. This needs to be the highest-fidelity data in the entire product.

**Would I recommend a trial?** Conditionally yes, IF:
1. The revenue impact calculation is explained and verifiable
2. There is at least a basic issue assignment and resolution workflow
3. Systemic issues are grouped rather than exploded into individual alerts
4. The broken /setup URL is fixed

**Would I pay for this today?** Not yet. The detection is interesting but the actionability gap is too large. My team would spend more time managing RevBack issues than fixing billing problems.
