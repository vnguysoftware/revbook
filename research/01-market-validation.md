# Market Validation: Subscription Billing Correctness & Revenue Integrity

**Date:** 2026-02-09
**Status:** Initial research complete
**Confidence level:** Moderate-high. The problem is real and well-documented. The market size is large. The gap in tooling is genuine. But the go-to-market path has risks. Details below.

---

## 1. The Subscription Economy: Size and Growth

### Market Size

- The global subscription economy was estimated at **$492 billion in 2024**, projected to reach **$556 billion in 2025** and **$1.5-2.1 trillion by 2033-2035** depending on which analyst you believe (CAGR 13-16%).
- North America accounts for **38.2%** of the market.
- The subscription billing management software market alone is projected to reach **$37.36 billion by 2035** (Astute Analytica).

### Mobile App Subscriptions Specifically

- Global consumer spending on subscription apps is projected to exceed **$190 billion in 2025**.
- Subscription revenue across iOS and Google Play reached **$79.5 billion in 2025**, with iOS responsible for **73%**.
- **96% of mobile app spending** now comes from subscriptions (not one-time purchases). This is a staggering concentration.
- The App Store alone is projected to hit **$185 billion annually** (21% CAGR).

### What This Means for the Product

The addressable market is enormous. Even if you only serve the top 1% of subscription app businesses (by revenue), you're looking at tens of thousands of companies managing meaningful recurring revenue. The problem this product solves scales with every dollar of subscription revenue being managed.

