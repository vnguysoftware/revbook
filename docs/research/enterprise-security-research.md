# Enterprise Data Security Expectations for Billing SaaS

## Context

RevBack asks $5M+ ARR SaaS companies to share their billing data -- Stripe API keys, Apple App Store credentials, webhook access. This document analyzes what enterprises expect from vendors who handle this level of sensitive data, what compliance certifications matter, and what "minimum viable trust" looks like for a seed-stage startup.

---

## 1. Compliance Certifications: Table Stakes vs. Differentiators

### Table Stakes (Required to Close Enterprise Deals)

| Certification | What It Proves | Timeline | Cost | Notes |
|---|---|---|---|---|
| **SOC 2 Type I** | Security controls are designed correctly (point-in-time snapshot) | 1-3 months | $20K-$40K | Entry point; 73% of enterprises require SOC 2 before onboarding vendors |
| **SOC 2 Type II** | Controls operate effectively over 3-12 months | 6-12 months after Type I | $40K-$80K | The real enterprise standard; Type I buys time but Type II is expected within 12-18 months |
| **GDPR Compliance** | EU data protection (data mapping, DPA, lawful basis, right to erasure) | 2-4 months | $5K-$15K (legal + tooling) | Required if any customer has EU users; table stakes for any billing SaaS |
| **CCPA/CPRA Compliance** | California consumer privacy | 1-2 months (overlaps GDPR) | Incremental | Often bundled with GDPR work |

### Strong Differentiators (Accelerate Enterprise Sales)

| Certification | What It Proves | Timeline | Cost | Notes |
|---|---|---|---|---|
| **ISO 27001** | Comprehensive ISMS (Information Security Management System) | 6-12 months | $30K-$100K | International gold standard; Chargebee holds ISO 27001:2022 |
| **PCI DSS** | Payment card data security | Varies by level | $15K-$100K+ | Critical if you ever touch card data; RevBack likely qualifies for SAQ A (redirect/iframe) since we use Stripe as processor |
| **SOC 1 Type II** | Financial reporting controls | 6-12 months | Similar to SOC 2 | Relevant because we touch billing/revenue data; Stripe and Chargebee both maintain SOC 1 |

### Nice-to-Have (Later Stage)

| Certification | When Needed |
|---|---|
| **HIPAA / BAA** | Only if targeting healthcare SaaS companies. Billing documents can be PHI. Requires BAA signing capability. Consider only if healthcare is a target vertical. |
| **FedRAMP** | Government sector only. Extremely expensive ($500K+). Ignore at seed stage. |
| **CBPR/PRP** | Cross-border privacy; Stripe has these. Not needed until significant APAC expansion. |
| **CSA STAR** | Cloud Security Alliance certification. Helpful for cloud-native positioning but not a deal requirement. |

### Recommendation for RevBack

**Phase 1 (Pre-revenue / Seed):** SOC 2 Type I + GDPR/CCPA compliance + DPA template
**Phase 2 (Post first 5 customers):** SOC 2 Type II (begin immediately after Type I)
**Phase 3 (Series A / $1M+ ARR):** ISO 27001 + evaluate PCI DSS scope

---

## 2. Security Questionnaires: What They Look Like and How Long They Take

### Common Questionnaire Frameworks

| Framework | Full Name | Questions | Typical Time to Complete | Who Sends It |
|---|---|---|---|---|
| **SIG Lite** | Standardized Information Gathering (Lite) | ~150 questions | 2-4 days (first time), 1 day (subsequent) | Mid-market companies ($10M-$100M ARR) |
| **SIG Core** | Standardized Information Gathering (Full) | ~800+ questions | 1-3 weeks (first time) | Enterprise ($100M+ ARR) |
| **CAIQ** | Consensus Assessments Initiative Questionnaire (CSA) | ~300 questions | 1-2 weeks | Cloud-focused enterprises |
| **VSA** | Vendor Security Alliance Questionnaire | ~75 questions | 1-2 days | Tech companies (common in SaaS-to-SaaS) |
| **Custom** | Company-specific questionnaire | 50-500+ questions | Varies widely | Larger enterprises often have proprietary forms |

### What Questionnaires Actually Ask

The questions cluster around these domains:

