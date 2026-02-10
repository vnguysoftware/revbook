import { Hono } from 'hono';
import { eq, and, desc, gte, sql, count } from 'drizzle-orm';
import type { Database } from '../config/database.js';
import { webhookLogs } from '../models/schema.js';
import type { AuthContext } from '../middleware/auth.js';
import { requireScope } from '../middleware/require-scope.js';

/**
 * Webhook Logs API — view incoming webhook deliveries and debug integration issues.
 *
 * Lets customers see what webhooks are arriving, their processing status,
 * and any errors that occurred during normalization.
 */
export function createWebhookLogRoutes(db: Database) {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();

  // ─── Stats Summary ─────────────────────────────────────────────────
  // Must be mounted before /:id to avoid route collision.

  app.get('/stats', requireScope('dashboard:read'), async (c) => {
    const { orgId } = c.get('auth');
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Total count (all time)
    const [totalResult] = await db
      .select({ count: count() })
      .from(webhookLogs)
      .where(eq(webhookLogs.orgId, orgId));

    // Count by status (last 24h)
    const byStatus = await db
      .select({
        status: webhookLogs.processingStatus,
        count: count(),
      })
      .from(webhookLogs)
      .where(
        and(
          eq(webhookLogs.orgId, orgId),
          gte(webhookLogs.createdAt, since24h),
        ),
      )
      .groupBy(webhookLogs.processingStatus);

    // Count by source (last 24h)
    const bySource = await db
      .select({
        source: webhookLogs.source,
        count: count(),
      })
      .from(webhookLogs)
      .where(
        and(
          eq(webhookLogs.orgId, orgId),
          gte(webhookLogs.createdAt, since24h),
        ),
      )
      .groupBy(webhookLogs.source);

    // Build status map
    const statusMap: Record<string, number> = {};
    let total24h = 0;
    for (const row of byStatus) {
      statusMap[row.status] = row.count;
      total24h += row.count;
    }

    const failed24h = statusMap['failed'] || 0;
    const failureRate = total24h > 0 ? (failed24h / total24h) * 100 : 0;

    return c.json({
      total: totalResult.count,
      last24h: {
        total: total24h,
        processed: statusMap['processed'] || 0,
        failed: failed24h,
        skipped: statusMap['skipped'] || 0,
        received: statusMap['received'] || 0,
        queued: statusMap['queued'] || 0,
        failureRate: Math.round(failureRate * 100) / 100,
      },
      bySource: bySource.map((row) => ({
        source: row.source,
        count: row.count,
      })),
    });
  });

  // ─── List Webhook Logs ─────────────────────────────────────────────

  app.get('/', requireScope('dashboard:read'), async (c) => {
    const { orgId } = c.get('auth');
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
    const offset = parseInt(c.req.query('offset') || '0');
    const source = c.req.query('source');
    const status = c.req.query('status');
    const from = c.req.query('from');
    const to = c.req.query('to');

    const whereCondition = and(
      eq(webhookLogs.orgId, orgId),
      source ? eq(webhookLogs.source, source as any) : undefined,
      status ? eq(webhookLogs.processingStatus, status) : undefined,
      from ? gte(webhookLogs.createdAt, new Date(from)) : undefined,
      to ? sql`${webhookLogs.createdAt} <= ${new Date(to)}` : undefined,
    );

    const [totalResult] = await db
      .select({ count: count() })
      .from(webhookLogs)
      .where(whereCondition);

    const results = await db
      .select({
        id: webhookLogs.id,
        source: webhookLogs.source,
        processingStatus: webhookLogs.processingStatus,
        eventType: webhookLogs.eventType,
        externalEventId: webhookLogs.externalEventId,
        errorMessage: webhookLogs.errorMessage,
        createdAt: webhookLogs.createdAt,
        processedAt: webhookLogs.processedAt,
      })
      .from(webhookLogs)
      .where(whereCondition)
      .orderBy(desc(webhookLogs.createdAt))
      .limit(limit)
      .offset(offset);

    return c.json({
      logs: results,
      pagination: { limit, offset, count: totalResult.count },
    });
  });

  // ─── Single Webhook Log Detail ─────────────────────────────────────

  app.get('/:id', requireScope('dashboard:read'), async (c) => {
    const { orgId } = c.get('auth');
    const id = c.req.param('id');

    const [log] = await db
      .select()
      .from(webhookLogs)
      .where(
        and(eq(webhookLogs.orgId, orgId), eq(webhookLogs.id, id)),
      )
      .limit(1);

    if (!log) {
      return c.json({ error: 'Webhook log not found' }, 404);
    }

    return c.json({ log });
  });

  return app;
}
