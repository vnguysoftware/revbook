import { eq, and, lt, inArray, count } from 'drizzle-orm';
import type { IssueDetector } from '../detector.js';
import type { DetectedIssue, EntitlementState } from '../../models/types.js';
import { entitlements, billingConnections } from '../../models/schema.js';

/**
 * Detector: Data Freshness Alert
 *
 * Detects when a significant portion (>10%) of active subscriptions
 * for a billing source have gone one full billing cycle (35+ days)
 * without any event. This indicates systematic webhook delivery failure.
 *
 * This is a scheduled-scan-only aggregate detector. It replaces
 * the per-user `stale_subscription` detector with a signal that
 * is less noisy and more actionable.
 */
export const dataFreshnessDetector: IssueDetector = {
  id: 'data_freshness',
  name: 'Stale Billing Data',
  description: 'A significant percentage of active subscriptions have had no billing events in over 35 days, indicating systematic webhook failure',

  async checkEvent() {
    // Aggregate detector — scheduled scan only
    return [];
  },

  async scheduledScan(db, orgId) {
    const issues: DetectedIssue[] = [];
    const now = new Date();
    const staleThreshold = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);

    // Get all active billing connections
    const connections = await db
      .select()
      .from(billingConnections)
      .where(
        and(
          eq(billingConnections.orgId, orgId),
          eq(billingConnections.isActive, true),
        ),
      );

    const activeStates: EntitlementState[] = ['active', 'trial', 'grace_period', 'billing_retry'];

    for (const conn of connections) {
      // Count total active entitlements for this source
      const [totalResult] = await db
        .select({ count: count() })
        .from(entitlements)
        .where(
          and(
            eq(entitlements.orgId, orgId),
            eq(entitlements.source, conn.source),
            inArray(entitlements.state, activeStates),
          ),
        );

      const totalActive = totalResult.count;

      // Skip sources with too few active subscriptions
      if (totalActive < 10) continue;

      // Count active entitlements where the last event is >35 days old.
      // We use a subquery approach: find entitlements whose updatedAt is older
      // than the stale threshold (as a proxy for last event time).
      const [staleResult] = await db
        .select({ count: count() })
        .from(entitlements)
        .where(
          and(
            eq(entitlements.orgId, orgId),
            eq(entitlements.source, conn.source),
            inArray(entitlements.state, activeStates),
            lt(entitlements.updatedAt, staleThreshold),
          ),
        );

      const staleCount = staleResult.count;
      const stalePct = (staleCount / totalActive) * 100;

      if (stalePct >= 25) {
        issues.push({
          issueType: 'data_freshness',
          severity: 'critical',
          title: `${Math.round(stalePct)}% of ${conn.source} subscriptions have stale data`,
          description: `${staleCount} of ${totalActive} active ${conn.source} subscriptions have had no billing events in over 35 days. This suggests systematic webhook delivery failure. Re-register your ${conn.source} notification URL and verify with a test subscription.`,
          confidence: 0.90,
          evidence: {
            source: conn.source,
            staleCount,
            totalActive,
            stalePercent: Math.round(stalePct),
            thresholdDays: 35,
          },
        });
      } else if (stalePct >= 10) {
        issues.push({
          issueType: 'data_freshness',
          severity: 'warning',
          title: `${Math.round(stalePct)}% of ${conn.source} subscriptions may be stale`,
          description: `${staleCount} of ${totalActive} active ${conn.source} subscriptions have had no billing events in over 35 days. Check your webhook configuration for ${conn.source}.`,
          confidence: 0.75,
          evidence: {
            source: conn.source,
            staleCount,
            totalActive,
            stalePercent: Math.round(stalePct),
            thresholdDays: 35,
          },
        });
      }
    }

    return issues;
  },
};
