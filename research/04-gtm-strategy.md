# GTM Strategy: Ideal First Customer & Go-to-Market Playbook

**Date:** 2026-02-09
**Status:** Complete
**Premise:** Billing correctness platform ("Sentry for payments") launching with Stripe + Apple IAP. The product detects entitlement mismatches, surfaces revenue leaks, and quantifies dollar impact across billing systems.

---

## 1. Ideal First Customer Profile

### The Target: Mid-Market Mobile-First Companies with Web Billing

| Attribute | Target Range | Why |
|-----------|-------------|-----|
| **ARR** | $5M-$50M | Large enough to have real billing pain (thousands of subscribers), small enough that they don't have a 10-person billing infrastructure team. Revenue leakage of 3-5% = $150K-$2.5M/year. That makes your product a no-brainer ROI. |
| **Total employees** | 50-500 | Big enough to have dedicated engineering, small enough that billing infrastructure competes with product work for eng cycles. |
| **Engineering team** | 15-80 engineers | Has built custom billing logic but hasn't staffed a dedicated billing team. Billing code is owned by 1-3 engineers who'd rather be working on product. |
| **Billing stack** | Apple IAP + Stripe (web) | Phase 1 integration scope. Many mobile-first companies use Apple IAP for iOS, then add Stripe for web subscriptions to avoid the 30% commission. This is the exact cross-platform mismatch zone. |
| **Subscriber count** | 50K-500K active subscribers | Enough volume that manual reconciliation is impossible, but not so large that they've already built Kafka-scale internal tooling. |
| **Business model** | Consumer subscription (B2C) or prosumer | Not enterprise B2B (those companies have different billing stacks). Think: fitness, health, productivity, media, dating, education, creative tools. |

### Billing Complexity Indicators

The ideal first customer has at least 3 of these:

1. **Bills through Apple IAP AND Stripe.** They offer subscriptions via the App Store and also sell directly on the web (increasingly common post-Epic v. Apple ruling, which since April 2025 lets US iOS apps link to web checkout).
2. **Has multiple subscription tiers or products.** Not just one price point — they have monthly/annual, free trial, and possibly family plans.
3. **Has experienced billing-related support tickets.** "I paid but can't access premium" is in their support queue. This is the clearest buying signal.
4. **Has engineers who've written custom Apple receipt validation code.** They know the pain firsthand.
5. **Has had a billing incident in the past 12 months.** A spike in failed renewals, a webhook outage, a reconciliation gap they discovered manually.

### Pain Level Indicators (How to Identify Them)

| Signal | Where to Find It | Strength |
|--------|------------------|----------|
| Support tickets about billing/access issues | Ask during discovery; check App Store reviews for "paid but..." | Strong |
| Engineers posting about Apple IAP issues | Apple Developer Forums, Stack Overflow, Hacker News | Strong |
| App Store reviews mentioning billing problems | App Store / Google Play review text | Medium |
| They use RevenueCat but also have Stripe | RevenueCat case studies + Stripe references in job postings | Strong |
| Job posting for "billing engineer" or "payments engineer" | LinkedIn, company careers page | Very Strong |
| They recently added web billing alongside mobile | Blog posts, changelog, pricing page changes | Strong |

### Industry/Vertical Focus (Ranked by Fit)

1. **Health & fitness apps** (Noom, Calm, Headspace, Flo Health, MyFitnessPal) — Large subscriber bases, cross-platform, high churn sensitivity, subscription is core revenue model.
2. **Productivity & creative tools** (VSCO, Notion, Canva, Bear, Craft) — Cross-platform, prosumer pricing, engineering-led.
3. **Education & language** (Duolingo, Babbel, Coursera) — Massive subscriber bases, multiple platforms, high trial-to-paid conversion pressure.
4. **Media & entertainment** (Mubi, Crunchyroll, smaller streaming services) — Subscription-first, cross-platform.
5. **Dating apps** (Bumble, Hinge, Coffee Meets Bagel) — IAP-heavy, multiple subscription tiers, high involuntary churn.

### Specific Companies to Target

**Tier 1 — High fit, reachable, likely in pain:**

