import { Hono } from 'hono';
import { eq, and, desc, sql, count, sum, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../config/database.js';
import { issues } from '../models/schema.js';
import type { AuthContext } from '../middleware/auth.js';
import { DETECTOR_META, CATEGORY_ISSUE_TYPES, enrichIssue } from '../detection/detector-meta.js';
import { dispatchWebhookEvent } from '../alerts/webhook-events.js';
import { requireScope } from '../middleware/require-scope.js';
import { auditLog } from '../security/audit.js';

// ─── Validation Schemas ────────────────────────────────────────────

const resolveIssueSchema = z.object({
  resolution: z.string().max(2000).optional(),
});

const dismissIssueSchema = z.object({
  reason: z.string().max(2000).optional(),
});

/**
 * Issues API — the core dashboard API.
 *
 * "Sentry for money" — this is what customers look at every day.
 */
export function createIssueRoutes(db: Database) {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();

  // ─── Issue Feed (like Sentry's issue list) ──────────────────────────

  app.get('/', requireScope('issues:read'), async (c) => {
    const { orgId } = c.get('auth');
    const status = c.req.query('status') || 'open';
    const severity = c.req.query('severity');
    const issueType = c.req.query('type');
    const category = c.req.query('category');
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
    const offset = parseInt(c.req.query('offset') || '0');

    // Resolve category to a list of issue types
    const categoryTypes = category ? CATEGORY_ISSUE_TYPES[category] : undefined;

    const whereCondition = and(
      eq(issues.orgId, orgId),
      eq(issues.status, status as any),
      severity ? eq(issues.severity, severity as any) : undefined,
      issueType ? eq(issues.issueType, issueType) : undefined,
      categoryTypes ? inArray(issues.issueType, categoryTypes) : undefined,
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
      issues: results.map(enrichIssue),
      pagination: { limit, offset, count: totalResult.count },
    });
  });

  // ─── Issue Summary (dashboard header stats) ─────────────────────────

  app.get('/summary', requireScope('issues:read'), async (c) => {
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

    // Derive category summary from byType
    const byCategory: Record<string, { count: number; revenue: number }> = {};
    for (const row of byType) {
      const meta = DETECTOR_META[row.issueType];
      const cat = meta?.category || 'unknown';
      if (!byCategory[cat]) byCategory[cat] = { count: 0, revenue: 0 };
      byCategory[cat].count += row.count;
      byCategory[cat].revenue += Number(row.revenue) || 0;
    }

    return c.json({
      open: openCount.count,
      critical: criticalCount.count,
      revenueAtRiskCents: Number(revenueAtRisk.total) || 0,
      byType: byType.map(row => ({
        ...row,
        category: DETECTOR_META[row.issueType]?.category || 'unknown',
      })),
      byCategory,
    });
  });

  // ─── Single Issue Detail ────────────────────────────────────────────

  app.get('/:issueId', requireScope('issues:read'), async (c) => {
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

    return c.json({ issue: enrichIssue(issue) });
  });

  // ─── Acknowledge Issue ──────────────────────────────────────────────

  app.post('/:issueId/acknowledge', requireScope('issues:write'), async (c) => {
    const { orgId } = c.get('auth');
    const issueId = c.req.param('issueId');

    await db
      .update(issues)
      .set({ status: 'acknowledged', updatedAt: new Date() })
      .where(
        and(eq(issues.orgId, orgId), eq(issues.id, issueId)),
      );

    dispatchWebhookEvent(db, orgId, issueId, 'issue.acknowledged').catch(() => {});
    auditLog(db, c.get('auth'), 'issue.acknowledged', 'issue', issueId);

    return c.json({ ok: true });
  });

  // ─── Resolve Issue ──────────────────────────────────────────────────

  app.post('/:issueId/resolve', requireScope('issues:write'), async (c) => {
    const { orgId } = c.get('auth');
    const issueId = c.req.param('issueId');
    const body = await c.req.json().catch(() => ({}));

    const parsed = resolveIssueSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', details: parsed.error.flatten().fieldErrors }, 400);
    }

    await db
      .update(issues)
      .set({
        status: 'resolved',
        resolvedAt: new Date(),
        resolution: parsed.data.resolution || null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(issues.orgId, orgId), eq(issues.id, issueId)),
      );

    dispatchWebhookEvent(db, orgId, issueId, 'issue.resolved').catch(() => {});
    auditLog(db, c.get('auth'), 'issue.resolved', 'issue', issueId);

    return c.json({ ok: true });
  });

  // ─── Dismiss Issue ──────────────────────────────────────────────────

  app.post('/:issueId/dismiss', requireScope('issues:write'), async (c) => {
    const { orgId } = c.get('auth');
    const issueId = c.req.param('issueId');
    const body = await c.req.json().catch(() => ({}));

    const parsed = dismissIssueSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', details: parsed.error.flatten().fieldErrors }, 400);
    }

    await db
      .update(issues)
      .set({
        status: 'dismissed',
        resolution: parsed.data.reason || 'Dismissed',
        updatedAt: new Date(),
      })
      .where(
        and(eq(issues.orgId, orgId), eq(issues.id, issueId)),
      );

    dispatchWebhookEvent(db, orgId, issueId, 'issue.dismissed').catch(() => {});
    auditLog(db, c.get('auth'), 'issue.dismissed', 'issue', issueId);

    return c.json({ ok: true });
  });

  return app;
}
