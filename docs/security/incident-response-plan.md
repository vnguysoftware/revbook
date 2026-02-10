# Incident Response Plan

**RevBack, Inc.**
**Effective Date:** February 2026
**Last Reviewed:** February 2026
**Owner:** Engineering Lead
**Classification:** Internal

---

## 1. Purpose

This plan defines how RevBack identifies, responds to, contains, and recovers from security incidents. RevBack processes enterprise billing credentials (Stripe API keys, Apple private keys) and billing event data, making rapid incident response critical to maintaining customer trust.

## 2. Scope

This plan covers incidents affecting:
- RevBack application server, workers, and dashboard
- PostgreSQL database and Redis instances
- Customer billing credentials stored in `billing_connections` table
- Billing event data and entitlement state
- Integration with third-party services (Stripe, Apple, Google, Anthropic)
- Source code repository and CI/CD pipeline

## 3. Incident Severity Levels

### SEV-1: Critical

**Definition:** Active data breach, credential exposure, or complete service outage.

**Examples:**
- Customer billing credentials (Stripe API keys, Apple private keys) exposed or exfiltrated
- `CREDENTIAL_ENCRYPTION_KEY` compromised -- all stored credentials at risk
- Unauthorized access to production database
- Evidence of an attacker actively exploiting the system

**Response time:** 15 minutes to acknowledge, 1 hour to contain
**Communication:** Immediate notification to all affected customers. Status page updated within 30 minutes.

### SEV-2: High

**Definition:** Partial breach, vulnerability actively being exploited, or degraded service affecting data integrity.

**Examples:**
- Cross-tenant data leakage (orgId isolation failure)
- API key authentication bypass
- Webhook signature verification bypass allowing malicious payload injection
- Rate limiting failure leading to abuse
- Unauthorized API key created or scope escalation

**Response time:** 1 hour to acknowledge, 4 hours to contain
**Communication:** Affected customers notified within 4 hours.

### SEV-3: Medium

**Definition:** Vulnerability discovered but not actively exploited, or service degradation not affecting data integrity.

**Examples:**
- PII leaking into logs despite redaction configuration
- Sanitization bypass (PII stored in `rawPayload` or `rawHeaders`)
- Audit log gaps (fire-and-forget writes failing systematically)
- Data retention worker not running (stale data accumulating)
- Dependency vulnerability with a known exploit path

**Response time:** 4 hours to acknowledge, 24 hours to remediate
**Communication:** Internal tracking. Customer notification if data affected.

### SEV-4: Low

**Definition:** Security improvement opportunity, minor misconfiguration, or informational finding.

**Examples:**
- Missing security headers on a non-sensitive endpoint
- Dependency vulnerability with no known exploit
- Log verbosity exposing non-sensitive internal details
- Rate limit thresholds too permissive

**Response time:** Next business day
**Communication:** Internal tracking only.

## 4. Incident Response Phases

### Phase 1: Detection

**Automated detection sources:**
- Application error logs (Pino structured logging, `src/config/logger.ts`)
- Audit log anomaly review (`audit_logs` table -- `src/security/audit.ts`)
- Rate limiting alerts (HTTP 429 spikes from `src/middleware/rate-limit.ts`)
- Queue monitoring (failed job accumulation in DLQ -- `src/queue/dlq.ts`)
- Webhook signature verification failures logged at WARN level (`src/api/webhooks.ts:87`)
- Database query anomalies (unexpected cross-org access patterns)

**Manual detection sources:**
- Customer reports to security@revback.io
- Security researcher disclosure
- Routine code review
- Dependency vulnerability scanning

### Phase 2: Triage

Upon detection, the responder must:

1. **Classify severity** using the levels defined in Section 3
2. **Identify affected systems:** Which components are involved?
   - API server (`src/index.ts`)
   - Webhook ingestion (`src/api/webhooks.ts`, `src/ingestion/`)
   - Credential storage (`billing_connections` table, `src/security/credentials.ts`)
   - Queue workers (`src/queue/`)
   - Dashboard (`dashboard/`)
3. **Identify affected customers:** Which organizations are impacted? Check `orgId` in relevant logs and audit entries.
4. **Determine blast radius:** Is this limited to one organization or system-wide?
5. **Document initial findings** in the incident tracking system

### Phase 3: Containment

**Immediate containment actions by incident type:**

**Credential exposure:**
1. Rotate `CREDENTIAL_ENCRYPTION_KEY` and re-encrypt all `billing_connections.credentials` values
2. Notify affected customers to rotate their Stripe API keys and Apple private keys
3. Invalidate all API keys for affected organizations (delete from `api_keys` table, issue new keys)
4. Review audit logs for unauthorized `billing_connection.created` or credential access actions