1. **Access Control:** SSO support, MFA enforcement, RBAC, privileged access management
2. **Data Protection:** Encryption (transit + rest), key management, data classification, tokenization
3. **Incident Response:** IR plan, breach notification timelines, forensics capability
4. **Business Continuity:** DR plan, RTO/RPO targets, backup frequency and testing
5. **Vendor Management:** Your own third-party risk program (who are YOUR vendors?)
6. **Vulnerability Management:** Pen testing frequency, patch management, bug bounty programs
7. **Employee Security:** Background checks, security training, offboarding procedures
8. **Logging & Monitoring:** Audit log retention, SIEM/alerting, 24/7 monitoring
9. **Compliance:** Which certifications you hold, audit reports available
10. **Data Lifecycle:** Retention policies, deletion procedures, data portability

### How RevenueCat Handles This

RevenueCat makes their completed questionnaires (CAIQ, SIG) available upon request through their sales team (sales@revenuecat.com). Their SOC 2 Type II report is available under NDA. This is the industry-standard approach: pre-fill common questionnaires and have them ready to share.

### Practical Advice for RevBack

- **Pre-fill SIG Lite and CAIQ** before your first enterprise prospect asks. Having it ready signals maturity.
- **Build a living "security FAQ" document** that maps to common questionnaire domains. This becomes your source of truth.
- **Expect 1-3 questionnaires per enterprise deal.** Budget 5-10 hours per questionnaire initially, dropping to 2-3 hours once you have templates.
- **Timeline impact on sales:** Security review adds 2-6 weeks to an enterprise deal cycle. Having materials ready can compress this to 1-2 weeks.

---

## 3. Data Handling Practices Enterprises Require

### Encryption

| Requirement | Enterprise Expectation | Industry Standard |
|---|---|---|
| **Data in Transit** | TLS 1.2+ mandatory, TLS 1.3 preferred | Stripe: HTTPS/TLS mandatory, mTLS for server-to-server |
| **Data at Rest** | AES-256 encryption | Stripe: AES-256 for PANs; RevenueCat: AES-128-CBC minimum |
| **Key Management** | Keys stored separately from encrypted data; regular rotation | Stripe: Decryption keys isolated from encrypted data stores |
| **API Key Security** | Customer API keys encrypted, never logged in plaintext | Stripe scans the internet proactively for leaked API keys |

### Data Residency & Sovereignty

- **US Default:** Most billing SaaS (RevenueCat, Stripe, Chargebee) process and store data in the US on AWS
- **EU Residency:** Increasingly requested by European customers. Stripe offers EU data residency. RevenueCat does not (yet).
- **Contractual Guarantees:** Enterprises want contractual commitments (not just "we happen to use us-east-1")
- **RevBack Consideration:** Since we run on AWS, we can offer region-specific deployments later. For now, document where data lives and ensure your DPA covers cross-border transfers (Standard Contractual Clauses).

### Data Retention & Deletion

- **Retention Policy:** Enterprises want a documented policy (e.g., "billing events retained for 24 months, then purged")
- **Right to Deletion:** GDPR Article 17 requires you to delete customer data on request within 30 days
- **Data Portability:** Ability to export all data in a machine-readable format (GDPR Article 20)
- **Backup Purging:** Deleted data must also be purged from backups within a reasonable timeframe (90 days is common)

### Data Processing Agreements (DPAs)

A DPA is **non-negotiable** for enterprise sales. It must cover:

- **Roles:** RevBack as data processor, customer as data controller
- **Sub-processors:** List all third-party services that touch customer data (AWS, Stripe, etc.)
- **Processing purposes:** Explicitly limited to providing the service
- **Data breach notification:** 72-hour notification timeline (GDPR requirement)
- **Audit rights:** Customer has the right to audit (usually satisfied by SOC 2 report)
- **International transfers:** Standard Contractual Clauses (SCCs) for EU-US data transfers

RevenueCat publishes their DPA publicly at revenuecat.com/dpa/ -- this is best practice and reduces sales friction.

### Infrastructure Security

| Requirement | What Enterprises Expect |
|---|---|
| **Cloud Provider** | AWS, GCP, or Azure (Tier 1 providers with their own SOC 2/ISO 27001) |
| **Network Isolation** | VPCs, private subnets, no public database access |
| **Multi-tenancy Isolation** | Data logically or physically separated per customer |
| **Backup & DR** | Daily encrypted backups, tested disaster recovery plan, documented RTO/RPO |
| **Monitoring** | 24/7 alerting, log aggregation, anomaly detection |
| **Patch Management** | Automated patching, EOL tracking for OS and dependencies |

---

## 4. How Billing-Adjacent Companies Communicate Security

### Stripe (Gold Standard)

**Trust Communication:** Stripe's security page (docs.stripe.com/security) is a masterclass in enterprise trust.

