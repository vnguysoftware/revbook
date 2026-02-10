import { eq, and, lt, gt, inArray } from 'drizzle-orm';
import type { IssueDetector } from '../detector.js';
import type { CanonicalEvent, DetectedIssue } from '../../models/types.js';
import { entitlements, canonicalEvents } from '../../models/schema.js';

/**
 * Detector: Silent Renewal Failure
 *
 * Catches when a subscription's billing period has ended but no
 * renewal event was received. This could mean:
 * - Webhook was dropped
 * - Billing system silently failed
 * - Network issue prevented notification delivery
 *
 * This is especially valuable for Apple where webhook delivery
 * is notoriously unreliable.
 */
export const silentRenewalFailureDetector: IssueDetector = {
  id: 'silent_renewal_failure',
  name: 'Silent Renewal Failure',
  description: 'This subscription\'s billing period ended but no renewal event was received from your billing provider. The payment may have failed without your app being notified, or the renewal webhook was lost.',

  async checkEvent() {
    // This detector only runs as a scheduled scan
    return [];
  },

  async scheduledScan(db, orgId) {
    const issues: DetectedIssue[] = [];
    const now = new Date();

    // Find active subscriptions where period ended 1-24 hours ago
    // with no renewal event
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const candidates = await db
      .select()
      .from(entitlements)
      .where(
        and(
          eq(entitlements.orgId, orgId),
          eq(entitlements.state, 'active'),
          lt(entitlements.currentPeriodEnd, oneHourAgo),
          gt(entitlements.currentPeriodEnd, twentyFourHoursAgo),
        ),
      );

    for (const ent of candidates) {
      if (!ent.currentPeriodEnd) continue;

      // Check if there's a renewal event after the period end
      const recentEvents = await db
        .select()
        .from(canonicalEvents)
        .where(
          and(
            eq(canonicalEvents.orgId, orgId),
            eq(canonicalEvents.userId, ent.userId),
            eq(canonicalEvents.productId, ent.productId),
            gt(canonicalEvents.eventTime, ent.currentPeriodEnd),
            inArray(canonicalEvents.eventType, [
              'renewal',
              'expiration',
              'cancellation',
              'billing_retry',
            ]),
          ),
        )
        .limit(1);

      if (recentEvents.length === 0) {
        const hoursSince =
          (now.getTime() - ent.currentPeriodEnd.getTime()) / (1000 * 60 * 60);

        issues.push({
          issueType: 'silent_renewal_failure',
          severity: hoursSince > 6 ? 'critical' : 'warning',
          title: `No renewal event ${Math.round(hoursSince)}h after period end`,
          description: `Subscription period ended ${Math.round(hoursSince)} hours ago on ${ent.source} but no renewal, expiration, or failure event has been received. The webhook may have been dropped.`,
          userId: ent.userId,
          confidence: Math.min(0.5 + hoursSince * 0.05, 0.95),
          evidence: {
            entitlementId: ent.id,
            source: ent.source,
            periodEnd: ent.currentPeriodEnd.toISOString(),
            hoursSincePeriodEnd: Math.round(hoursSince),
            externalSubscriptionId: ent.externalSubscriptionId,
          },
        });
      }
    }

    return issues;
  },
};