| Company | Why | Est. ARR | Billing Stack (Estimated) |
|---------|-----|----------|--------------------------|
| **VSCO** | Known RevenueCat user. Publicly documented that they lacked eng capacity to keep up with Apple billing changes. Cross-platform (iOS, Android, web). | $30-50M | Apple IAP + likely Stripe (web) |
| **Calm** | $120M+ revenue, 4M+ paying subscribers. iOS + web subscriptions. At this scale, even 1% leakage = $1.2M/year. | $100M+ | Apple IAP + web billing |
| **Flo Health** | 60M+ MAU, subscription-based. iOS + Android + web. Health vertical = high retention sensitivity. | $50-100M | Apple IAP + Google Play + web |
| **Strava** | 120M users, subscription pivot. iOS + Android + web. Known to have complex subscription tiers. | $250M+ | Apple IAP + Google Play + Stripe |
| **Noom** | $400M+ revenue, massive subscriber base. iOS + web. Known billing complexity (trials, coaching tiers). | $400M+ | Apple IAP + Stripe |

**Tier 2 — Good fit, slightly harder to reach:**

| Company | Why |
|---------|-----|
| **Headspace** | $86M consumer spending. iOS + web + B2B. Multiple billing paths. |
| **Mubi** | Niche streaming. iOS + web + TV. Subscription-only model. |
| **Babbel** | Language learning. Cross-platform. Web + mobile subscriptions. |
| **Bear (Shiny Frog)** | Small team, Apple-first, recently added cross-platform sync subscriptions. |
| **Craft** | Productivity app. iOS + Mac + web subscriptions. Small eng team. |

**Tier 3 — Stretch targets (larger, but massive pain if you can get in):**

| Company | Why |
|---------|-----|
| **Duolingo** | 40% Year 1 retention. Massive scale. Would be incredible social proof. |
| **Bumble** | IAP-heavy, multiple subscription tiers, public company with revenue pressure. |
| **Tinder (Match Group)** | Largest IAP spender globally. Complex cross-platform billing. |

### Who is the Buyer?

| Role | Title Variants | Budget | Likelihood of Being First Contact |
|------|---------------|--------|----------------------------------|
| **VP/Head of Engineering** | VP Eng, CTO (at smaller cos), Head of Platform | Engineering budget or "tools" budget | High — they feel the pain of maintaining billing code |
| **Head of Revenue/Growth** | VP Growth, Head of Monetization, Revenue Ops Lead | Growth/monetization budget | Medium — they see the revenue impact but may not own tooling decisions |
| **Head of Product** | VP Product, Director of Product (Monetization) | Product budget | Medium — they care about subscriber experience |
| **CFO/VP Finance** | CFO, VP Finance, Controller | Finance budget | Low first contact, but strong champion once dollar impact is shown |

**Primary buyer for first 5 customers: VP/Head of Engineering or CTO.**

At $5-50M ARR companies, the eng leader typically has authority to approve tools under $50K/year without a procurement process. They understand the technical pain, they can evaluate the integration, and they can champion internally.

### Who is the Champion?

The **senior backend engineer who owns billing code.** This person:
- Has personally debugged Apple webhook issues at 2am
- Has written (and hates maintaining) the reconciliation scripts
- Knows exactly how many hours per month billing issues consume
- Will evaluate your API docs, integration guide, and webhook handling before anyone else sees the product
- Will be your internal advocate if the integration is clean and the product surfaces real issues

**Find this person by:**
- Searching for engineers at target companies who have committed to Apple IAP or Stripe-related repos
- Looking for Stack Overflow / Apple Developer Forum posts from engineers at target companies
- Asking "who owns your billing infrastructure?" in discovery calls

### Trigger Events (When They Become Buyers)

1. **They just added web billing alongside mobile.** Now they have two billing systems and no reconciliation. This is the #1 trigger.
2. **Billing incident.** A cohort of users lost access, a webhook outage went undetected for days, a revenue reconciliation revealed a significant gap.
3. **Post-Epic v. Apple / DMA compliance.** Companies adding external payment links (Stripe) alongside IAP are suddenly managing dual billing for the first time.
4. **The billing engineer quit.** Institutional knowledge walks out the door. They now have a billing system nobody fully understands.
5. **Board/investor pressure on unit economics.** Involuntary churn is flagged as a top-3 metric to improve. They need to quantify and fix revenue leakage.
6. **Subscription pricing change.** They raised prices or changed tiers. Now they're worried about entitlement drift between old and new plans.

