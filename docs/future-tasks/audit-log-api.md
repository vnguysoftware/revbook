# Audit Log Export API Implementation

## Status: Queued for Future Implementation

## Overview
The audit logging infrastructure exists (`src/security/audit.ts`, `audit_logs` table) but there's no API endpoint to retrieve audit logs. This is an Enterprise feature.

## Current State
- `auditLog()` function writes to `audit_logs` table (fire-and-forget)
- Records: actor type, actor ID, action, resource type, resource ID, metadata
- Organization-scoped
- Indexed by org, action, and created time
- No API endpoint to read/export logs

## Requirements

### API Endpoints
1. `GET /api/audit-logs` - List audit logs with pagination
   - Query params: `page`, `limit`, `action`, `resourceType`, `actorId`, `startDate`, `endDate`
   - Response: paginated list with total count
   - Org-scoped (from auth middleware)

2. `GET /api/audit-logs/export` - Export audit logs
   - Query params: `format` (json | csv), `startDate`, `endDate`
   - Streams response for large exports
   - Include all fields: timestamp, actor, action, resource, metadata

### Feature Gating
- Enterprise plan only
- Return 402 for non-enterprise orgs

### Improvements to Existing Infrastructure
- Make `auditLog()` more reliable (currently fire-and-forget with silent catch)
- Consider a queue-based approach for high-volume orgs
- Add audit log for audit log access (meta-audit)

## Acceptance Criteria
- [ ] GET /api/audit-logs returns paginated, filterable audit logs
- [ ] GET /api/audit-logs/export streams JSON or CSV
- [ ] Gated behind Enterprise plan
- [ ] Tests pass
- [ ] Documentation updated