**Sources:**
- [Juniper Research - Subscription Economy Market Report 2025-30](https://www.juniperresearch.com/research/fintech-payments/ecommerce/subscription-economy-market-report/)
- [Market.us - Subscription Economy Market Size](https://market.us/report/subscription-economy-market/)
- [Zuora - Subscription Economy Index 2025](https://www.zuora.com/resource/subscription-economy-index/)
- [Business of Apps - App Revenue Data 2026](https://www.businessofapps.com/data/app-revenues/)
- [Nami ML - 7 Numbers to Know About the Global Subscription Economy](https://www.namiml.com/blog/7-numbers-global-subscription-economy)

---

## 2. Known Pain Points: The Billing Nightmare is Real

### Apple App Store Server Notifications

This is the single most-cited source of pain in mobile subscription billing:

- **Notifications are delayed, occasionally dropped, and versioned in painful ways.** This is documented across hundreds of Apple Developer Forum threads.
- **Missing notifications:** Developers report never receiving "SUBSCRIBED" events for some users. Some notifications simply don't exist on Apple's servers.
- **Incomplete coverage:** When a transaction is cancelled, declined, or pending (Ask to Buy, authorization pending), no webhook is sent. Only "purchased" status events come through.
- **Sandbox unreliability:** Sandbox purchase notifications frequently aren't sent or logged, even when test notifications work fine.
- **Duplicate notifications:** Apple sometimes sends the same notification multiple times despite receiving proper HTTP 200 responses.
- **Transient network failures:** Apple acknowledges that servers may "occasionally miss notifications outside of outages due to transient network issues" with no guaranteed delivery window.

Apple has partially addressed this with the "onlyFailures" field for recovering missed notifications and the App Store Server API, but developers must supplement webhooks with polling and periodic full reconciliation. This is exactly the gap the product would fill.

**Sources:**
- [Apple Developer Forums - Server Notifications Not Received](https://developer.apple.com/forums/thread/727711)
- [Apple Developer Forums - V2 Notification Issues](https://developer.apple.com/forums/thread/756151)
- [Apple Developer Forums - Sandbox Issues](https://developer.apple.com/forums/thread/806130)

### Google Play Billing

Google Play is better than Apple but has its own edge cases:

- **Unacknowledged purchases:** The most common edge case is `ITEM_ALREADY_OWNED` -- a previous purchase wasn't properly acknowledged, putting it in a "limbo state" where the user was charged but the purchase wasn't confirmed. If the user tries to buy again, they get blocked.
- **Subscription downgrades** behave differently than expected (deferred to next renewal, not immediate).
- **Pending transactions** require explicit opt-in and handling.
- **90-day data limit:** Play Store APIs don't allow retrieval of subscription data older than 90 days, making historical reconciliation difficult.
- **Grace periods and paused subscriptions** add state complexity that many implementations don't handle correctly.

**Sources:**
- [RevenueCat - Handling Edge Cases in Google Play Billing](https://www.revenuecat.com/blog/engineering/google-play-edge-cases/)
- [RevenueCat - Google Play Subscription Lifecycle Guide](https://www.revenuecat.com/blog/engineering/google-play-lifecycle/)

### Stripe Webhook Reliability

Even Stripe, the gold standard of developer-friendly payments, has issues:

- Stripe automatically retries failed webhooks for **up to 3 days**, then **disables the endpoint** and sends a notification. Any events missed after that are gone unless you reconcile.
- Raw body access, character encoding, and clock skew issues cause legitimate webhooks to fail signature verification.
- At scale, Stripe's own documentation recommends shifting to a **queue-based architecture** with DLQs, plus **periodic reconciliation jobs** to catch missed events.
- The Stripe CLI has known issues with not receiving all events (GitHub issue #600).

**Sources:**
- [Stripe Support - Troubleshooting Webhook Delivery](https://support.stripe.com/questions/troubleshooting-webhook-delivery-issues)
- [Stripe Docs - Process Undelivered Webhook Events](https://docs.stripe.com/webhooks/process-undelivered-events)
- [GitHub - Stripe CLI Issue #600](https://github.com/stripe/stripe-cli/issues/600)

### Cross-Platform Reconciliation

The compounding problem: when you have subscriptions across Apple, Google, and web/Stripe, you get:

- **Different event schemas** from every platform
- **Different definitions** of the same concept (e.g., Google counts free trials as "active subscribers," RevenueCat does not)
- **Apple doesn't provide transaction prices** directly -- they must be inferred
- **No universal user identity** -- you're mapping Apple `original_transaction_id`, Google `purchase_token`, Stripe `customer_id`, and your own internal user ID
- **Timing mismatches** -- an Apple renewal can appear hours before or after the equivalent event would surface in your own system

**Sources:**
- [RevenueCat - How to Get Cross-Platform Subscriptions Right](https://www.revenuecat.com/blog/engineering/cross-platform-subscriptions-ios-android-web/)
- [Recurly - App Management](https://recurly.com/product/app-management/)

### The Engineering Perspective

Lago's widely-shared blog post ["Why billing systems are a nightmare for engineers"](https://www.getlago.com/blog/why-billing-systems-are-a-nightmare-for-engineers) (also discussed on Hacker News) captures the community sentiment: billing is an iceberg problem. The visible part (charge a card) is simple. The hidden 90% (edge cases, reconciliation, idempotency, timezone handling, proration, refunds, chargebacks, grace periods, platform-specific quirks) is where companies bleed money and engineering time.

As Pleo's Product Billing Infrastructure Lead put it: "Billing systems are hard to build, hard to design, and hard to get working for you if you deviate from 'the standard' even by a tiny bit."

---

## 3. The Cost of Getting It Wrong

### Revenue Leakage

- **MGI Research:** Around **half of companies** experience revenue leakage, typically **3-7% of top-line revenue** annually. For a company with $50M ARR, that's $1.5M-$3.5M per year.
- **Deloitte:** Documented firms losing **3-4% of revenue** across tens of thousands of transactions due to misaligned billing and contracts.
- **Extreme cases:** Some organizations reported leakage of **15-20% of operating income** due to data drops and wrongly applied rules.
- **Failed payment example:** 10% of payments failing in January due to card expiries, with weak retry logic resulting in 40% never recovering -- **$500K ARR gone** on a single cohort.

### Involuntary Churn

This is the silent killer:

- **$129 billion** projected lost to involuntary churn in 2025 across the subscription industry (Recurly).
- **70% of involuntary churn** stems from failed transactions -- customers who never intended to leave.
- Involuntary churn accounts for **20-40% of total customer churn**.
- **62% of users** who hit a payment error never return.
- **25% of lapsed subscriptions** are due to payment failures.
- Fixing involuntary churn alone can **lift revenue by 8.6% in year one** for B2B SaaS.

### Support Costs

While I couldn't find a single definitive stat on support costs from billing errors, the pattern is clear from forum discussions and engineering blogs:
- Billing-related support tickets are among the most expensive to resolve (they require cross-referencing multiple systems, often involve refunds or credits, and carry high customer emotion).
- Companies routinely report that "billing issues" are a top-3 category in their support queues.
- Each billing error that reaches a customer typically requires 15-30 minutes of engineer + support time to investigate and resolve.

**Sources:**
- [Younium - What Is Revenue Leakage](https://www.younium.com/blog/revenue-leakage)
- [Recurly - Failed Payments Could Cost $129B in 2025](https://recurly.com/press/failed-payments-could-cost-subscription-companies-more-than-129-billion-in-2025-us/)
- [Churnkey - State of Retention 2025](https://churnkey.co/reports/state-of-retention-2025)
- [DigitalRoute - 5 Ways Subscription Businesses Leak Revenue](https://www.digitalroute.com/blog/5-ways-subscription-businesses-leak-revenue/)

---

## 4. Current Solutions: How Companies Handle This Today

### Option A: RevenueCat (The Closest Existing Solution)

RevenueCat is the most direct comparison. It normalizes subscription data across Apple, Google, and Stripe. But it has meaningful limitations:

**What RevenueCat does well:**
- Cross-platform subscription SDK
- Real-time event streaming
- Paywall management and A/B testing
- Decent analytics dashboard

**Where RevenueCat falls short (and where the product opportunity lies):**
- **Revenue data is "best-effort."** RevenueCat infers prices based on original purchase price. If you change prices in App Store Connect or Google Play, revenue data diverges. Data doesn't align 1:1 with store reports.
- **Webhook limitations:** Max 5 webhooks per project. Single webhook URL can only be used once. Webhooks don't fire in correct order (Cancel before First Purchase events observed).
- **No deep reconciliation.** RevenueCat tells you what it knows, but it doesn't cross-check against what Apple/Google/Stripe independently report. It doesn't detect entitlement drift.
- **No issue detection.** It's a data layer, not a correctness layer. It won't tell you "user X paid but doesn't have access" or "your Apple data and Stripe data disagree."
- **Paywall localization bugs.** Always uses device locale, ignoring in-app language preferences.
- **Rate limits.** 480 calls/minute on Currency API -- insufficient for large user bases.
- **Pricing:** RevenueCat takes a percentage of revenue above $2.5K/month MTR, which gets expensive at scale.

**Sources:**
- [RevenueCat Community - Billing Error Problems](https://community.revenuecat.com/general-questions-7/why-are-there-so-many-billing-error-problems-4292)
- [RevenueCat Community - Webhook Limitations](https://community.revenuecat.com/third-party-integrations-53/webhook-limitations-how-to-handle-webhooks-for-multi-environment-setup-6983)
- [RevenueCat Community - Rate Limit Too Low](https://community.revenuecat.com/general-questions-7/rate-limit-too-low-7090)

### Option B: Other Subscription Management Platforms

**Adapty, Qonversion, Nami ML:** These are RevenueCat alternatives with similar capabilities (SDK wrappers, paywall testing, analytics). None of them focus on billing correctness or reconciliation. They're competing on paywall optimization and analytics, not error detection.

**Chargebee / Recurly / Zuora / Maxio:** These are B2B subscription billing platforms. They manage the billing itself (invoicing, dunning, revenue recognition) but they:
- Don't natively handle Apple/Google IAP reconciliation
- Don't detect entitlement mismatches
- Don't cross-reference multiple billing sources against each other
- Are focused on being the billing system, not auditing the billing system

Recurly has an "App Management" feature that syncs App Store and Google Play data, but it's designed for unified reporting, not correctness verification.

**Stripe Revenue Recognition** has an Apple App Store connector for importing subscription data, but it's focused on revenue recognition accounting, not real-time entitlement correctness.

### Option C: Custom Internal Tools

This is what most mid-to-large companies actually do:
- Build internal reconciliation scripts (often running as cron jobs)
- Manually investigate discrepancies
- Rely on customer complaints to find issues
- Run periodic audits

The Lago team described painful memories of building Qonto's internal billing system. Multiple engineering blog posts describe teams spending months building and maintaining custom reconciliation tooling.

### Option D: Nothing

Many companies, especially smaller ones, simply don't reconcile. They trust that Apple/Google/Stripe are correct, handle support tickets reactively, and accept some level of revenue leakage as a cost of doing business.

---

## 5. Market Signals

### Hiring Trends

- **"Billing Transformation" projects** are now a top-three CIO priority, driven by regulatory requirements (EU VAT rules for digital services) and operational complexity.
- Companies like Qualcomm are hiring **"Quote-to-Cash Systems Engineers"** to manage end-to-end subscription billing processes.
- GitLab has a dedicated **Billing Operations** job family within Finance.
- BillingPlatform is aggressively hiring, reflecting broader industry expansion.
- The gap between "we bought billing software" and "we have the expertise to run it correctly" is driving a talent shortage.

### Conference Activity

- **Subscription Show** (by Subscription Insider): Annual event in Jersey City, NJ. Attracts CXOs and VPs responsible for "billions in recurring revenue." Covers payments, billing, analytics, and CX.
- **SubSummit:** 1,500+ attendees in 2025, 100+ speakers. Dedicated vendor sessions for billing and payments tooling.
- **Recurring Revenue Conference:** Dedicated to SaaS recurring revenue topics.
- **SaaStr Annual:** 10,000+ attendees. While broader than billing, billing infrastructure is a recurring topic.

### Investor Interest

- Zuora was acquired by Silver Lake and GIC for **$1.7 billion** (completed early 2025). ARR was ~$420M.
- RevenueCat has raised **$56.5M** in total funding as of its last disclosed round.
- Chargebee reached unicorn status ($3.5B valuation) in its 2022 Series G round.
- The subscription billing management software market is projected to reach **$37.36 billion by 2035**.

---

## 6. Gap Analysis: What's Actually Missing

| Capability | RevenueCat | Chargebee/Recurly | Stripe | This Product |
|---|---|---|---|---|
| Cross-platform event normalization | Yes (SDK-dependent) | Partial | No | Yes (webhook + polling) |
| Real-time entitlement state | Yes | No (billing-focused) | No | Yes |
| Entitlement correctness verification | **No** | **No** | **No** | **Yes** |
| Issue detection ("paid but no access") | **No** | **No** | **No** | **Yes** |
| Cross-system reconciliation | **No** | **No** | **No** | **Yes** |
| Revenue impact quantification | **No** | **No** | **No** | **Yes** |
| Apple notification gap detection | **No** | N/A | N/A | **Yes** |
| Works without SDK integration | No (SDK required) | Yes | Yes | **Yes** |

The clear gap: **nobody is doing billing correctness as a product.** Everyone is either (a) being the billing system, (b) wrapping the billing system in a nicer SDK, or (c) doing analytics on top of billing data. Nobody is asking "is your billing data actually correct?" and "do your entitlements match reality?"

---

## 7. Honest Assessment: Risks and Red Flags

### Risk 1: RevenueCat Could Add This
RevenueCat already has the data pipeline. Adding issue detection on top would be a natural extension. Their engineering team is strong. If this product gains traction, RevenueCat could ship a "Billing Health" feature within 6-12 months. **Mitigation:** Move fast, go deeper than RevenueCat would as a feature (not their core business), and target companies that don't use RevenueCat's SDK.

### Risk 2: "Nice to Have" vs. "Must Have"
Many companies tolerate 3-5% revenue leakage because they don't know about it, and discovering it requires effort. The product needs to demonstrate value within days, not weeks. If onboarding is slow, companies will deprioritize it. **Mitigation:** The first integration must surface dollar-value issues immediately. "You're losing $X/month" is a powerful message.

### Risk 3: Integration Complexity
The product's value depends on ingesting data from multiple sources. Each integration is a maintenance burden. Apple's APIs change regularly. Google's billing library has version-specific behaviors. Stripe's event schema evolves. **Mitigation:** Start narrow (Stripe + Apple only, as the plan suggests). Don't try to boil the ocean.

### Risk 4: Identity Resolution is Hard
Cross-platform user identity mapping is the single hardest technical problem. Without solving it, you can't say "User X has an active Apple subscription AND an active Stripe subscription." Many companies don't have clean user ID mapping across platforms. **Mitigation:** Provide multiple identity resolution methods (SDK, API, CSV import) and be transparent about confidence levels.

### Risk 5: Sales Cycle and Buyer
The buyer isn't obvious. Engineering? Finance? Product? Revenue Ops? Different companies organize differently. This could lead to long sales cycles and unclear budgets. **Mitigation:** Start with engineering-led adoption (like Sentry), then expand to business stakeholders once value is proven.

### Risk 6: Data Sensitivity
You're handling payment and subscription data. Companies will have security and compliance concerns. SOC 2, data residency, and privacy requirements could slow enterprise adoption. **Mitigation:** Plan for SOC 2 early. Consider whether a self-hosted or hybrid deployment model makes sense for enterprise.

---

## 8. Bottom Line

### The problem is real
Revenue leakage from billing system mismatches is well-documented, expensive (3-7% of revenue is the consensus range), and currently solved with manual processes or not at all.

### The market is large
Subscription revenue exceeds $500B globally. Mobile subscriptions alone are $190B+. Even capturing a tiny slice of the "billing correctness" budget for these companies represents a meaningful business.

### The timing is right
- Subscription models are becoming more complex (hybrid pricing, cross-platform, usage-based add-ons)
- Apple and Google continue to change their billing APIs and requirements
- The shift to server-side validation (StoreKit 2, Google Play Billing Library 7.x) creates new categories of integration bugs
- Companies are hiring for billing operations roles, indicating they recognize the problem

### The gap is genuine
Nobody is selling "billing correctness as a service." RevenueCat is the closest, but it's a data/SDK layer, not a verification layer. Chargebee/Recurly/Zuora are billing systems, not billing auditors.

### But execution matters enormously
The product needs to:
1. Show dollar-value issues within the first week of integration
2. Require minimal integration effort (webhook forwarding, not SDK replacement)
3. Start with 2 platforms max (Stripe + Apple)
4. Solve identity resolution or scope to single-platform correctness first
5. Build trust through transparency (show your work, explain every issue, avoid false positives)

### Comparable exits / valuations for calibration
- Zuora: $1.7B acquisition (2025)
- Chargebee: $3.5B peak valuation
- RevenueCat: $56.5M+ raised, growing fast
- Subscription billing management software market: $37B by 2035

This is a market where billion-dollar companies exist. A focused tool that does correctness verification well could carve out a $50-500M niche within it.
