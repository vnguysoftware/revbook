import { Hono } from 'hono';
import { eq, and, desc, gte, sql, count, sum } from 'drizzle-orm';
import type { Database } from '../config/database.js';
import { canonicalEvents, issues, entitlements, users } from '../models/schema.js';
import type { AuthContext } from '../middleware/auth.js';

/**
 * Dashboard API — aggregate views for the main dashboard.
 *
 * Key views:
 * 1. Revenue impact summary (how much money is at risk)
 * 2. Event feed (real-time stream of billing events)
 * 3. Entitlement health overview
 * 4. Trend data for charts
 */
export function createDashboardRoutes(db: Database) {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();

  // ─── Revenue Impact View ────────────────────────────────────────────
  // "You're losing $X/month" — the killer feature for enterprise sales.

  app.get('/revenue-impact', async (c) => {
    const { orgId } = c.get('auth');

    // Total revenue at risk from open issues
    const [openIssues] = await db
      .select({
        totalRevenueCents: sum(issues.estimatedRevenueCents),
        issueCount: count(),
      })
      .from(issues)
      .where(
        and(eq(issues.orgId, orgId), eq(issues.status, 'open')),
      );

    // Revenue at risk by severity
    const bySeverity = await db
      .select({
        severity: issues.severity,
        totalRevenueCents: sum(issues.estimatedRevenueCents),
        issueCount: count(),
      })
      .from(issues)
      .where(
        and(eq(issues.orgId, orgId), eq(issues.status, 'open')),
      )
      .groupBy(issues.severity);

    // Revenue at risk by issue type
    const byType = await db
      .select({
        issueType: issues.issueType,
        totalRevenueCents: sum(issues.estimatedRevenueCents),
        issueCount: count(),
      })
      .from(issues)
      .where(
        and(eq(issues.orgId, orgId), eq(issues.status, 'open')),
      )
      .groupBy(issues.issueType);

    // Resolved issues (money saved)
    const [resolved] = await db
      .select({
        totalRevenueCents: sum(issues.estimatedRevenueCents),
        issueCount: count(),
      })
      .from(issues)
      .where(
        and(eq(issues.orgId, orgId), eq(issues.status, 'resolved')),
      );

    return c.json({
      atRisk: {
        totalCents: Number(openIssues.totalRevenueCents) || 0,
        issueCount: openIssues.issueCount,
      },
      bySeverity,
      byType,
      saved: {
        totalCents: Number(resolved.totalRevenueCents) || 0,
        issueCount: resolved.issueCount,
      },
    });
  });

  // ─── Event Feed (real-time stream) ──────────────────────────────────

  app.get('/events', async (c) => {
    const { orgId } = c.get('auth');
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);
    const source = c.req.query('source');
    const eventType = c.req.query('type');

    const events = await db
      .select({
        id: canonicalEvents.id,
        source: canonicalEvents.source,
        eventType: canonicalEvents.eventType,
        sourceEventType: canonicalEvents.sourceEventType,
        eventTime: canonicalEvents.eventTime,
        status: canonicalEvents.status,
        amountCents: canonicalEvents.amountCents,
        currency: canonicalEvents.currency,
        userId: canonicalEvents.userId,
        environment: canonicalEvents.environment,
        ingestedAt: canonicalEvents.ingestedAt,
      })
      .from(canonicalEvents)
      .where(
        and(
          eq(canonicalEvents.orgId, orgId),
          source ? eq(canonicalEvents.source, source as any) : undefined,
          eventType ? eq(canonicalEvents.eventType, eventType as any) : undefined,
        ),
      )
      .orderBy(desc(canonicalEvents.eventTime))
      .limit(limit);

    return c.json({ events });
  });

  // ─── Entitlement Health Overview ────────────────────────────────────

  app.get('/entitlement-health', async (c) => {
    const { orgId } = c.get('auth');

    const byState = await db
      .select({
        state: entitlements.state,
        count: count(),
      })
      .from(entitlements)
      .where(eq(entitlements.orgId, orgId))
      .groupBy(entitlements.state);

    const bySource = await db
      .select({
        source: entitlements.source,
        state: entitlements.state,
        count: count(),
      })
      .from(entitlements)
      .where(eq(entitlements.orgId, orgId))
      .groupBy(entitlements.source, entitlements.state);

    const [totalUsers] = await db
      .select({ count: count() })
      .from(users)
      .where(eq(users.orgId, orgId));

    return c.json({
      totalUsers: totalUsers.count,
      byState,
      bySource,
    });
  });

  // ─── Trend Data (for charts) ────────────────────────────────────────

  app.get('/trends/issues', async (c) => {
    const { orgId } = c.get('auth');
    const days = Math.min(parseInt(c.req.query('days') || '30'), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const trend = await db
      .select({
        date: sql`DATE(${issues.createdAt})`.as('date'),
        severity: issues.severity,
        count: count(),
        revenue: sum(issues.estimatedRevenueCents),
      })
      .from(issues)
      .where(
        and(
          eq(issues.orgId, orgId),
          gte(issues.createdAt, since),
        ),
      )
      .groupBy(sql`DATE(${issues.createdAt})`, issues.severity)
      .orderBy(sql`DATE(${issues.createdAt})`);

    return c.json({ trend, days });
  });

  app.get('/trends/events', async (c) => {
    const { orgId } = c.get('auth');
    const days = Math.min(parseInt(c.req.query('days') || '30'), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const trend = await db
      .select({
        date: sql`DATE(${canonicalEvents.eventTime})`.as('date'),
        source: canonicalEvents.source,
        count: count(),
      })
      .from(canonicalEvents)
      .where(
        and(
          eq(canonicalEvents.orgId, orgId),
          gte(canonicalEvents.eventTime, since),
        ),
      )
      .groupBy(sql`DATE(${canonicalEvents.eventTime})`, canonicalEvents.source)
      .orderBy(sql`DATE(${canonicalEvents.eventTime})`);

    return c.json({ trend, days });
  });

  return app;
}
