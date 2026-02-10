# Plan Tier Enforcement Implementation

## Status: Queued for Future Implementation

## Overview
Currently NO feature gating exists. All organizations get all features regardless of plan. This document specifies the plan enforcement system needed to match the pricing tiers on the landing page.

## Current State
- No plan field on organizations table
- No subscriber counting
- No provider limits
- No detector enablement by plan
- No feature gating middleware
- All AI features available to all orgs (if ANTHROPIC_API_KEY is set)

## Plan Tiers

### Free ($0/mo)
- 1 billing provider connection
- Up to 1,000 subscribers tracked
- 6 core detectors (Tier 1 only)
- Email alerts only
- 7-day webhook log retention
- No AI features (investigation, clustering, insights)

### Pro ($500-$1,500/mo)
- All billing providers
- Up to 100,000 subscribers
- All 8 detectors (Tier 1 + Tier 2)
- Slack, email, webhook alerts
- 90-day history + 30-day backfill
- AI investigation on every issue
- Incident clustering with AI titles
- Identity resolution

### Enterprise (Custom)
- Unlimited subscribers
- Unlimited AI investigations
- Billing health insights (daily/weekly)
- Adaptive learning from operator feedback
- Custom detectors (when implemented)
- SSO / SAML (when implemented)
- On-prem / VPC deployment
- SLA guarantees + audit log export
- Dedicated support

## Implementation Steps

### 1. Schema Changes
- Add `plan` enum to `organizations` table: `'free' | 'pro' | 'enterprise'`
- Add `subscriberLimit`, `providerLimit` fields (nullable, null = unlimited)
- Add `planExpiresAt` for trial tracking
- Migration: default all existing orgs to 'free' or 'pro' based on config

### 2. Plan Limits Middleware
- Create `src/middleware/plan-limits.ts`
- Check subscriber count on event ingestion
- Check provider count on billing_connections creation
- Check alert channel restrictions on alert rule creation
- Return 402 Payment Required with upgrade message when limits exceeded

### 3. Feature Gating
- Create `src/middleware/feature-gate.ts`
- Gate AI endpoints (investigation, clustering, insights) behind pro/enterprise
- Gate Tier 2 detectors behind pro/enterprise
- Gate billing health insights behind enterprise

### 4. Data Retention by Plan
- Modify `src/queue/retention-worker.ts` to respect plan-based retention:
  - Free: 7-day webhook logs
  - Pro: 90-day webhook logs
  - Enterprise: configurable (default unlimited)

### 5. Subscriber Counting
- Create periodic job to count unique users per org
- Cache count in Redis for fast middleware checks
- Alert org admins when approaching limit (80%, 95%, 100%)

### 6. API Responses
- Include plan info in org API responses
- Include usage stats (subscriber count, provider count)
- Include limit warnings in response headers

## Acceptance Criteria
- [ ] Plan field exists on organizations
- [ ] Subscriber limits enforced with clear error messages
- [ ] Provider limits enforced
- [ ] AI features gated behind pro/enterprise
- [ ] Data retention varies by plan
- [ ] Usage stats available via API
- [ ] Upgrade prompts shown when limits approached
