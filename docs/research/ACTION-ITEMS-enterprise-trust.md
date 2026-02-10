# Enterprise Data Trust: Consolidated Action Items

**Synthesized from 5 team analyses: Research, GTM, Product, BizDev, Revenue**
**Date:** 2026-02-09

---

## The Core Thesis (Validated)

Your concern is correct: enterprises WILL gate on data trust before buying RevBack. But the analysis reveals this is actually an **opportunity, not just a risk**. RevBack's read-only architecture gives us a stronger security story than most billing-adjacent tools. The gap is between our actual architecture (solid) and our ability to prove it (weak).

**The math:** ~$50K invested in security posture unlocks $300-600K in Year 1 revenue. 70% of our TAM ($5M+ ARR companies) will ask for SOC 2. 30% will hard-block without it.

---

## CRITICAL FINDINGS (Act Immediately)

### 3 Codebase Issues That Would Kill Enterprise Deals

These were found by the product team auditing the actual code:

1. **Stripe API keys stored in plaintext** (`src/api/onboarding.ts:195`) -- A database breach exposes every customer's Stripe key. This is a disqualifying finding in any security review.

2. **Security-info endpoint makes false claims** (`src/api/onboarding.ts:646-731`) -- Claims 90-day webhook retention, 2-year event retention, encryption, and GDPR compliance. None of it is implemented. This is worse than having no security page -- it's provably false.

3. **API key scopes exist in schema but are never enforced** (`src/middleware/auth.ts`) -- Any API key has full access to everything including admin routes. Enterprise buyers will test this.

---

## ACTION ITEMS BY PRIORITY

### P0: Before First Enterprise Conversation (Month 1-2, ~$15-20K)

| # | Action Item | Owner | Effort | Source |
|---|-----------|-------|--------|--------|
| 1 | **Encrypt billing credentials** -- AES-256-GCM for `billing_connections.credentials`. Stripe keys and Apple private keys in plaintext is a deal-killer. | Eng | 2-3 days | Product |
| 2 | **Fix false security claims** -- Either implement what security-info claims or remove the claims. Lying is worse than having nothing. | Eng | 1 day | Product |
| 3 | **Enforce API key scopes** -- Implement scope checking in auth middleware (read:issues, write:issues, admin:connections, admin:system). | Eng | 2-3 days | Product |
| 4 | **Add rate limiting** -- No rate limiting exists on any endpoint. Use Redis-backed limiter (already have Redis). | Eng | 1-2 days | Product |
| 5 | **Write security architecture page** -- Real technical doc: data flow diagram, what we access vs. store, encryption standards, access model. NOT "we take security seriously." | Founder | 2-3 days | GTM, BizDev |
| 6 | **Draft DPA template** -- Use Bonterms or have counsel review a standard template. Non-negotiable for any EU-touching customer. | Legal | $1-3K | Research |
| 7 | **Get cyber + E&O insurance** -- $1-2M coverage, ~$5-8K/year. Enterprise procurement will ask for certificate. | Ops | 1 week | Revenue |
| 8 | **Sign up for Vanta or Drata** -- Begin evidence collection immediately. ~$10K/year (startup pricing available). | Ops | 1-2 days | All teams |
| 9 | **Implement audit logging** -- Create `audit_logs` table. Log all write operations and data access. Enterprise compliance requirement. | Eng | 3-4 days | Product |
| 10 | **Sanitize raw webhook payloads** -- Strip PII (customer emails, names, addresses) from `rawPayload` before storage. | Eng | 2-3 days | Product |

**Subtotal: ~4 weeks of engineering + ~$15-20K in external costs**

### P1: Before Closing First Enterprise Deal (Month 2-4, ~$25-40K)