- **Certifications prominently listed:** PCI DSS Level 1, SOC 1 & 2 Type II (annual), SOC 3 (public), EMVCo Level 1 & 2, PA-DSS, NIST Cybersecurity Framework alignment, CBPR/PRP, US/UK/Swiss Data Privacy Framework
- **Technical depth:** Specific encryption standards (AES-256), TLS requirements (1.2+ minimum), mTLS for internal services, HSTS preloading
- **Zero-trust philosophy:** SSO + hardware 2FA + mTLS for employee access, quarterly access reviews
- **Proactive security:** Internet-wide API key scanning, GitHub Token Scanner integration, HackerOne bug bounty
- **Transparency:** Public SOC 3 report, dedicated security teams, immutable audit logs
- **Key lesson:** Stripe leads with specifics, not vague promises. They name encryption algorithms, describe key isolation, and explain their zero-trust architecture.

### RevenueCat (Direct Competitor Positioning)

**Trust Communication:** Dedicated /security-and-compliance/ page plus a Trust Center (soc2.revenuecat.com).

- **Certifications:** SOC 2 Type II (annual, available under NDA)
- **Pre-filled questionnaires:** CAIQ and SIG available upon request
- **Data protection:** AES-128-CBC encryption, HMAC-SHA256 authentication
- **Privacy compliance:** GDPR, UK GDPR, CCPA/CPRA, LGPD (Brazil)
- **DPA:** Published publicly at /dpa/
- **Infrastructure:** AWS, with automated alerting, log aggregation, 24/7 on-call
- **Vendor management:** All third-party providers undergo security/privacy review; critical vendors hold equivalent certifications
- **Key lesson:** RevenueCat makes trust artifacts easily accessible (public DPA, Trust Center URL, questionnaires on request). This reduces friction in enterprise sales cycles.

### Chargebee (Enterprise Billing Platform)

**Trust Communication:** Dedicated /security/ page with comprehensive certification display.

- **Certifications:** ISO 27001:2022, SOC 1 Type II, SOC 2 Type II, PCI DSS Level 1
- **BCP/DR:** Reviewed and audited as part of ISO 27001 and SOC 2
- **GDPR:** Dedicated documentation at /docs/2.0/eu-gdpr.html
- **Key lesson:** Chargebee stacks certifications -- four major ones (ISO 27001, SOC 1, SOC 2, PCI DSS). For a subscription billing platform, this breadth is expected and signals maturity. Their ISO 27001:2022 (latest revision) shows they keep certifications current.

### Recurly (Subscription Management)

- **Certifications:** PCI DSS Level 1 (as a payment processor), SOC 1 and SOC 2 Type II
- **Key lesson:** Payment-adjacent companies that touch card data always lead with PCI DSS.

### Patterns Across All Four

1. **Dedicated security page** -- not buried in docs, prominently linked from homepage/footer
2. **Certifications listed with specifics** -- "SOC 2 Type II" not just "SOC 2"
3. **Public-facing trust artifacts** -- at minimum a SOC 3 or Trust Center page
4. **DPA available without requiring sales call** -- reduces friction
5. **Infrastructure details** -- cloud provider, encryption standards, monitoring approach
6. **Third-party audit emphasis** -- "independently audited" builds more trust than self-attestation
7. **Proactive security posture** -- bug bounties, pen testing, vulnerability scanning

---

## 5. Minimum Viable Trust for a Seed-Stage Startup

### The "Good Enough to Start" Package

For RevBack to land its first 5-10 enterprise customers, here is the minimum trust package ranked by priority:

#### Tier 1: Must-Have Before First Enterprise Meeting (Cost: ~$5K-$15K, Time: 2-4 weeks)

1. **Security page on website** -- Dedicated /security page describing your practices, even before certifications
2. **DPA template** -- Standard data processing agreement ready to sign (use a template from Vanta or a privacy attorney; $1K-$3K)
3. **Privacy policy** -- GDPR/CCPA compliant, clearly describing data collection and processing
4. **Encryption in practice** -- TLS 1.2+ for transit, AES-256 at rest, documented key management
5. **Basic access controls** -- MFA enforced for all team members, principle of least privilege
6. **Incident response plan** -- Document what happens if there's a breach (even if it's simple)
7. **Sub-processor list** -- Public list of third-party services that touch customer data (AWS, Stripe, etc.)

#### Tier 2: Must-Have Before Closing First Enterprise Deal (Cost: ~$20K-$50K, Time: 2-4 months)