---

## 2. Integration Onboarding Strategy

### Design Principle

**The integration must be completable by one engineer in under 2 hours, and show dollar-value issues within 24 hours.**

If it takes longer, they will deprioritize it. If it doesn't show value fast, they'll forget about it.

### Minimum Viable Integration

**Option A: Webhook forwarding (recommended for fastest time-to-value)**

The customer adds your endpoint as a secondary webhook destination in Stripe and Apple. Zero code changes to their app.

```
Step 1: Customer adds your Stripe webhook URL in Stripe Dashboard
Step 2: Customer adds your Apple Server Notification URL in App Store Connect
Step 3: Customer provides their Stripe API key (read-only) for backfill
Step 4: Customer provides App Store Server API credentials for reconciliation
```

That's it. No SDK. No code deployment. No app update.

**Option B: Lightweight SDK (for identity mapping)**

If the customer wants cross-platform user correlation, they add a single API call:

```
POST /v1/identify
{
  "internal_user_id": "usr_123",
  "stripe_customer_id": "cus_abc",
  "apple_original_transaction_id": "1000000123"
}
```

This can be called from their existing backend. No mobile SDK needed.

**Absolutely do NOT require an SDK for Phase 1.** The whole point is that you work without replacing their billing infrastructure. RevenueCat requires an SDK. You don't. This is a key differentiator.

### Onboarding Timeline

#### Day 0: Sign-Up and Webhook Setup (30 minutes)

**Customer actions:**
1. Create account (email + password or SSO)
2. Connect Stripe (OAuth flow — click "Connect with Stripe," authorize read-only access)
3. Add Apple App Store Server Notification URL (copy-paste URL into App Store Connect)
4. Provide App Store Connect API key (follow step-by-step guide to generate)

**Your system actions:**
- Verify Stripe webhook connectivity (send test event)
- Verify Apple notification URL is reachable
- Begin Stripe historical data import via API (up to 2 years of subscription data)
- Queue Apple transaction history import

**What can go wrong and how to preempt it:**

