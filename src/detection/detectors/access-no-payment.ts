import { eq, and, lt } from 'drizzle-orm';
import type { IssueDetector } from '../detector.js';
import type { Database } from '../../config/database.js';
import type { CanonicalEvent, DetectedIssue } from '../../models/types.js';
import { entitlements, canonicalEvents } from '../../models/schema.js';

/**
 * Detector: Access without Payment
 *
 * Catches the reverse issue: a user has active access but no
 * recent successful payment. This means revenue leakage — the
 * company is giving away product for free.
 */
export const accessNoPaymentDetector: IssueDetector = {
  id: 'access_no_payment',
  name: 'Access without Payment',
  description: 'User has active entitlement but no corresponding successful payment',

  async checkEvent(db, orgId, userId, event) {
    // This is primarily a scheduled scan detector
    // But we also check on failed payment events
    if (event.eventType !== 'billing_retry' || event.status !== 'failed') {
      return [];
    }

    if (!event.productId) return [];

    const [ent] = await db
      .select()
      .from(entitlements)
      .where(
        and(
          eq(entitlements.orgId, orgId),
          eq(entitlements.userId, userId),
          eq(entitlements.productId, event.productId),
        ),
      )
      .limit(1);

    if (!ent || ent.state !== 'active') return [];

    // If entitlement is active but payment just failed, flag it
    return [{
      issueType: 'access_no_payment',
      severity: 'warning',
      title: 'Active access with failed payment',
      description: `Payment failed but user still has active access. If this persists, the user is getting free access.`,
      userId,
      estimatedRevenueCents: event.amountCents || 0,
      confidence: 0.80,
      evidence: {
        eventId: event.id,
        entitlementId: ent.id,
        entitlementState: ent.state,
        failedPaymentTime: event.eventTime.toISOString(),
      },
    }];
  },

  async scheduledScan(db, orgId) {
    const issues: DetectedIssue[] = [];

    // Find active entitlements where period has ended
    const now = new Date();
    const activeEnts = await db
      .select()
      .from(entitlements)
      .where(
        and(
          eq(entitlements.orgId, orgId),
          eq(entitlements.state, 'active'),
          lt(entitlements.currentPeriodEnd, now),
        ),
      );

    for (const ent of activeEnts) {
      if (!ent.currentPeriodEnd) continue;

      const hoursSinceExpiry =
        (now.getTime() - ent.currentPeriodEnd.getTime()) / (1000 * 60 * 60);

      // Only flag if it's been more than 2 hours past period end
      if (hoursSinceExpiry < 2) continue;

      issues.push({
        issueType: 'access_no_payment',
        severity: hoursSinceExpiry > 24 ? 'critical' : 'warning',
        title: `Active access ${Math.round(hoursSinceExpiry)}h past billing period`,
        description: `User has active access but their billing period ended ${Math.round(hoursSinceExpiry)} hours ago with no renewal event.`,
        userId: ent.userId,
        confidence: hoursSinceExpiry > 24 ? 0.90 : 0.70,
        evidence: {
          entitlementId: ent.id,
          periodEnd: ent.currentPeriodEnd.toISOString(),
          hoursSinceExpiry: Math.round(hoursSinceExpiry),
        },
      });
    }

    return issues;
  },
};
