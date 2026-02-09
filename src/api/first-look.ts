import { Hono } from 'hono';
import { eq, and, desc, count, sum, sql } from 'drizzle-orm';
import type { Database } from '../config/database.js';
import {
  canonicalEvents,
  issues,
  entitlements,
  users,
  billingConnections,
} from '../models/schema.js';
import type { AuthContext } from '../middleware/auth.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('first-look');

/**
 * First Look Report API
 *
 * This is the "aha moment" endpoint. After a customer connects their
 * billing system and imports historical data, they hit this endpoint
 * and see the reality of their subscription health:
 *
 *   "You're losing $23,000/month across 47 issues."
 *
 * The report is auto-generated from whatever data has been imported.
 * It gives the customer immediate, tangible proof that RevBack is
 * finding real money they're leaving on the table.
 *
 * This endpoint is designed to be called by the onboarding wizard
 * as Step 6 (after historical import completes).
 */
export function createFirstLookRoutes(db: Database) {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();

  app.get('/', async (c) => {
    const { orgId } = c.get('auth');

    // Run all queries in parallel for speed
    const [
      subscriberStats,
      entitlementDistribution,
      issuesByType,
      issuesBySeverity,
      topIssues,
      connectionInfo,
      eventStats,
      recentActivity,
    ] = await Promise.all([
      // Total subscribers
      db
        .select({ count: count() })
        .from(users)
        .where(eq(users.orgId, orgId))
        .then(([r]) => r),

      // Entitlement state distribution
      db
        .select({
          state: entitlements.state,
          count: count(),
        })
        .from(entitlements)
        .where(eq(entitlements.orgId, orgId))
        .groupBy(entitlements.state),

      // Issues by type with revenue impact
      db
        .select({
          issueType: issues.issueType,
          count: count(),
          totalRevenueCents: sum(issues.estimatedRevenueCents),
        })
        .from(issues)
        .where(and(eq(issues.orgId, orgId), eq(issues.status, 'open')))
        .groupBy(issues.issueType)
        .orderBy(desc(sum(issues.estimatedRevenueCents))),

      // Issues by severity
      db
        .select({
          severity: issues.severity,
          count: count(),
          totalRevenueCents: sum(issues.estimatedRevenueCents),
        })
        .from(issues)
        .where(and(eq(issues.orgId, orgId), eq(issues.status, 'open')))
        .groupBy(issues.severity),

      // Top 5 most impactful issues (by estimated revenue)
      db
        .select({
          id: issues.id,
          issueType: issues.issueType,
          severity: issues.severity,
          title: issues.title,
          description: issues.description,
          estimatedRevenueCents: issues.estimatedRevenueCents,
          confidence: issues.confidence,
          createdAt: issues.createdAt,
        })
        .from(issues)
        .where(and(eq(issues.orgId, orgId), eq(issues.status, 'open')))
        .orderBy(desc(issues.estimatedRevenueCents))
        .limit(5),

      // Active billing connections
      db
        .select({
          source: billingConnections.source,
          isActive: billingConnections.isActive,
          lastSyncAt: billingConnections.lastSyncAt,
          syncStatus: billingConnections.syncStatus,
        })
        .from(billingConnections)
        .where(eq(billingConnections.orgId, orgId)),

      // Event statistics
      db
        .select({
          source: canonicalEvents.source,
          count: count(),
        })
        .from(canonicalEvents)
        .where(eq(canonicalEvents.orgId, orgId))
        .groupBy(canonicalEvents.source),

      // Recent event activity (last 30 days aggregated by day)
      db
        .select({
          date: sql`DATE(${canonicalEvents.eventTime})`.as('date'),
          count: count(),
        })
        .from(canonicalEvents)
        .where(
          and(
            eq(canonicalEvents.orgId, orgId),
            sql`${canonicalEvents.eventTime} >= NOW() - INTERVAL '30 days'`,
          ),
        )
        .groupBy(sql`DATE(${canonicalEvents.eventTime})`)
        .orderBy(sql`DATE(${canonicalEvents.eventTime})`),
    ]);

    // Compute total revenue at risk
    const totalRevenueCentsAtRisk = issuesBySeverity.reduce(
      (sum, row) => sum + (Number(row.totalRevenueCents) || 0),
      0,
    );
    const totalOpenIssues = issuesBySeverity.reduce(
      (sum, row) => sum + Number(row.count),
      0,
    );

    // Calculate monthly revenue impact (annualize recurring issues)
    const monthlyRevenueAtRisk = totalRevenueCentsAtRisk;

    // Determine report readiness
    const hasData = Number(subscriberStats.count) > 0;
    const hasIssues = totalOpenIssues > 0;

    const report = {
      generatedAt: new Date().toISOString(),
      dataReady: hasData,

      // "We found X subscribers across Y billing sources"
      overview: {
        totalSubscribers: Number(subscriberStats.count),
        activeSources: connectionInfo.filter((c) => c.isActive).map((c) => c.source),
        totalEventsProcessed: eventStats.reduce((s, e) => s + Number(e.count), 0),
        eventsBySource: eventStats.map((e) => ({
          source: e.source,
          count: Number(e.count),
        })),
      },

      // "Your subscriber health looks like this"
      subscriberHealth: {
        distribution: entitlementDistribution.map((d) => ({
          state: d.state,
          count: Number(d.count),
          percentage:
            Number(subscriberStats.count) > 0
              ? Math.round(
                  (Number(d.count) / Number(subscriberStats.count)) * 100,
                )
              : 0,
        })),
      },

      // "You're losing $X/month"
      revenueImpact: {
        totalMonthlyRevenueCentsAtRisk: monthlyRevenueAtRisk,
        totalOpenIssues,
        bySeverity: issuesBySeverity.map((s) => ({
          severity: s.severity,
          count: Number(s.count),
          revenueCents: Number(s.totalRevenueCents) || 0,
        })),
        byType: issuesByType.map((t) => ({
          issueType: t.issueType,
          count: Number(t.count),
          revenueCents: Number(t.totalRevenueCents) || 0,
        })),
      },

      // "Here are your biggest problems"
      topIssues: topIssues.map((issue) => ({
        id: issue.id,
        type: issue.issueType,
        severity: issue.severity,
        title: issue.title,
        description: issue.description,
        estimatedRevenueCents: issue.estimatedRevenueCents,
        confidence: issue.confidence,
      })),

      // Activity timeline for sparkline
      activityTimeline: recentActivity.map((d) => ({
        date: d.date,
        events: Number(d.count),
      })),

      // Import summary
      importSummary: connectionInfo.map((c) => ({
        source: c.source,
        syncStatus: c.syncStatus,
        lastSyncAt: c.lastSyncAt,
      })),
    };

    log.info(
      {
        orgId,
        subscribers: report.overview.totalSubscribers,
        issues: report.revenueImpact.totalOpenIssues,
        revenueAtRisk: report.revenueImpact.totalMonthlyRevenueCentsAtRisk,
      },
      'First Look report generated',
    );

    return c.json(report);
  });

  return app;
}
