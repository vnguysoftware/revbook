# Change Management Policy

**RevBack, Inc.**
**Effective Date:** February 2026
**Last Reviewed:** February 2026
**Owner:** Engineering Lead
**Classification:** Internal

---

## 1. Purpose

This policy governs how changes to RevBack's codebase, infrastructure, and configuration are proposed, reviewed, approved, tested, and deployed. All changes must follow this process to maintain the integrity and security of the system that handles enterprise billing credentials and subscription data.

## 2. Scope

This policy applies to:
- Application source code (TypeScript backend, React dashboard)
- Database schema changes (Drizzle ORM migrations in `migrations/`)
- Environment configuration changes (`src/config/env.ts`, `.env` files)
- Infrastructure changes (database, Redis, hosting)
- Dependency updates (`package.json`, `package-lock.json`)
- Security control changes (encryption, authentication, authorization, rate limiting)

## 3. Change Categories

### Standard Changes

Routine changes that follow the full review process:
- New features and API endpoints
- Bug fixes
- UI updates to the dashboard
- Detector logic changes (`src/detection/detectors/`)
- Documentation updates
- Non-security dependency updates

**Process:** PR with code review, automated tests pass, merge to main, deploy.

### Security-Sensitive Changes

Changes that affect security controls require heightened review:
- Authentication logic (`src/middleware/auth.ts`)
- Authorization and scope system (`src/security/scopes.ts`, `src/middleware/require-scope.ts`)
- Encryption implementation (`src/security/encryption.ts`, `src/security/credentials.ts`)
- Webhook signature verification (`src/ingestion/providers/`)
- Data sanitization (`src/security/sanitize.ts`)
- Rate limiting (`src/middleware/rate-limit.ts`)
- Audit logging (`src/security/audit.ts`)
- CORS and security headers (`src/index.ts:73-89`)
- Environment variable validation (`src/config/env.ts`)
- Data retention logic (`src/queue/retention-worker.ts`)

**Process:** PR with security-focused code review (reviewer must verify no regressions to controls), automated tests pass, manual testing of the affected security control, merge to main, deploy with post-deploy verification.

### Emergency Changes (Hotfixes)

Changes required to address active SEV-1 or SEV-2 security incidents (see `incident-response-plan.md`):

**Process:** Expedited review (single reviewer approval sufficient), deploy immediately, follow up with full review and post-mortem within 48 hours.

### Database Schema Changes

Changes to the data model (`src/models/schema.ts`) or migrations:

**Process:** Standard review process plus:
- Migration script tested against a copy of production data
- Rollback migration prepared and tested
- Deploy during low-traffic window when possible
- Verify application compatibility before and after migration

## 4. Change Process

### 4.1 Development

1. **Branch from main:** All changes developed on feature branches
2. **Implement change** following existing code patterns:
   - TypeScript strict mode (ES2022)
   - Hono framework conventions for API routes
   - Drizzle ORM for database queries with `orgId` scoping
   - Zod for input validation
   - Pino for structured logging with redaction
3. **Write tests:** Changes must include tests using Vitest (`npm run test`)
   - Current test suite: 305+ tests covering backend functionality
   - Security-sensitive changes require specific test coverage for the control
4. **Lint:** Code must pass ESLint (`npm run lint`)
5. **Type check:** TypeScript compilation must succeed (`npm run build`)

### 4.2 Code Review

**Required for all changes:**

1. Create a pull request against `main` branch
2. PR description must include:
   - Summary of what changed and why
   - Testing approach (what was tested, how)
   - For security-sensitive changes: explicit description of security implications
3. At least one reviewer must approve before merge
4. Reviewer checklist:
   - Does the change maintain `orgId` tenant isolation in all queries?
   - Are new API endpoints protected by auth middleware and appropriate scopes?
   - Is user input validated (Zod schemas for request bodies)?
   - Are credentials/PII handled correctly (encrypted, sanitized, redacted)?
   - Does the change introduce any new environment variables? Are they validated in `src/config/env.ts`?
   - Are error responses safe (no stack traces, internal paths, or secrets in production)?

### 4.3 Automated Testing

Before merge, the following must pass:

| Check | Command | What It Verifies |
|---|---|---|
| Unit/integration tests | `npm run test` | Business logic, API endpoints, detectors, security controls |
| Linting | `npm run lint` | Code style and common errors |
| TypeScript compilation | `npm run build` | Type safety, no implicit `any`, strict mode |

### 4.4 Deployment

1. **Merge to main:** After review approval and all checks pass
2. **Build:** `npm run build` compiles TypeScript to `dist/`
3. **Deploy:** Application deployed to production environment
4. **Post-deploy verification:**
   - `GET /health` returns `{ status: 'ok' }` on the new deployment
   - Spot-check key API endpoints
   - Monitor error rates in logs for 30 minutes post-deploy
   - For security changes: verify the specific control is functioning (e.g., test rate limiting returns 429, test scope enforcement returns 403)

### 4.5 Rollback

If post-deploy verification reveals issues:
1. Revert to previous deployment immediately
2. Investigate root cause on the feature branch
3. Fix and re-submit through standard change process
4. For database migrations: execute the rollback migration

## 5. Configuration Changes

### Environment Variables

Changes to environment variables are treated as configuration changes:
- All variables defined and validated in `src/config/env.ts` using Zod
- New variables must be added to the Zod schema with appropriate validation (type, format, min length)
- Sensitive variables (`CREDENTIAL_ENCRYPTION_KEY`, `JWT_SECRET`, Stripe/Apple keys) must never be committed to source control
- `.env.example` updated with new variable names (but not values)
- Configuration changes deployed following the same review process as code changes

### Security-Critical Configuration

The following configuration changes require extra scrutiny:
- `CREDENTIAL_ENCRYPTION_KEY`: Rotation requires re-encrypting all `billing_connections.credentials` values
- `JWT_SECRET`: Rotation invalidates all active sessions
- `ALLOWED_ORIGINS`: Controls CORS policy (`src/index.ts:74`)
- `LOG_LEVEL`: Setting to `debug` or `trace` in production may expose additional internal details

## 6. Dependency Management

- Dependencies defined in `package.json`
- Lock file (`package-lock.json`) committed to source control for reproducible builds
- Dependency updates reviewed for:
  - Known vulnerabilities (npm audit)
  - Breaking changes that could affect security controls
  - License compatibility
- Major version updates to security-relevant dependencies (e.g., `jose`, `jsonwebtoken`, `ioredis`, `drizzle-orm`) require security review

## 7. Records

All changes are tracked in:
- **Git history:** Full commit history with author, timestamp, and PR reference
- **Pull request records:** Discussion, review comments, approval decisions
- **Audit logs:** Runtime changes recorded in `audit_logs` table (`src/security/audit.ts`)

Change records are retained indefinitely in the Git repository and PR system.

## 8. Policy Review

This policy is reviewed quarterly and updated when development processes or tooling change significantly.
