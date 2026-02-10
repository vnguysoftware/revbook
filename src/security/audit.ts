import type { Database } from '../config/database.js';
import type { AuthContext } from '../middleware/auth.js';
import { auditLogs } from '../models/schema.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('audit');

/**
 * Record an audit log entry. Fire-and-forget — never blocks API responses.
 */
export function auditLog(
  db: Database,
  auth: AuthContext,
  action: string,
  resourceType: string,
  resourceId?: string,
  metadata?: Record<string, unknown>,
): void {
  db.insert(auditLogs)
    .values({
      orgId: auth.orgId,
      actorType: 'api_key',
      actorId: auth.apiKeyId,
      action,
      resourceType,
      resourceId: resourceId || null,
      metadata: metadata || {},
    })
    .catch((err) => {
      log.error({ err, action, resourceType }, 'Failed to write audit log');
    });
}
