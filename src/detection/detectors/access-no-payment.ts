import { eq, and, lt } from 'drizzle-orm';
import type { IssueDetector } from '../detector.js';
import type { Database } from '../../config/database.js';
import type { CanonicalEvent, DetectedIssue } from '../../models/types.js';
import { entitlements, canonicalEvents } from '../../models/schema.js';

/**
 * Detector: Expired Subscription Still Active
 *
 * A subscription shows as active despite no recent successful payment.
 * The renewal may have failed silently or a billing event was missed.
 */
export const accessNoPaymentDetector: IssueDetector = {
  id: 'entitlement_without_payment',
  name: 'Expired Subscription Still Active',
  description: 'Your app shows this user\'s subscription as active, but no recent payment has been recorded from your billing provider. A renewal payment may have failed without your app being notified, or a billing event was missed by your webhook handler.',

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
      issueType: 'entitlement_without_payment',
      severity: 'warning',
      title: 'Entitlement active despite failed payment',
      description: `Payment failed but entitlement state is still "active". If no successful payment follows, this entitlement may be unbacked by revenue.`,
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
        issueType: 'entitlement_without_payment',
        severity: hoursSinceExpiry > 24 ? 'critical' : 'warning',
        title: `Entitlement active ${Math.round(hoursSinceExpiry)}h past billing period`,
        description: `Entitlement is still "active" but the billing period ended ${Math.round(hoursSinceExpiry)} hours ago with no renewal event recorded.`,
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