1. **SOC 2 Type I** -- Use Vanta ($10K/yr) or Drata ($7.5K/yr) for automation + auditor ($10K-$30K). A 12-person startup on AWS can be audit-ready in 3-4 months.
2. **Pre-filled SIG Lite questionnaire** -- Have answers ready for the ~150 most common security questions
3. **Trust Center page** -- Use Vanta's Trust Center or SafeBase to publish certifications, policies, and questionnaire responses in one place
4. **Penetration test report** -- At least one third-party pen test ($5K-$15K). Enterprise buyers want to see independent testing.
5. **SSO support for customer dashboard** -- SAML/OIDC support is increasingly a deal requirement, not a nice-to-have
6. **Audit logging** -- Immutable logs of all access to customer data, available for customer review

#### Tier 3: Within 12 Months of First Enterprise Revenue (Cost: ~$40K-$100K)

1. **SOC 2 Type II** -- Begin the observation period immediately after Type I
2. **Bug bounty or VDP** -- Vulnerability Disclosure Policy at minimum; HackerOne/Bugcrowd program ideal
3. **Regular pen testing cadence** -- Annual at minimum, quarterly for high-risk changes
4. **Employee security training** -- Documented program with completion tracking
5. **Vendor risk management** -- Formal process for evaluating your own third-party vendors

### The "Startup Bridge" Strategy

Before you have SOC 2, you can bridge the trust gap with:

- **Founder credibility:** If founders have enterprise security experience, lead with that
- **Cloud provider inheritance:** "We run on AWS, which is SOC 2 / ISO 27001 / PCI DSS certified" -- you inherit baseline controls
- **Transparency over certification:** Share your actual security practices in detail. A well-written security page can substitute for a SOC 2 report with early-stage-friendly buyers
- **Design-first security:** "We designed for SOC 2 from day one and are currently in the audit process" -- this works for 3-6 months
- **Customer references:** Even one enterprise customer who vouches for your security practices is powerful
- **Architecture diagrams:** Show how data flows, where it's encrypted, who can access it. Visual clarity builds confidence.

### SOC 2 Automation Platform Comparison

| Platform | Starting Price | Best For | Notes |
|---|---|---|---|
| **Vanta** | $10K/yr (Core) | All-in-one (audit + trust center) | Most popular; reduces audit time by 50%; trust center included |
| **Drata** | $7.5K/yr | Budget-conscious startups | Slightly cheaper; good automation |
| **Secureframe** | ~$10K/yr | Startups wanting speed | Strong audit partner network |

All three integrate with AWS, GitHub, Slack, etc. to automate evidence collection. Budget $20K-$45K total for Year 1 (platform + auditor).

---

## 6. Common Deal-Breakers in Enterprise Security Reviews

### Instant Disqualifiers

These will kill a deal immediately, regardless of other strengths:

1. **No encryption at rest** -- If customer billing data sits unencrypted in your database, the conversation is over
2. **No MFA for internal access** -- Signals fundamental security immaturity
3. **Shared credentials / no RBAC** -- Team sharing a single admin password is an automatic fail
4. **No incident response plan** -- "We'll figure it out" is not an answer
5. **Storing credentials in code/logs** -- API keys, Stripe secrets, or Apple credentials visible in logs or version control
6. **No DPA available** -- European customers legally cannot proceed without one
7. **No data deletion capability** -- GDPR right-to-erasure is a legal requirement

### Serious Red Flags (May Kill Deal)

8. **No SOC 2 (and no timeline to get one)** -- "We're working on it" buys 3-6 months. "We haven't started" loses the deal.
9. **No penetration testing** -- Self-assessed security is not credible for enterprises
10. **Single-tenant access to multi-tenant data** -- If one customer's admin could theoretically see another customer's data, that's a non-starter
11. **No audit logging** -- Enterprises need to verify who accessed what and when
12. **No backup/DR testing** -- "We have backups" without tested restoration is insufficient
13. **Outdated dependencies** -- Known CVEs in your stack signal poor hygiene
14. **No employee background checks** -- Expected for anyone with access to customer data

### Yellow Flags (Slows Deal, Doesn't Kill It)

15. **No SSO support** -- Annoying but survivable for smaller enterprise buyers
16. **No SOC 2 Type II** (Type I only) -- Acceptable for first deal, expected within a year
17. **No ISO 27001** -- US companies don't always require it; European companies strongly prefer it
18. **US-only data residency** -- Can lose EU deals, but many EU companies accept US hosting with proper DPA/SCCs
19. **No bug bounty program** -- Expected at scale, not at seed stage
20. **Manual security questionnaire responses** -- Slow but not disqualifying; a Trust Center automates this

### RevBack-Specific Risk Areas

Given that RevBack handles Stripe API keys and Apple App Store credentials:

