import { Hono } from 'hono';
import { eq, and, desc, gte, lte, count } from 'drizzle-orm';
import type { Database } from '../config/database.js';
import { auditLogs } from '../models/schema.js';
import type { AuthContext } from '../middleware/auth.js';
import { requireScope } from '../middleware/require-scope.js';
import { auditLog } from '../security/audit.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('audit-logs-api');

// ─── Routes ────────────────────────────────────────────────────────

export function createAuditLogRoutes(db: Database) {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();

  // ─── List audit logs with pagination ───────────────────────────

  app.get('/', requireScope('audit:read'), async (c) => {
    const auth = c.get('auth');
    const { orgId } = auth;

    const page = Math.max(1, parseInt(c.req.query('page') || '1'));
    const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '50')));
    const offset = (page - 1) * limit;

    const action = c.req.query('action');
    const resourceType = c.req.query('resourceType');
    const actorId = c.req.query('actorId');
    const startDate = c.req.query('startDate');
    const endDate = c.req.query('endDate');

    // Build filter conditions
    const conditions = [eq(auditLogs.orgId, orgId)];
    if (action) conditions.push(eq(auditLogs.action, action));
    if (resourceType) conditions.push(eq(auditLogs.resourceType, resourceType));
    if (actorId) conditions.push(eq(auditLogs.actorId, actorId));
    if (startDate) conditions.push(gte(auditLogs.createdAt, new Date(startDate)));
    if (endDate) conditions.push(lte(auditLogs.createdAt, new Date(endDate)));

    const where = and(...conditions);

    const [countResult] = await db
      .select({ count: count() })
      .from(auditLogs)
      .where(where);

    const total = Number(countResult?.count || 0);

    const data = await db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset);

    // Meta-audit: log that audit logs were accessed
    auditLog(db, auth, 'read', 'audit_log', undefined, {
      filters: { action, resourceType, actorId, startDate, endDate },
      page,
      limit,
    });

    return c.json({
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  });

  // ─── Export audit logs ─────────────────────────────────────────

  app.get('/export', requireScope('audit:read'), async (c) => {
    const auth = c.get('auth');
    const { orgId } = auth;

    const format = c.req.query('format') || 'json';
    const startDate = c.req.query('startDate');
    const endDate = c.req.query('endDate');

    if (format !== 'json' && format !== 'csv') {
      return c.json({ error: 'Invalid format. Must be "json" or "csv".' }, 400);
    }

    // Build filter conditions
    const conditions = [eq(auditLogs.orgId, orgId)];
    if (startDate) conditions.push(gte(auditLogs.createdAt, new Date(startDate)));
    if (endDate) conditions.push(lte(auditLogs.createdAt, new Date(endDate)));

    const where = and(...conditions);

    const data = await db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt));

    // Meta-audit: log that audit logs were exported
    auditLog(db, auth, 'export', 'audit_log', undefined, {
      format,
      startDate,
      endDate,
      count: data.length,
    });

    if (format === 'csv') {
      const header = 'timestamp,actorType,actorId,action,resourceType,resourceId,metadata';
      const rows = data.map((row) => {
        const ts = row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt;
        const meta = JSON.stringify(row.metadata || {}).replace(/"/g, '""');
        return [
          ts,
          row.actorType,
          row.actorId,
          row.action,
          row.resourceType,
          row.resourceId || '',
          `"${meta}"`,
        ].join(',');
      });

      const csv = [header, ...rows].join('\n');

      c.header('Content-Type', 'text/csv');
      c.header('Content-Disposition', 'attachment; filename="audit-logs.csv"');
      return c.body(csv);
    }

    // JSON format
    c.header('Content-Type', 'application/json');
    c.header('Content-Disposition', 'attachment; filename="audit-logs.json"');
    return c.json(data);
  });

  return app;
}
