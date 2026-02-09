# Developer Community Content

---

## 1. Show HN Post

**Title:** Show HN: RevBack -- Defend every dollar of your subscription revenue

We built RevBack to watch your revenue so nothing slips through. It finds issues, explains why, and helps you fix them.

We run a subscription app on Stripe + Apple IAP. Our billing alerting was decent -- we'd get notified when a user paid but lost access, or when a refund wasn't revoked. But every alert still meant someone had to drop what they were doing, pull up logs, check entitlement state across platforms, figure out if other users were affected, and trace back to a root cause. It was the same 45-minute investigation every time.

So we added an AI investigation layer. When RevBack detects a billing issue, it automatically gathers context -- the last 50 events for that user, all their entitlements, their cross-platform identity graph, related and similar issues from the past 24 hours -- and sends it to Claude (Anthropic's API) for analysis. The AI returns a root cause, impact assessment, fix recommendation, confidence score, and full reasoning chain.

The second piece is temporal clustering. When 15 "payment-without-entitlement" issues fire in 2 hours, they're probably the same incident. The grouper detects these clusters in 4-hour windows by issue type, and for clusters of 5+, generates an incident title like "Apple Webhook Outage -- 23 users affected" with a unified root cause.

Architecture for those curious:

- TypeScript + Hono backend, Drizzle ORM on Postgres
- BullMQ job queue for async AI work (rate-limited to 10 jobs/min, 2 concurrent)
- Anthropic Claude SDK for investigation and grouping
- Bayesian confidence adjustment from operator feedback (mark issues as real/false positive, model updates)
- Daily/weekly AI-enhanced health intelligence reports
- Graceful degradation: everything works without an ANTHROPIC_API_KEY. AI features just become unavailable. The detection, normalization, and state machine run independently.

Detectors we ship: payment-without-entitlement, entitlement-without-payment, refund-not-revoked, webhook-delivery-gap, cross-platform-mismatch, silent-renewal-failure, trial-no-conversion.

Setup: point your billing webhooks at RevBack, connect Stripe/Apple API keys read-only, backfill gives immediate results. ~30 minutes.

We'd love feedback from anyone who's dealt with billing correctness at scale -- especially on the AI investigation approach.

GitHub: [link]
Docs: [link]

---

## 2. Blog Post: Defend Every Dollar — Why Subscription Revenue Needs a Watchdog

### Defend Every Dollar — Why Subscription Revenue Needs a Watchdog

It's 3 PM on a Tuesday. Your billing alerting fires: "payment-without-entitlement" detected for user #48291. Then another. Then five more. By 4 PM, you have 15 alerts.

Your on-call engineer starts triaging. They pull up the first user's event history in Stripe. Check the entitlement table. Look at the webhook logs. Cross-reference with Apple's transaction history. After 20 minutes, they identify the pattern: Apple's Server Notifications stopped delivering around 1 PM. Renewals happened on Apple's side, but your server never got the events, so entitlements expired.

They check the next alert. Same root cause. And the next. Same thing. Three hours later, they've confirmed all 15 are the same incident, written up a postmortem, and manually fixed the affected users. The actual root cause identification took 20 minutes. The other 2 hours and 40 minutes were spent re-verifying the same conclusion across 14 more users.

This is the state of billing ops at most subscription companies. Detection works. Investigation doesn't scale.

#### The investigation bottleneck

Modern billing monitoring can tell you something is wrong. Paid user lost access -- alert. Refund processed but entitlement still active -- alert. Webhook delivery gap detected -- alert.

But each alert is just a signal. To act on it, someone needs to:

1. Pull the user's recent event timeline across all billing providers
2. Check their current entitlement state and history
3. Look at their identity graph (do they have accounts on multiple platforms?)
4. Determine if this is an isolated incident or part of a pattern
5. Identify the root cause
6. Estimate the blast radius
7. Recommend a fix

Steps 1-3 are mechanical data gathering. Steps 4-7 require judgment. And all seven steps get repeated for every single alert, even when 15 of them have the same root cause.

This is exactly the kind of work that AI is good at: synthesizing context from multiple data sources, identifying patterns, and generating structured analysis. Not replacing human judgment -- augmenting it so the on-call engineer isn't spending three hours on what should be a 20-minute investigation.

#### How AI investigation actually works

When RevBack detects an issue, the AI investigator kicks off automatically. Here's what happens under the hood:

**Context gathering.** The system pulls the last 50 billing events for the affected user, all their current entitlements, their cross-platform identity records (linking their Stripe customer ID to their Apple transaction ID to their email), any related issues (same user, recent timeframe), and similar issues (same type, past 24 hours). This is the same data a human investigator would pull up -- just assembled in seconds instead of minutes.

**Analysis.** The full context package goes to Claude (via Anthropic's SDK) with a structured prompt. The model returns:

- **Root cause:** "Apple App Store Server Notifications stopped delivering between 13:00-14:30 UTC. 15 users had renewals during this window that were processed on Apple's side but never received by the webhook endpoint."
- **Impact assessment:** Estimated revenue impact, number of affected users, severity classification.
- **Recommendation:** "Trigger a receipt re-validation for all users with Apple entitlements that expired in the past 4 hours. Implement polling-based reconciliation as a fallback for webhook gaps exceeding 2 hours."
- **Confidence score:** 0.92, based on evidence strength.
- **Reasoning chain:** Step-by-step explanation of how the conclusion was reached.

**Caching.** Investigations are cached for 24 hours. If the issue is updated (new evidence, state change), the cache is invalidated and the investigation re-runs with fresh context. This keeps costs predictable -- you're not burning API calls on static issues.

#### From alerts to incidents

The investigation is only half the story. The other half is realizing that 15 alerts are actually one incident.

RevBack's AI grouper runs temporal clustering: it looks for issues of the same type occurring within 4-hour windows. When a cluster hits 5+ issues, it generates an incident with an AI-written title and unified analysis. Those 15 "payment-without-entitlement" alerts become one incident: **"Apple Webhook Outage -- 15 users affected, renewals not received between 13:00-14:30 UTC."**

Your on-call engineer sees one incident instead of 15 alerts. The root cause is already identified. The affected users are already listed. The recommended fix is already written. Their job shifts from "investigate from scratch" to "review AI analysis and execute the fix."

#### The feedback loop

AI confidence isn't static. When your team marks an issue as a real positive or false positive, RevBack's learning system uses Bayesian updating to adjust confidence scores for similar issues going forward. An investigator that initially flags Apple webhook gaps at 0.85 confidence might adjust to 0.92 after your team confirms several in a row -- or drop to 0.60 if several turn out to be false positives caused by your own infrastructure.

This means the system gets meaningfully better the more your team uses it. Not in a vague "machine learning" way -- in a specific, auditable, mathematically grounded way.

#### The daily briefing

Beyond individual investigations, RevBack generates periodic health intelligence. Daily and weekly reports combine rule-based analysis (trend detection, anomaly flagging) with AI-enhanced interpretation. Instead of a dashboard full of charts, you get a briefing: "Involuntary churn increased 12% this week, driven by a spike in silent renewal failures on Apple. Recommend investigating Apple's notification reliability for your app."

This is the difference between a monitoring tool and an AI billing engineer. Monitoring tells you the numbers. An AI engineer tells you what the numbers mean and what to do about them.

#### Building for graceful degradation

One architectural decision we're particularly deliberate about: RevBack works without AI. If you never set an `ANTHROPIC_API_KEY`, every feature except the AI modules functions normally. Event normalization, state machine tracking, identity resolution, issue detection -- all of it runs independently.

The AI layer is additive. It makes the system dramatically more useful, but it doesn't make the core system dependent on a third-party API's availability. If Anthropic's API has an outage, your billing monitoring keeps running. The AI investigations just queue up and process when the API comes back.

We built the AI pipeline on BullMQ with rate limiting (10 jobs/minute, 2 concurrent) and exponential backoff. It's designed to be a steady, reliable background process -- not a synchronous dependency in your alerting path.

#### What this changes in practice

The difference isn't theoretical. It's the difference between:

**Without AI:** 15 alerts fire. Engineer spends 3 hours investigating. Writes a postmortem. Manually fixes affected users. Goes back to what they were working on, 3 hours behind.

**With AI investigation:** 15 alerts fire. AI investigates the first one in seconds, identifies the root cause. Grouper clusters all 15 into one incident. Engineer reviews the analysis, confirms it's correct, executes the recommended fix. Total time: 20 minutes.

That's not a marginal improvement. That's giving your team back the hours they currently spend on repetitive billing forensics.

Detection tells you something broke. Investigation tells you why, how bad it is, and what to do about it. That second part is where most teams are still doing everything manually.

It doesn't have to be that way.

---

## 3. Twitter/X Thread

**Tweet 1:**
Every subscription company has revenue slipping through the cracks.

The question is: do you know where, why, and how much?

That's the gap. Here's what it takes to defend every dollar (thread):

**Tweet 2:**
Alert: "payment-without-entitlement detected for user #48291"

What happens next at most companies:

1. Engineer pulls up Stripe events
2. Checks entitlement table
3. Cross-references Apple transaction history
4. Reads webhook logs
5. Forms a hypothesis
6. Checks 3 more users to confirm

Time: 45 minutes. Per alert.

**Tweet 3:**
Now multiply that by 15, because Apple's webhook notifications silently dropped for 90 minutes and 15 users renewed without your server knowing.

Your engineer spends 3 hours confirming the same root cause 15 times.

Detection scaled. Investigation didn't.

**Tweet 4:**
What if the investigation happened automatically?

Pull the user's last 50 events. Check entitlements across platforms. Look at their identity graph. Find similar issues from the past 24 hours. Analyze all of it.

That's context gathering -- the part AI is genuinely good at.

**Tweet 5:**
Now add pattern recognition across alerts.

15 "payment-without-entitlement" issues in a 2-hour window, all Apple-sourced? That's not 15 issues. That's 1 incident: "Apple Webhook Outage."

Temporal clustering + AI-generated incident summary. Your engineer sees 1 item, not 15.

**Tweet 6:**
The best part: the system learns.

Your team marks issues as real or false positives. Bayesian confidence updating adjusts future scoring.

Not vague "ML gets smarter." Specific, auditable probability adjustments based on your team's feedback.

**Tweet 7:**
This is what we built with RevBack -- an AI investigation layer for subscription billing.

Detects issues. Investigates root causes automatically. Clusters alerts into incidents. Learns from your feedback.

If you run subscriptions on Stripe + Apple, we'll audit your billing for free. DM me.