| # | Action Item | Owner | Effort | Source |
|---|-----------|-------|--------|--------|
| 11 | **Implement Stripe Connect OAuth** -- Eliminates the "share your API key" objection entirely. Stripe handles auth, tokens are revocable and scoped. | Eng | 3-5 days | Product, GTM |
| 12 | **Complete SOC 2 Type I** -- With Vanta/Drata, 4-6 weeks from kickoff. $10-25K for audit. This single action unblocks 70% of TAM. | Ops + Eng | 4-6 weeks | Revenue, Research |
| 13 | **Pre-fill SIG Lite questionnaire** -- ~150 questions, most common framework enterprises send. Having it ready saves 2-4 weeks per deal. | Founder | 2-3 days | BizDev |
| 14 | **Commission penetration test** -- Third-party pen test ($5-15K). Share executive summary with prospects. Signals proactive security posture. | Ops | 2-3 weeks | Research, BizDev |
| 15 | **Create CISO briefing deck** -- 10 slides max: architecture, data flow, permissions, encryption, compliance status. Lead with read-only access. | Founder | 1-2 days | BizDev |
| 16 | **Launch Trust Center** -- Vanta Trust Center or SafeBase. Self-service portal for SOC 2 report, DPA, architecture docs. Deflects 50% of manual security requests. | Ops | 1-2 days | GTM, BizDev |
| 17 | **Implement right-to-delete API** -- `DELETE /api/v1/users/:userId` with cascading anonymization. GDPR legal requirement. | Eng | 2-3 days | Product |
| 18 | **Implement claimed retention policies** -- Auto-delete webhook logs after 90 days, redact raw payloads after 2 years. Daily BullMQ job. | Eng | 2-3 days | Product |
| 19 | **Encrypt user emails** -- Deterministic encryption (HMAC-based) allowing exact-match lookups while protecting PII at rest. | Eng | 1-2 days | Product |
| 20 | **Add HSTS header** -- Half-day effort, high signal to security reviewers. | Eng | 0.5 day | Product |

### P2: Enterprise Scale (Month 4-12, ~$50-100K)

| # | Action Item | Owner | Effort | Source |
|---|-----------|-------|--------|--------|
| 21 | **SOC 2 Type II** -- Begin observation period immediately after Type I. 6-month minimum. $15-20K for audit. | Ops | 6+ months | Revenue |
| 22 | **SSO support (SAML/OIDC)** -- Use WorkOS or Clerk. Enterprise customers with >5 team members will require this. | Eng | 2-3 weeks | Product, BizDev |
| 23 | **User accounts for dashboard** -- Replace API-key-only auth with user login, team invites, roles (Owner/Admin/Viewer). | Eng | 4-6 weeks | Product |
| 24 | **EU data residency option** -- Deploy full stack in eu-west-1 for EU customers. Hard GDPR requirement for large EU enterprises. | Eng | 3-4 weeks | Product |
| 25 | **Stripe App Marketplace listing** -- Pre-validates security via Stripe. "Verified Stripe Partner" badge. OAuth eliminates key sharing entirely. | Eng | 2-3 months | GTM |
| 26 | **AWS Marketplace listing** -- Enterprise procurement has pre-approved budgets for marketplace purchases. Implies security review. | Ops | 1-2 months | GTM |
| 27 | **Bug bounty program** -- Private program via HackerOne or Bugcrowd. Signals maturity. | Ops | Ongoing | Research |
| 28 | **ISO 27001** -- International standard, opens European enterprise deals. $30-100K. | Ops | 6-12 months | Research |

---

## GTM: WHAT TO SAY (AND NOT SAY)

### The Three Sentences That Win Security Conversations

1. "We use read-only API keys. We literally cannot modify your billing data."
2. "We never see payment credentials. Stripe tokenizes before data reaches us."
3. "If RevBack were compromised tomorrow, the attacker gets subscription metadata -- not payment methods, not customer PII, and zero ability to change anything in your billing system."

### Do Say
- "Read-only access to your billing systems"
- "We see subscription events, not payment credentials"
- "Data minimization by design"
- "We act as a data processor, you remain the controller"

