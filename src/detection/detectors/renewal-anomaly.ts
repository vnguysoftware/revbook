import { eq, and, gte, sql, count } from 'drizzle-orm';
import type { IssueDetector } from '../detector.js';
import type { DetectedIssue } from '../../models/types.js';
import { canonicalEvents, billingConnections } from '../../models/schema.js';

/**
 * Detector: Renewal Rate Anomaly
 *
 * Detects when the rate of successful renewals for a billing source
 * has dropped significantly compared to the rolling average.
 *
 * This is a scheduled-scan-only aggregate detector. It replaces
 * `silent_renewal_failure` with a signal that is more reliable
 * and less noisy.
 */
export const renewalAnomalyDetector: IssueDetector = {
  id: 'renewal_anomaly',
  name: 'Unusual Renewal Pattern',
  description: 'The rate of successful subscription renewals has dropped significantly compared to your recent average. This often signals a wave of expired payment methods, a pricing change impact, or an issue with your billing provider.',

  async checkEvent() {
    // Aggregate detector — scheduled scan only
    return [];
  },

  async scheduledScan(db, orgId) {
    const issues: DetectedIssue[] = [];
    const now = new Date();

    // Get all active billing connections for this org
    const connections = await db
      .select()
      .from(billingConnections)
      .where(
        and(
          eq(billingConnections.orgId, orgId),
          eq(billingConnections.isActive, true),
        ),
      );

    for (const conn of connections) {
      // Count renewals in the last 6 hours
      const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
      const [recentResult] = await db
        .select({ count: count() })
        .from(canonicalEvents)
        .where(
          and(
            eq(canonicalEvents.orgId, orgId),
            eq(canonicalEvents.source, conn.source),
            eq(canonicalEvents.eventType, 'renewal'),
            eq(canonicalEvents.status, 'success'),
            gte(canonicalEvents.eventTime, sixHoursAgo),
          ),
        );

      const recentCount = recentResult.count;

      // Count renewals in the last 30 days to compute rolling average per 6h window
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const [historicalResult] = await db
        .select({ count: count() })
        .from(canonicalEvents)
        .where(
          and(
            eq(canonicalEvents.orgId, orgId),
            eq(canonicalEvents.source, conn.source),
            eq(canonicalEvents.eventType, 'renewal'),
            eq(canonicalEvents.status, 'success'),
            gte(canonicalEvents.eventTime, thirtyDaysAgo),
          ),
        );

      const historicalTotal = historicalResult.count;
      // 30 days = 120 six-hour windows
      const avgPer6h = historicalTotal / 120;

      // Skip sources with too little data to establish a baseline
      if (avgPer6h < 2) continue;

      const dropPct = avgPer6h > 0
        ? ((avgPer6h - recentCount) / avgPer6h) * 100
        : 0;

      if (dropPct >= 60 || (recentCount === 0 && avgPer6h >= 10)) {
        issues.push({
          issueType: 'renewal_anomaly',
          severity: 'critical',
          title: `${conn.source} renewals down ${Math.round(dropPct)}% vs 30-day average`,
          description: `${conn.source} renewal rate has dropped ${Math.round(dropPct)}% below normal. Expected ~${Math.round(avgPer6h)} renewals per 6h window, got ${recentCount}. This could indicate a webhook delivery problem, billing system issue, or provider outage.`,
          confidence: 0.85,
          evidence: {
            source: conn.source,
            recentCount,
            expectedCount: Math.round(avgPer6h),
            dropPercent: Math.round(dropPct),
            windowHours: 6,
            baselineDays: 30,
          },
        });
      } else if (dropPct >= 30) {
        issues.push({
          issueType: 'renewal_anomaly',
          severity: 'warning',
          title: `${conn.source} renewals below average (${Math.round(dropPct)}% drop)`,
          description: `${conn.source} renewal rate is running ${Math.round(dropPct)}% below the 30-day average. Expected ~${Math.round(avgPer6h)} renewals per 6h window, got ${recentCount}. Check webhook configuration and provider status page.`,
          confidence: 0.70,
          evidence: {
            source: conn.source,
            recentCount,
            expectedCount: Math.round(avgPer6h),
            dropPercent: Math.round(dropPct),
            windowHours: 6,
            baselineDays: 30,
          },
        });
      }
    }

    return issues;
  },
};