| Blocker | Preemption |
|---------|-----------|
| Customer doesn't have admin access to Stripe | Provide a minimal permissions guide. Stripe read-only access only requires `Payment Intents: Read`, `Subscriptions: Read`, `Customers: Read`. Give them the exact permission list to request from their Stripe admin. |
| Customer doesn't know where Apple notification URL goes | Screenshot walkthrough: App Store Connect > App > App Store Server Notifications > Production Server URL. Provide video if needed. |
| App Store Connect API key generation is confusing | Step-by-step guide with screenshots. Emphasize: this is the "App Store Server API" key, NOT the "App Store Connect API" key (they're different and this confuses everyone). |
| Customer's existing webhook endpoint is the only Apple notification URL (Apple only allows one) | Provide a webhook proxy/forwarder. Your system receives the notification, forwards it to their existing endpoint, and also processes it. This is a critical feature — if you can't solve this, you lose 50%+ of prospects who already have Apple webhooks configured. |
| Firewall/network restrictions on outbound webhooks | Provide IP allowlist for their security team. Document all domains and ports. |

#### Day 1: Historical Import Complete, First Issues Surface (within 24 hours)

**Your system actions:**
- Complete Stripe historical import
- Complete Apple transaction history import (this may take longer for large apps — Apple's API can be slow)
- Run initial entitlement reconciliation across all imported data
- Generate first issue report

**The "aha moment":**
Customer opens dashboard and sees:

```
Issues Detected: 47
Estimated Revenue at Risk: $23,400/month

Critical (12):
- 8 users paid but have no active entitlement
- 4 chargebacks with entitlement still active

Warning (35):
- 23 subscriptions in billing retry > 14 days
- 12 stale subscriptions (no events in > billing period)
```

**This must happen within 24 hours of webhook setup.** If you don't show dollar-value issues fast, they'll context-switch and never come back.

#### Day 3: Review Call (30-minute scheduled call)

**Agenda:**
1. Walk through the issue dashboard together (screen share)
2. Validate 3-5 specific issues against their internal data ("Is user X actually locked out?")
3. Confirm revenue impact estimates ("Does $23K/month sound directionally right?")
4. Set up alert routing (Slack channel, email, PagerDuty)
5. Discuss identity mapping (do they want cross-platform user correlation?)

**Critical:** Validating specific issues builds trust. If even 2-3 issues are confirmed as real, the product sells itself. If the first issues are false positives, you lose credibility immediately. Prioritize precision over recall in early issue detection.

#### Day 7: Identity Mapping (if applicable)

If the customer bills through both Apple and Stripe and wants cross-platform correlation:
- Provide the `/identify` API endpoint
- Help them write a one-time backfill script (pull user table, match Stripe customer IDs and Apple transaction IDs, POST to your API)
- This unlocks the highest-value detectors: "User X paid on Apple but Stripe shows expired" and "User Y has duplicate active subscriptions across platforms"

#### Day 14: Steady State

- All webhooks flowing in real-time
- Historical data imported and reconciled
- Issue detection running continuously
- Alerts configured (Slack, email, or PagerDuty)
- (Optional) Identity mapping complete for cross-platform correlation
- Customer has a clear picture of their billing health

**Success criteria at day 14:**
- Customer has resolved at least 3 issues surfaced by the product
- Customer can quantify dollars recovered or protected
- At least 2 people at the company check the dashboard (not just the engineer who set it up)
- Customer agrees to a case study or quote (even informal)

### Historical Data Import Strategy

**Stripe:** Use the Stripe API to pull all subscription, invoice, charge, and refund objects. Stripe retains data indefinitely and has good pagination. Import the last 12-24 months. This is the easy one.

**Apple:** Use the App Store Server API's "Get Transaction History" endpoint. This returns JWS-signed transactions for all users. Caveats:
- Rate limits (~300 requests/minute undocumented limit)
- Can be slow for large apps (hours for 100K+ users)
- Import in batches, show progressive results in the dashboard
- Clearly communicate to the customer: "Historical import is running. Initial results available now; full results in X hours."

**Do NOT block onboarding on historical import completion.** Show real-time webhook data immediately. Historical data enriches the picture but shouldn't gate the "aha moment."

### Common Enterprise Onboarding Blockers

| Blocker | Likelihood | How to Preempt |
|---------|-----------|----------------|
| **Security review / vendor assessment** | High (almost certain for $20M+ ARR companies) | Have a pre-filled security questionnaire ready (CAIQ or SIG Lite). Publish a security page on your website. Get SOC 2 Type I as soon as you can afford it ($10-50K, 2-3 months). Until then, provide: architecture diagram showing data flow, encryption details, data retention policy, and your DPA. |
| **Legal review of DPA/ToS** | High | Have a standard DPA ready. Use a template based on SCCs (Standard Contractual Clauses). Keep it simple. The faster legal can review, the faster the deal closes. |
| **Apple notification URL conflict** | High | Build the webhook proxy/forwarder from day 1. This is a must-have, not a nice-to-have. |
| **Stripe API key concerns** | Medium | Request only read-only permissions. Explain exactly what you access and what you don't. Offer to use Stripe Connect (OAuth) instead of raw API keys. |
| **Data residency requirements** | Medium (EU companies, healthcare) | For Phase 1, deploy in US-East. For EU customers, be prepared to spin up an EU region. Document your data residency options clearly. |
| **IT/InfoSec approval process** | Medium | Provide a one-page "architecture overview for InfoSec" document: what data flows where, what's encrypted, what's logged, retention periods. |
| **"We need to run this by the team"** | High | Provide a shareable one-pager with ROI calculation. Give the champion ammunition to sell internally. |
| **Internal prioritization ("billing project" competes with product work)** | Very High | This is why the webhook-only integration is critical. "It's 30 minutes of setup, no code deployment, no sprint planning required." Remove every possible reason to deprioritize. |

### Security & Compliance Requirements

**What to have ready at launch:**

| Requirement | Status Needed | Timeline |
|-------------|--------------|----------|
| **Encryption at rest** | Required | Launch |
| **Encryption in transit (TLS)** | Required | Launch |
| **Webhook signature verification** | Required | Launch |
| **API key authentication** | Required | Launch |
| **Audit logging** | Required | Launch |
| **Data Processing Agreement (DPA)** | Required | Launch |
| **Privacy policy** | Required | Launch |
| **SOC 2 Type I** | Should have | Within 3-6 months of launch |
| **SOC 2 Type II** | Nice to have | Within 12 months of launch |
| **GDPR compliance documentation** | Should have | Launch (if targeting EU) |
| **HIPAA BAA** | Nice to have | Only if targeting health apps as primary vertical |

**SOC 2 strategy:** Use a compliance automation platform (Vanta, Drata, Secureframe) to accelerate. Type I can be achieved in 2-3 months. Cost: $10-50K. This unblocks enterprise deals and should be prioritized as soon as first revenue comes in.

**Practical advice:** For your first 3-5 customers, a detailed security questionnaire response + DPA + architecture diagram will be sufficient. Most $5-30M ARR companies don't hard-require SOC 2 for a read-only monitoring tool. They'll want to see that you take security seriously. $50M+ ARR companies will require SOC 2 Type I minimum.

### Internal Approval Process at the Customer

**Typical approval chain for a <$50K/year tool:**

1. **Champion (billing engineer)** evaluates technical fit, runs the integration
2. **Engineering manager** approves tool spend (this is often the same person as the VP Eng at smaller companies)
3. **Finance/procurement** reviews contract (at larger companies)
4. **Security/IT** reviews vendor assessment (at larger companies)

**For your first 5 customers, target companies where steps 3 and 4 don't exist.** Companies with <200 employees typically let the VP Eng or CTO approve a tool at this price point without procurement. This dramatically shortens the sales cycle.

---

## 3. GTM Motion

### Phase 1 (First 10 Customers): Founder-Led Sales

**Not product-led. Not sales-led. Founder-led.**

Reasoning:
- You don't have product-market fit yet. You need tight feedback loops.
- You don't have enough signal to hire a salesperson. You'd be guessing at the pitch.
- Founder-led sales at a developer tools company looks a lot like developer relations. You're the best person to explain the product, debug integrations, and learn what resonates.
- Sentry, Datadog, and LaunchDarkly all started with founder-led sales before scaling.

**What founder-led sales looks like:**
- Personal outreach to 50-100 engineering leaders at target companies
- Demo calls where you screen-share and show them *their own data* (after a quick webhook setup)
- You personally help with integration during the trial
- You're on Slack with every early customer, responding in minutes
- You write the case studies yourself

### Phase 2 (Customers 10-50): Founder-Led + Product-Led Assist

Once you have 10 paying customers and validated messaging:
- Launch a self-serve free tier
- Content marketing (blog posts, technical guides)
- First sales hire (technical AE, not a traditional closer)

### Phase 3 (Customers 50+): Product-Led Growth with Sales Overlay

- Self-serve handles SMB/mid-market
- Sales team handles enterprise ($100K+ ACV)
- This is the Sentry/Datadog model

### Free Tier Strategy

**Offer a generous free tier, but gate the highest-value features.**

| Tier | Price | What's Included |
|------|-------|-----------------|
| **Free** | $0 | 1 billing source (Stripe OR Apple, not both). Up to 5,000 subscribers. Issue detection with 7-day history. Email alerts only. |
| **Pro** | $500-$1,500/month | Multiple billing sources. Unlimited subscribers. Full issue history. Slack/PagerDuty alerts. Revenue impact dashboard. Identity mapping API. |
| **Enterprise** | Custom ($2,000-$5,000+/month) | Everything in Pro. SSO/SAML. Dedicated support. Custom integrations. SLA. Data export API. |

**Why this free tier works:**
- Single-source monitoring is useful but doesn't solve the cross-platform problem. It gives engineers a taste of what the product does.
- 5,000 subscriber limit means small indie apps get full value for free (good for community/word-of-mouth), while any company with real revenue quickly needs to upgrade.
- 7-day history means they can see current issues but can't track trends. Upgrading unlocks "your billing health over time."

### Pricing Model

**Event-based pricing is too complex for Phase 1. Subscriber-based tiers are too unpredictable for the customer.**

**Recommended: Flat monthly pricing based on billing sources and subscriber tier.**

| Monthly Subscribers | Pro Price | Enterprise Price |
|--------------------|-----------|-----------------|
| Up to 25K | $500/mo | $2,000/mo |
| 25K-100K | $1,000/mo | $3,500/mo |
| 100K-500K | $1,500/mo | $5,000/mo |
| 500K+ | Custom | Custom |

**Why these numbers:**
- At $500/mo ($6K/year), the product needs to recover ~$6K in revenue leakage to break even for the customer. For a company with $5M ARR losing 3%, that's $150K/year in leakage. Your product pays for itself 25x over.
- At $1,500/mo ($18K/year) for a company with $20M ARR, the ROI math is even better. $600K-$1.4M in annual leakage vs. $18K tool cost.
- These price points keep you under the "procurement threshold" at most mid-market companies ($25-50K/year typically requires formal procurement).
- Annual commitment discount: 20% off (effectively 10 months for 12).

### Sales Cycle Expectations

| Company Size | Expected Cycle | Why |
|-------------|---------------|-----|
| $5-15M ARR (50-150 employees) | 2-4 weeks | Single decision-maker (VP Eng/CTO). No procurement. Quick security review. |
| $15-30M ARR (150-300 employees) | 4-8 weeks | May involve VP Eng + VP Finance. Light security review. |
| $30-50M ARR (300-500 employees) | 6-12 weeks | Procurement process. Security questionnaire. Legal review of DPA. |
| $50M+ ARR | 3-6 months | Full vendor assessment. SOC 2 required. Multiple stakeholders. |

**For first 10 customers, target the 2-4 week cycle companies.**

### Channels to Reach Target Customers

**Ranked by effectiveness for founder-led sales:**

1. **Personal network / warm intros (highest conversion).** LinkedIn connections, former colleagues, angel investor networks, YC network (if applicable). Every intro has 5-10x the conversion rate of cold outreach.

2. **Targeted cold outreach via LinkedIn.** Find the billing engineer or VP Eng at target companies. Send a personalized message referencing a specific pain point (e.g., "I saw your team posted about Apple webhook issues on the developer forums..."). Do NOT use templates. Do NOT use automated sequences. Personalization is everything at this stage.

3. **Hacker News / dev community posts.** Write a technical post about a genuine insight (e.g., "What we learned processing 1M Apple App Store notifications" or "The 7 ways Apple webhooks fail silently"). Show Traction on HN translates directly to inbound from engineering leaders.

4. **Apple Developer Forums / Stack Overflow.** Answer questions about Apple IAP issues. Link to your blog (not your product). Establish expertise.

5. **Twitter/X engineering community.** Engage with mobile billing discussions. Share insights, not pitches.

6. **Subscription industry conferences.** SubSummit (1,500+ attendees), Subscription Show. Not to get a booth — to network with 10-20 target companies in person.

7. **RevenueCat community.** Companies discussing RevenueCat limitations are your warmest leads. Engage genuinely, don't spam.

---

## 4. Positioning & Messaging

### One-Line Pitch

> "Defend every dollar."

Subtitle: "We watch your revenue so nothing slips through."

Alternatives for different contexts:
- Technical: "AI that finds revenue issues, explains them, and helps you fix them."
- Business: "We watch your revenue across every billing platform so nothing slips through."
- Sentry analogy: "Sentry for your revenue."

### Competitive Positioning Statement

> "RevenueCat manages your subscriptions. We monitor whether they're correct. Stripe processes your payments. We verify the money reached the right place. We're the observability layer your billing stack is missing."

### Top 3 Buyer Objections and How to Handle Them

**Objection 1: "We already use RevenueCat / we built our own reconciliation."**

> "RevenueCat tells you subscription state — it doesn't tell you when state is wrong. Their revenue data is explicitly 'best-effort' and doesn't align 1:1 with store reports. We cross-check what RevenueCat reports against what Apple and Stripe independently report. Most of our early customers use RevenueCat and still found $X/month in issues we surfaced that RevenueCat didn't."

> If they built their own reconciliation: "How often does it run? Daily? Weekly? What happens between runs? We process events in real-time and alert within minutes. And we detect issue classes your cron job probably doesn't check for — webhook delivery gaps, event sequence anomalies, extended billing retry zombies."

**Objection 2: "Our billing is fine. We don't have a revenue leakage problem."**

> "Every company with cross-platform subscriptions has some level of leakage — the industry average is 3-5% of revenue. Most companies don't know about it because they don't have tools to detect it. The setup takes 30 minutes and doesn't require any code changes. Let us run for 48 hours on your real data. If we don't find at least $X in issues, you walk away. No cost, no commitment."

This is the most important objection to handle. You overcome it by making the barrier to trial essentially zero.

**Objection 3: "We don't want to send our billing data to another vendor."**

> "We understand. We only need read-only access. We never modify subscriptions, process payments, or touch entitlements. We're read-only observability, like Datadog for your infrastructure. Here's our architecture diagram showing exactly what data flows where, how it's encrypted, and our data retention policy. We're happy to sign your DPA before we start."

> For companies that truly can't send data externally: "We're exploring a self-hosted option for enterprise. Let's discuss what that would look like for your security requirements." (Don't build this for Phase 1, but signal willingness for future.)

### Landing Page

**Headline:**
> Defend every dollar.

**Subheadline:**
> We watch your revenue so nothing slips through. AI that finds revenue issues across Stripe and Apple, explains them, and helps you fix them.

**Hero section layout:**
1. Headline + subheadline
2. "Connect in 30 minutes. See issues in 24 hours." (CTA: "Start Free")
3. Dashboard screenshot showing issue feed with dollar amounts
4. Three value props:
   - "Detect: Users who paid but lost access, active subscriptions with failed payments, cross-platform entitlement mismatches."
   - "Quantify: Every issue shows estimated revenue impact. Know exactly what's at stake."
   - "Resolve: User timelines show every event across every billing system. Debug in minutes, not hours."

**Social proof section (before you have customers):**
- Industry stats: "The average subscription company loses 3-5% of revenue to billing errors" (cite MGI Research, Deloitte)
- Problem validation: "Apple's webhook delivery is unreliable. Even Stripe recommends periodic reconciliation." (cite Apple Developer Forums, Stripe docs)
- Technical credibility: Open-source contributions, blog posts about billing system quirks, founder's background

### Social Proof Strategy (Pre-Customer)

Since you don't have customers yet, build credibility through:

1. **Technical content that demonstrates domain expertise.** Write 3-5 blog posts about real billing system pain points:
   - "The 7 ways Apple App Store webhooks fail silently"
   - "Why your Stripe reconciliation job is probably wrong"
   - "Cross-platform subscription billing: a field guide to everything that breaks"

2. **Open-source a useful utility.** A Stripe webhook verification library, an Apple JWS token decoder, or a subscription state machine reference implementation. This signals "we understand this domain deeply."

3. **Public benchmarks.** "We analyzed 1M Apple notifications and found X% had delivery delays > 1 hour." Original data is powerful social proof.

4. **Founder credibility.** LinkedIn profile, past roles, specific billing system experience. "Built by engineers who've managed billing at [notable company]."

5. **"Design partner" framing.** First 3-5 customers get the product free or heavily discounted in exchange for being named as design partners. Use their logos (with permission) and eventually co-author a case study.

---

## 5. First 90 Days Playbook

### Week 1-2: Foundation

**Goals:**
- Landing page live with clear positioning
- Webhook ingestion working for Stripe + Apple (this should already be built)
- Onboarding flow tested with synthetic data
- 3-5 blog posts drafted or published
- Target list of 50 companies built with specific contact names

**Actions:**
- [ ] Finalize landing page copy and ship it
- [ ] Write and publish first 2 technical blog posts
- [ ] Build the Apple webhook proxy/forwarder (critical for onboarding)
- [ ] Create the "30-minute onboarding" guide with screenshots
- [ ] Build the 50-company target list with:
  - Company name
  - Estimated ARR
  - Known billing stack
  - Target contact (name, title, LinkedIn)
  - Pain signal (if known)
- [ ] Draft the cold outreach message (personalized template)
- [ ] Prepare security questionnaire responses
- [ ] Draft DPA

**Success metrics:**
- Landing page live with analytics tracking
- 2 blog posts published
- 50-company target list complete
- Outreach messages drafted

### Week 3-4: First Outreach & Design Partners

**Goals:**
- 30-50 personalized outreach messages sent
- 5-10 demo calls booked
- 2-3 companies in active trial (webhook connected)
- First issues surfaced on real customer data

**Actions:**
- [ ] Send personalized outreach to first 30 targets
- [ ] Post first technical blog post to Hacker News
- [ ] Share blog post in relevant Slack communities (RevenueCat, mobile dev, indie hackers)
- [ ] Run demo calls — show the product on real data when possible
- [ ] Onboard first 2-3 design partners (free, in exchange for feedback + case study commitment)
- [ ] Personally support each design partner through onboarding
- [ ] Validate issue detection accuracy against real data
- [ ] Iterate on issue detection based on false positive rates

**Success metrics:**
- 30+ outreach messages sent
- 5+ demo calls completed
- 2-3 companies actively trialing
- First real issues surfaced and validated
- False positive rate < 10% on P0 detectors

### Month 2: Validation & First Revenue

**Goals:**
- 3-5 paying customers (or committed design partners converting)
- Product refined based on real-world feedback
- First case study drafted
- SOC 2 Type I process started

**Actions:**
- [ ] Convert design partners to paid (or lock in commitments)
- [ ] Continue outreach (next 20-30 targets)
- [ ] Refine onboarding based on friction points from first customers
- [ ] Add Slack alert integration (high-demand feature)
- [ ] Write first case study: "How [Company] found $X/month in billing leakage"
- [ ] Start SOC 2 Type I process (sign up with Vanta/Drata, begin evidence collection)
- [ ] Analyze patterns across customers: what issue types are most common? Most valuable?
- [ ] Publish second wave of blog posts based on real data patterns

**Success metrics:**
- 3-5 paying customers or committed design partners
- $2K-$5K MRR
- Net Promoter Score > 40 from design partners
- First case study published (even if anonymized)
- SOC 2 Type I in progress

### Month 3: Scaling Signal

**Goals:**
- 8-12 paying customers
- Repeatable onboarding (any engineer can complete in < 2 hours without hand-holding)
- Clear pricing validated
- Pipeline of 20+ prospects
- Decision: ready for self-serve free tier?

**Actions:**
- [ ] Continue founder-led sales
- [ ] Launch "free tier" if onboarding is repeatable (otherwise defer)
- [ ] Publish 2 more case studies
- [ ] Apply to present at SubSummit or Subscription Show
- [ ] Evaluate hiring first technical AE
- [ ] Begin Google Play integration work (Phase 2)
- [ ] Analyze: what's the median time from webhook setup to "aha moment"? Optimize this relentlessly.
- [ ] Analyze: what's the most common reason prospects don't convert? Fix or address it.

**Success metrics:**
- 8-12 paying customers
- $10K-$20K MRR
- Onboarding completion rate > 80% (of companies that start, > 80% reach "aha moment")
- Sales cycle < 4 weeks for target segment
- At least 2 inbound leads per week from content/word-of-mouth
- Clear product-market fit signal: customers voluntarily refer others, or get upset when the product has downtime

### The "North Star" for the First 90 Days

**The single most important metric:** Number of companies where you've surfaced real, validated, dollar-quantified billing issues.

Not sign-ups. Not MRR. Not pipeline. Issues found and confirmed. If you nail this, everything else follows — because every company where you find real money is a customer, a case study, and a referral source.

---

## Appendix: Key Assumptions and Risks

| Assumption | Risk if Wrong | Mitigation |
|-----------|--------------|-----------|
| Companies with Stripe + Apple billing have detectable issues | If their billing is actually clean, product shows no value | Target companies with known pain signals (support tickets, forum posts). Run on real data before pitching. |
| VP Eng is the buyer at $5-50M ARR companies | If buying decisions are made elsewhere, sales cycle lengthens | Prepare materials for multiple buyer personas. Lead with engineering, expand to business stakeholders. |
| 30-minute integration is achievable | If Apple webhook proxy doesn't work reliably, or Stripe OAuth flow has issues, onboarding stalls | Test onboarding flow with 5 different companies before scaling outreach. Fix every friction point. |
| $500-1,500/month price point is right | If too low, you can't sustain. If too high, SMB won't pay. | Start with design partner discounts. Validate willingness to pay before committing to pricing page. |
| False positive rate is manageable | If issue detection generates too many false positives, customers lose trust | Launch with only P0 detectors. Require high confidence thresholds. Manually validate first 100 issues. |