### Don't Say
- "We take security seriously" (everyone says this; show, don't tell)
- "Military-grade encryption" (cliche, erodes trust)
- "We ingest all your billing data" (sounds invasive)
- "We're just a startup, we'll get to security later" (instant credibility loss)
- "We use Stripe, so we're PCI compliant" (not how PCI works)

---

## ENTERPRISE SALES PLAYBOOK (Quick Reference)

### Stakeholder Map

| Who | What They Care About | Give Them |
|-----|---------------------|-----------|
| VP Eng / CTO (Champion) | Does it work? Easy to integrate? | Free audit results, API docs |
| CISO (Gatekeeper) | Data handling, blast radius | Security whitepaper, architecture diagram |
| Legal | Liability, data processing | DPA, MSA, privacy policy |
| Procurement | Vendor assessment, budget | SOC 2 report, insurance cert, W-9 |
| CFO (Budget Holder) | ROI | Audit results with dollar amounts |

### Typical Timeline
```
Week 1-2:   Champion discovers problem -> Free audit
Week 2-4:   Technical evaluation -> POC
Week 3-6:   Security review (run in parallel with legal)
Week 4-8:   Legal review -> DPA + MSA
Week 6-10:  Procurement -> Budget approval
Week 8-12:  Contract signed
```

### Top 5 Objections and Rebuttals

1. **"Why share billing data with a startup?"** -> "You already share it with Stripe, your analytics tools, your data warehouse. We're one more read-only consumer -- but we're the only one finding revenue leaks."

2. **"We need SOC 2 Type II."** -> "Here's our Type I. Type II observation period is underway. We can start with sandbox data while it completes."

3. **"Our CISO won't approve this."** -> "Can we get 15 minutes with your security team? Once they see the read-only architecture, concerns drop significantly."

4. **"We can build this internally."** -> "Cross-platform detection with identity resolution across Stripe, Apple, and Google is 6-12 engineer-months plus ongoing maintenance. We've already built it."

5. **"What if you go out of business?"** -> "Your data lives in Stripe/Apple/Google. We're a read-only consumer. If RevBack disappears, your billing data is exactly where it always was."

---

## BUDGET SUMMARY

| Phase | Timeline | Investment | Revenue Unlocked |
|-------|----------|-----------|-----------------|
| Foundation | Month 1-2 | $15-20K | First enterprise conversations |
| SOC 2 Type I | Month 2-4 | $25-40K | 70% of enterprise TAM |
| SOC 2 Type II | Month 4-12 | $15-20K | Security-conscious enterprises, finserv |
| Enterprise features | Month 6-18 | $50-100K | Fortune 500, regulated industries |
| **Total Year 1** | | **~$50-65K** | **$300-600K in enabled revenue** |

**ROI: 5-10x. The first enterprise deal closed pays for the entire security investment 3-5x over.**

---

## COMPETITIVE CONTEXT

- **No direct competitor exists** in billing correctness
- RevenueCat has SOC 2 Type II, Trust Center, public DPA, pre-filled CAIQ/SIG
- Chargebee has ISO 27001, SOC 1 & 2 Type II, PCI DSS Level 1
- Stripe is the gold standard: PCI Level 1, SOC 1/2/3, zero-trust, bug bounty
- **Our advantage:** We only need read-only access. Our blast radius is near-zero. This is a fundamentally stronger security story than platforms that run billing.
- **Our gap:** We have none of the compliance artifacts to prove it yet

---

## DETAILED REPORTS

All five team analyses are available in `docs/research/`:

1. `enterprise-security-research.md` -- Compliance landscape, questionnaire frameworks, competitor security postures
2. `gtm-trust-strategy.md` -- Messaging framework, trust signals, landing page design, content strategy, channel strategy
3. `product-security-requirements.md` -- Codebase audit, encryption/RBAC/retention requirements, platform permission scopes, prioritized roadmap
4. `bizdev-security-playbook.md` -- Objection handling, stakeholder map, security whitepaper template, questionnaire workflow, partnership opportunities, enterprise-readiness timeline
5. `revenue-security-analysis.md` -- ROI analysis, pricing power, TAM by compliance requirement, investor perspective, budget allocation
