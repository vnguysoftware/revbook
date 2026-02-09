import { Hono } from 'hono';
import { eq, and, desc, sql, count, sum } from 'drizzle-orm';
import type { Database } from '../config/database.js';
import { issues } from '../models/schema.js';
import type { AuthContext } from '../middleware/auth.js';

/**
 * Issues API — the core dashboard API.
 *
 * "Sentry for money" — this is what customers look at every day.
 */
export function createIssueRoutes(db: Database) {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();

  // ─── Issue Feed (like Sentry's issue list) ──────────────────────────

  app.get('/', async (c) => {
    const { orgId } = c.get('auth');
    const status = c.req.query('status') || 'open';
    const severity = c.req.query('severity');
    const issueType = c.req.query('type');
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
    const offset = parseInt(c.req.query('offset') || '0');

    const whereCondition = and(
      eq(issues.orgId, orgId),
      eq(issues.status, status as any),
      severity ? eq(issues.severity, severity as any) : undefined,
      issueType ? eq(issues.issueType, issueType) : undefined,
    );

    const [totalResult] = await db
      .select({ count: count() })
      .from(issues)
      .where(whereCondition);

    const results = await db
      .select()
      .from(issues)
      .where(whereCondition)
      .orderBy(desc(issues.createdAt))
      .limit(limit)
      .offset(offset);

    return c.json({
      issues: results,
      pagination: { limit, offset, count: totalResult.count },
    });
  });

  // ─── Issue Summary (dashboard header stats) ─────────────────────────

  app.get('/summary', async (c) => {
    const { orgId } = c.get('auth');

    const [openCount] = await db
      .select({ count: count() })
      .from(issues)
      .where(
        and(eq(issues.orgId, orgId), eq(issues.status, 'open')),
      );

    const [criticalCount] = await db
      .select({ count: count() })
      .from(issues)
      .where(
        and(
          eq(issues.orgId, orgId),
          eq(issues.status, 'open'),
          eq(issues.severity, 'critical'),
        ),
      );

    const [revenueAtRisk] = await db
      .select({ total: sum(issues.estimatedRevenueCents) })
      .from(issues)
      .where(
        and(eq(issues.orgId, orgId), eq(issues.status, 'open')),
      );

    // Group by issue type
    const byType = await db
      .select({
        issueType: issues.issueType,
        count: count(),
        revenue: sum(issues.estimatedRevenueCents),
      })
      .from(issues)
      .where(
        and(eq(issues.orgId, orgId), eq(issues.status, 'open')),
      )
      .groupBy(issues.issueType);

    return c.json({
      open: openCount.count,
      critical: criticalCount.count,
      revenueAtRiskCents: Number(revenueAtRisk.total) || 0,
      byType,
    });
  });

  // ─── Single Issue Detail ────────────────────────────────────────────

  app.get('/:issueId', async (c) => {
    const { orgId } = c.get('auth');
    const issueId = c.req.param('issueId');

    const [issue] = await db
      .select()
      .from(issues)
      .where(
        and(eq(issues.orgId, orgId), eq(issues.id, issueId)),
      )
      .limit(1);

    if (!issue) {
      return c.json({ error: 'Issue not found' }, 404);
    }

    return c.json({ issue });
  });

  // ─── Acknowledge Issue ──────────────────────────────────────────────

  app.post('/:issueId/acknowledge', async (c) => {
    const { orgId } = c.get('auth');
    const issueId = c.req.param('issueId');

    await db
      .update(issues)
      .set({ status: 'acknowledged', updatedAt: new Date() })
      .where(
        and(eq(issues.orgId, orgId), eq(issues.id, issueId)),
      );

    return c.json({ ok: true });
  });

  // ─── Resolve Issue ──────────────────────────────────────────────────

  app.post('/:issueId/resolve', async (c) => {
    const { orgId } = c.get('auth');
    const issueId = c.req.param('issueId');
    const body = await c.req.json().catch(() => ({}));

    await db
      .update(issues)
      .set({
        status: 'resolved',
        resolvedAt: new Date(),
        resolution: body.resolution || null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(issues.orgId, orgId), eq(issues.id, issueId)),
      );

    return c.json({ ok: true });
  });

  // ─── Dismiss Issue ──────────────────────────────────────────────────

  app.post('/:issueId/dismiss', async (c) => {
    const { orgId } = c.get('auth');
    const issueId = c.req.param('issueId');
    const body = await c.req.json().catch(() => ({}));

    await db
      .update(issues)
      .set({
        status: 'dismissed',
        resolution: body.reason || 'Dismissed',
        updatedAt: new Date(),
      })
      .where(
        and(eq(issues.orgId, orgId), eq(issues.id, issueId)),
      );

    return c.json({ ok: true });
  });

  return app;
}
