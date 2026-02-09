# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**rev-back** is an entitlement correctness engine that detects payment and subscription issues across billing systems (Stripe, Apple App Store, Google Play, etc.). It normalizes billing events from multiple providers, resolves user identities across platforms, tracks entitlement state, and detects revenue leakage issues.

## Commands

```bash
npm run dev              # Start dev server (tsx watch on src/index.ts)
npm run build            # Compile TypeScript to dist/
npm start                # Production: node dist/index.ts
npm run test             # Run tests once (vitest)
npm run test:watch       # Run tests in watch mode
npm run lint             # Lint src/ with eslint
npm run migrate          # Run database migrations (tsx src/config/migrate.ts)
npm run migrate:generate # Generate new migrations (drizzle-kit)
npm run seed             # Seed database (tsx scripts/seed.ts)
```

## Tech Stack

- **Runtime:** Node.js + TypeScript (ES2022, strict mode)
- **Web framework:** Hono with @hono/node-server
- **Database:** PostgreSQL via Drizzle ORM (type-safe schema in `src/models/schema.ts`)
- **Job queue:** BullMQ backed by Redis (ioredis)
- **Validation:** Zod for env vars and request schemas
- **Auth:** JWT (jsonwebtoken + jose)
- **Logging:** Pino (structured JSON in prod, pretty in dev)
- **Path alias:** `@/*` maps to `./src/*`

## Architecture

The system is a **normalized billing event pipeline** with these layers:

1. **Ingestion** (`src/ingestion/`) — Accepts webhooks from billing platforms, verifies signatures, and normalizes events to a canonical model. Provider-specific normalizers implement the `EventNormalizer` interface and register via a plugin registry (`normalizer/base.ts`). Currently implemented: Stripe (`providers/stripe.ts`), Apple (`providers/apple.ts`).

2. **Identity Resolution** (`src/identity/resolver.ts`) — Maps external IDs (Stripe customer_id, Apple transaction_id, email) to canonical user records via an identity graph stored in `user_identities` table. Handles cross-platform user matching and duplicate detection.

3. **Entitlement Engine** (`src/entitlement/`, planned) — State machine tracking subscription lifecycle: `INACTIVE → TRIAL → ACTIVE → GRACE_PERIOD → PAST_DUE → EXPIRED` with side states `PAUSED`, `REVOKED`, `REFUNDED`.

4. **Issue Detection** (`src/detection/`, planned) — Detectors that identify billing correctness problems (e.g., paid-but-no-access, cross-platform state mismatches, unrevoked refunds) with severity levels and revenue impact estimates.

## Data Model

All tables are **multi-tenant** via `orgId`. Key tables in `src/models/schema.ts`:

- **organizations** / **api_keys** — Tenant accounts and API auth with scopes
- **billing_connections** — OAuth/credentials per billing platform
- **products** — Normalized product catalog with cross-platform IDs (stripeProductId, appleProductId, etc.)
- **users** / **user_identities** — Canonical users and identity graph
- **canonical_events** — Normalized billing events with idempotency keys and raw payload preservation
- **entitlements** — Per-user/product/source subscription state with history
- **issues** — Detected billing problems with severity, confidence, and evidence
- **webhook_logs** — Audit trail of all incoming webhooks

Types and interfaces are in `src/models/types.ts`. Key type: `CanonicalEvent` with 16 event types and 4 statuses.

## Configuration

Environment variables are validated with Zod in `src/config/env.ts` (accessed via `getEnv()`). See `.env.example` for required variables. Key services: PostgreSQL (`DATABASE_URL`), Redis (`REDIS_URL`), Stripe keys, Apple App Store credentials, JWT secret.

Database connection uses a lazy singleton pattern in `src/config/database.ts` with `getDb()` and `closeDb()` for graceful shutdown.

## Verification

**Always use Playwright MCP to verify UI work.** After making frontend changes:
1. Start the dev server (`npm run dev` for backend, `cd dashboard && npm run dev` for frontend)
2. Use the Playwright browser tools (`browser_navigate`, `browser_snapshot`, `browser_take_screenshot`) to verify pages render correctly
3. Check for visual regressions, broken layouts, missing data, and error states
4. Verify interactive elements work (buttons, filters, navigation, forms)
5. Take screenshots to document verification