- **Credential storage is a heightened concern.** We are asking customers to give us keys to their revenue. This is higher trust than a typical SaaS integration.
- **Read-only access positioning:** Emphasize that RevBack only needs read-only API access (no ability to modify subscriptions, issue refunds, or change billing). This dramatically reduces the risk profile.
- **Stripe Connect vs. API keys:** Consider using Stripe Connect (OAuth) instead of raw API keys. OAuth-based access is revocable, scoped, and auditable -- enterprises strongly prefer this.
- **Credential rotation:** Support and encourage regular rotation of API credentials. Document the process.
- **Network isolation for credentials:** Store API keys in a dedicated secrets manager (AWS Secrets Manager, Vault), never in application databases, environment variables in code, or logs.

---

## 7. RevBack Security Positioning: Recommended Narrative

### The Trust Pitch

> "RevBack was designed from day one to handle your most sensitive billing data with the same rigor as your payment processor. We use read-only API access, encrypt everything at rest with AES-256, and are SOC 2 [Type I/II] certified. Your Stripe keys are stored in AWS Secrets Manager, isolated from our application database. We can't modify your subscriptions, issue refunds, or change billing -- we can only observe and alert."

### Key Differentiators to Emphasize

1. **Read-only by design** -- We observe, we don't modify. This is architecturally enforced, not just a policy.
2. **Credential isolation** -- API keys in dedicated secrets management, never in application databases
3. **OAuth-first** -- Stripe Connect, Apple App Store Connect API (where available) over raw API keys
4. **Multi-tenant isolation** -- Each org's data is logically separated with org-scoped access controls
5. **SOC 2 from inception** -- "We didn't bolt on security after growing; we designed for it before writing the first line of code"

### What NOT to Say

- "We're just a startup, we'll get to security later" -- instant credibility loss
- "We use Stripe, so we're PCI compliant" -- not how PCI works
- "Our cloud provider handles security" -- shared responsibility model means you own application-level security
- "We've never had a breach" -- irrelevant; the question is what you do to prevent one

---

## Sources

- [SOC 2 Compliance Guide 2026 - Ace Cloud Hosting](https://www.acecloudhosting.com/blog/soc-2-compliance-guide/)
- [SOC 2 Compliance Requirements - Sprinto](https://sprinto.com/blog/soc-2-requirements/)
- [SOC 2 Type 1 vs Type 2 - Drata](https://drata.com/grc-central/soc-2/type-1-vs-type-2)
- [SOC 2 Type 1 vs Type 2 - Vanta](https://www.vanta.com/collection/soc-2/soc-2-type-1-vs-type-2)
- [SOC 2 Certification Cost 2026 - Bright Defense](https://www.brightdefense.com/resources/soc-2-certification-cost/)
- [Security at Stripe - Stripe Documentation](https://docs.stripe.com/security)
- [RevenueCat Security & Compliance](https://www.revenuecat.com/security-and-compliance/)
- [RevenueCat SOC 2 Type II Blog Post](https://www.revenuecat.com/blog/engineering/soc-2-type-ii-compliance/)
- [RevenueCat Trust Center](https://soc2.revenuecat.com/)
- [RevenueCat DPA](https://www.revenuecat.com/dpa/)
- [Chargebee Security](https://www.chargebee.com/security/)
- [Chargebee Compliance Certificates](https://www.chargebee.com/docs/billing/2.0/data-privacy-security/compliance-certificates)
- [SOC 2 Tools: Vanta vs Drata vs Secureframe - SecureLeap](https://www.secureleap.tech/blog/soc-2-tools-vanta-drata-secureframe-guide-2025)
- [Vanta Pricing 2026 - SecureLeap](https://www.secureleap.tech/blog/vanta-review-pricing-top-alternatives-for-compliance-automation)
- [SOC 2 Audit Cost - Vanta](https://www.vanta.com/collection/soc-2/soc-2-audit-cost)
- [Trust Center Examples - Webstacks](https://www.webstacks.com/blog/trust-center-examples)
- [Vanta Trust Center Product](https://www.vanta.com/products/trust-center)
- [PCI DSS Compliance for SaaS - VISTA InfoSec](https://vistainfosec.com/blog/pci-dss-compliance-saas/)
- [HIPAA Compliance for SaaS - HIPAA Journal](https://www.hipaajournal.com/hipaa-compliance-for-saas/)
- [Vendor Risk Management Checklist - NMS Consulting](https://nmsconsulting.com/vendor-risk-management-checklist/)
- [SaaS Security Assessment Guide - RiskImmune](https://riskimmune.ai/blog/saas-security-assessment-a-practical-guide-for-enterprises-mkzbcl)
