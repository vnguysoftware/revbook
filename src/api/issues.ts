import { Hono } from 'hono';
import { eq, and, desc, sql, count, sum, inArray } from 'drizzle-orm';
import type { Database } from '../config/database.js';
import { issues } from '../models/schema.js';
import type { AuthContext } from '../middleware/auth.js';

/**
 * Detector metadata: maps issueType to enrichment fields.
 *
 * These are derived at the API layer (not stored in DB) so that
 * changes to copy/categorization don't require a migration.
 */
const DETECTOR_META: Record<string, {
  category: string;
  scope: 'per_user' | 'aggregate';
  recommendedAction: string;
}> = {
  webhook_delivery_gap: {
    category: 'integration_health',
    scope: 'aggregate',
    recommendedAction: 'Check your webhook endpoint configuration for this billing source. Verify the signing secret matches. Check the provider status page for outages.',
  },
  duplicate_billing: {
    category: 'cross_platform',
    scope: 'per_user',
    recommendedAction: 'Review this user and cancel/refund the duplicate subscription on one platform. Consider adding cross-platform subscription checks to your purchase flow.',
  },
  unrevoked_refund: {
    category: 'revenue_protection',
    scope: 'per_user',
    recommendedAction: 'Check whether your app automatically revokes access after refunds. If not, manually revoke this user\'s access. For chargebacks, immediate revocation strengthens your dispute response.',
  },
  cross_platform_conflict: {
    category: 'cross_platform',
    scope: 'per_user',
    recommendedAction: 'Verify whether this user should still have access. Check if the cancellation/expiration on one platform was intentional or indicates a sync issue.',
  },
  renewal_anomaly: {
    category: 'integration_health',
    scope: 'aggregate',
    recommendedAction: 'Check your webhook configuration for this billing source. Verify server notification URLs. Check the provider status page for outages or increased involuntary churn.',
  },
  data_freshness: {
    category: 'integration_health',
    scope: 'aggregate',
    recommendedAction: 'Re-register your server notification URL for this billing source. Verify delivery with a test subscription. A large percentage of stale subscriptions indicates systematic webhook failure.',
  },
  verified_paid_no_access: {
    category: 'access_verification',
    scope: 'per_user',
    recommendedAction: 'Check your provisioning system for this user. The issue may be in your entitlement check logic, a caching problem, or a feature flag misconfiguration.',
  },
  verified_access_no_payment: {
    category: 'access_verification',
    scope: 'per_user',
    recommendedAction: 'Check your access control logic. This user may be exploiting a caching bug, using a hardcoded bypass, or their access was not properly revoked.',
  },
  // Legacy types that may still exist in the database
  refund_not_revoked: {
    category: 'revenue_protection',
    scope: 'per_user',
    recommendedAction: 'Check whether your app automatically revokes access after refunds.',
  },
  cross_platform_mismatch: {
    category: 'cross_platform',
    scope: 'per_user',
    recommendedAction: 'Verify the user\'s subscription state across platforms.',
  },
  duplicate_subscription: {
    category: 'cross_platform',
    scope: 'per_user',
    recommendedAction: 'Cancel/refund the duplicate subscription on one platform.',
  },
  payment_without_entitlement: {
    category: 'internal',
    scope: 'per_user',
    recommendedAction: 'Internal data consistency issue. Auto-reconciliation should handle this.',
  },
  entitlement_without_payment: {
    category: 'internal',
    scope: 'per_user',
    recommendedAction: 'Internal data consistency issue. Auto-reconciliation should handle this.',
  },
  silent_renewal_failure: {
    category: 'integration_health',
    scope: 'per_user',
    recommendedAction: 'Check webhook delivery for this billing source.',
  },
  trial_no_conversion: {
    category: 'analytics',
    scope: 'per_user',
    recommendedAction: 'Review trial conversion rates on the analytics dashboard.',
  },
  stale_subscription: {
    category: 'integration_health',
    scope: 'per_user',
    recommendedAction: 'Check webhook delivery for this billing source.',
  },
};

const CATEGORY_ISSUE_TYPES: Record<string, string[]> = {
  integration_health: ['webhook_delivery_gap', 'renewal_anomaly', 'data_freshness', 'silent_renewal_failure', 'stale_subscription'],
  cross_platform: ['duplicate_billing', 'cross_platform_conflict', 'cross_platform_mismatch', 'duplicate_subscription'],
  revenue_protection: ['unrevoked_refund', 'refund_not_revoked'],
  access_verification: ['verified_paid_no_access', 'verified_access_no_payment'],
};

function enrichIssue(issue: any) {
  const meta = DETECTOR_META[issue.issueType];
  return {
    ...issue,
    category: meta?.category || 'unknown',
    scope: meta?.scope || 'per_user',
    recommendedAction: meta?.recommendedAction || null,
  };
}

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

    return c.json({ issue: enrichIssue(issue) });
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