**API authentication bypass:**
1. Deploy hotfix to `src/middleware/auth.ts`
2. Invalidate all active API keys (truncate `api_keys` table, issue new keys to verified owners)
3. Review audit logs for actions performed with the bypass

**Cross-tenant data leak:**
1. Identify the query or endpoint missing `orgId` filtering
2. Deploy hotfix with correct `orgId` scoping
3. Determine which organizations' data was exposed and to whom
4. Preserve database query logs for forensic review

**Webhook injection (signature bypass):**
1. Temporarily disable webhook endpoints for affected source (`POST /webhooks/:org/:source`)
2. Fix signature verification in the relevant normalizer (`src/ingestion/providers/`)
3. Review all webhook logs (`webhook_logs` table) since the vulnerability was introduced
4. Re-process legitimate events and purge injected data from `canonical_events`

**Rate limiting failure:**
1. Implement emergency IP-based blocking at the infrastructure level
2. Fix rate limiter (`src/middleware/rate-limit.ts` or `src/queue/rate-limiter.ts`)
3. Review request logs for abuse patterns

### Phase 4: Eradication

1. **Root cause analysis:** Identify the exact code path, configuration, or process failure
2. **Deploy fix:** Follow the change management process (`change-management-policy.md`)
   - For SEV-1/SEV-2: Emergency hotfix path (expedited review, immediate deploy)
   - For SEV-3/SEV-4: Standard PR review and deploy cycle
3. **Verify fix:** Confirm the vulnerability is closed via testing
4. **Scan for related issues:** Check if the same pattern exists elsewhere in the codebase

### Phase 5: Recovery

1. **Restore service:** If service was degraded, verify full functionality
   - Health check: `GET /health` returns `{ status: 'ok' }`
   - Queue health: `GET /api/v1/admin/queues` shows workers active and no DLQ backlog
   - Integration health: `GET /setup/status` shows all billing connections healthy
2. **Re-process affected data:** If events were lost or corrupted, use backfill (`POST /setup/backfill/stripe`) or replay from `rawPayload` data
3. **Monitor for recurrence:** Heightened monitoring for 72 hours post-incident
4. **Customer communication:** Notify affected customers that the incident is resolved, what data was affected, and what remediation actions they should take (e.g., rotate keys)

### Phase 6: Post-Mortem

Post-mortem required for all SEV-1 and SEV-2 incidents. Post-mortem document must include:

1. **Timeline:** Minute-by-minute sequence of detection, response, and resolution
2. **Root cause:** Technical root cause with code references
3. **Impact:** Number of affected customers, data types exposed, duration of exposure
4. **Detection gap:** How long was the vulnerability present before detection? Why wasn't it caught sooner?
5. **Action items:** Specific tasks to prevent recurrence, with owners and deadlines
6. **Process improvements:** Changes to monitoring, testing, or review processes

Post-mortem meeting held within 5 business days of resolution. Document shared with all engineering team members.

## 5. Communication Templates

### Customer Notification (SEV-1/SEV-2)

```
Subject: [RevBack Security Notice] Action Required

We are writing to inform you of a security incident that affected your
RevBack account.

What happened: [Description]
When: [Timeline]
What data was affected: [Specific data types]
What we've done: [Remediation actions taken]
What you need to do: [Customer actions required, e.g., rotate API keys]

We take the security of your data seriously and apologize for this
incident. If you have questions, contact security@revback.io.
```

### Internal Escalation

```
Subject: [SEV-X] [Brief description]

Severity: SEV-X
Detected: [timestamp]
Affected systems: [list]
Affected customers: [count or list]
Current status: [Investigating / Containing / Resolved]
Incident lead: [name]
```

## 6. Contact Information

| Role | Contact | Availability |
|---|---|---|
| Security contact | security@revback.io | 24/7 for SEV-1 |
| Engineering lead | Internal escalation | Business hours + on-call |
| Responsible disclosure | security@revback.io | Monitored daily |

## 7. Evidence Preservation

During any incident, preserve:
- Application logs (Pino JSON output)
- Audit log entries (`audit_logs` table) for the affected time period
- Webhook logs (`webhook_logs` table) for the affected organizations
- Database query logs if available
- Redis command logs if available
- Git history for the affected code paths

Do not delete, modify, or truncate any logs or database records during an active investigation.

## 8. Testing and Drills

- This plan is reviewed and updated quarterly
- Tabletop exercises conducted semi-annually, simulating SEV-1 scenarios (credential exposure, cross-tenant leak)
- Post-incident action items are tracked to completion and verified
