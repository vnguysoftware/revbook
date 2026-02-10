import { eq, and, lt, inArray } from 'drizzle-orm';
import type { IssueDetector } from '../detector.js';
import type { DetectedIssue } from '../../models/types.js';
import { entitlements, canonicalEvents } from '../../models/schema.js';
import { desc } from 'drizzle-orm';

/**
 * Detector: Stale Subscription
 *
 * Finds subscriptions where the last billing event is older than
 * the current billing period. This indicates:
 *
 * - Missed webhook events (dropped by provider or network)
 * - Billing system silently stopped sending events
 * - Stale data that is no longer reflecting reality
 *
 * This is a scheduled-only detector that runs daily. It catches
 * subscriptions that have "gone quiet" — no events at all, not
 * even failures or expirations.
 */
export const staleSubscriptionDetector: IssueDetector = {
  id: 'stale_subscription',
  name: 'Stale Subscription',
  description: 'This subscription hasn\'t generated any billing events (payments, renewals, cancellations) relative to its expected billing cycle. Your records may be stale — the actual status in your billing provider\'s system could be different.',

  async checkEvent() {
    // This detector only runs as a scheduled scan
    return [];
  },

  async scheduledScan(db, orgId) {
    const issues: DetectedIssue[] = [];
    const now = new Date();

    // Find active/trial subscriptions where the current period has ended
    // and we have not received any events since then
    const activeEnts = await db
      .select()
      .from(entitlements)
      .where(
        and(
          eq(entitlements.orgId, orgId),
          inArray(entitlements.state, ['active', 'trial', 'grace_period', 'billing_retry']),
          lt(entitlements.currentPeriodEnd, now),
        ),
      );

    for (const ent of activeEnts) {
      if (!ent.currentPeriodEnd) continue;

      const daysSincePeriodEnd =
        (now.getTime() - ent.currentPeriodEnd.getTime()) / (1000 * 60 * 60 * 24);

      // Only flag if the period ended more than 2 days ago — gives time for
      // grace periods, retries, and normal webhook delays
      if (daysSincePeriodEnd < 2) continue;

      // Get the most recent event time for this subscription
      const lastEvents = await db
        .select({ eventTime: canonicalEvents.eventTime })
        .from(canonicalEvents)
        .where(
          and(
            eq(canonicalEvents.orgId, orgId),
            eq(canonicalEvents.userId, ent.userId),
            eq(canonicalEvents.productId, ent.productId),
          ),
        )
        .orderBy(desc(canonicalEvents.eventTime))
        .limit(1);

      if (lastEvents.length === 0) continue;

      const lastEventTime = lastEvents[0].eventTime;
      const daysSinceLastEvent =
        (now.getTime() - lastEventTime.getTime()) / (1000 * 60 * 60 * 24);

      // Flag if no event in the last billing period worth of time
      // A subscription with a monthly billing period should get events at least monthly
      if (daysSinceLastEvent > 35) {
        issues.push({
          issueType: 'stale_subscription',
          severity: daysSinceLastEvent > 60 ? 'critical' : 'warning',
          title: `No events for ${Math.round(daysSinceLastEvent)} days on ${ent.source} subscription`,
          description: `Subscription is marked as "${ent.state}" but the last billing event was ${Math.round(daysSinceLastEvent)} days ago (${lastEventTime.toISOString()}). This likely indicates missed webhook events or stale data. The subscription state may no longer reflect reality.`,
          userId: ent.userId,
          confidence: Math.min(0.6 + daysSinceLastEvent * 0.005, 0.95),
          evidence: {
            entitlementId: ent.id,
            source: ent.source,
            currentState: ent.state,
            currentPeriodEnd: ent.currentPeriodEnd.toISOString(),
            daysSincePeriodEnd: Math.round(daysSincePeriodEnd),
            lastEventTime: lastEventTime.toISOString(),
            daysSinceLastEvent: Math.round(daysSinceLastEvent),
            externalSubscriptionId: ent.externalSubscriptionId,
          },
        });
      }
    }

    return issues;
  },
};
