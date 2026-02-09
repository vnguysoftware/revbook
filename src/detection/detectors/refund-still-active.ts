import { eq, and } from 'drizzle-orm';
import type { IssueDetector } from '../detector.js';
import type { CanonicalEvent, DetectedIssue } from '../../models/types.js';
import { entitlements } from '../../models/schema.js';

/**
 * Detector: Refund/Chargeback but Still Active
 *
 * Catches when a refund or chargeback occurs but the user's
 * entitlement hasn't been revoked. This is revenue leakage and
 * a policy violation risk.
 */
export const refundStillActiveDetector: IssueDetector = {
  id: 'refund_still_active',
  name: 'Refund but Still Active',
  description: 'User received a refund or chargeback but still has active access',

  async checkEvent(db, orgId, userId, event) {
    if (!['refund', 'chargeback'].includes(event.eventType)) {
      return [];
    }

    if (!event.productId) return [];

    // Check if entitlement is still active
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

    if (!ent) return [];

    const activeStates = ['active', 'trial', 'grace_period', 'billing_retry'];
    if (!activeStates.includes(ent.state)) return [];

    const isChargeback = event.eventType === 'chargeback';
    return [{
      issueType: 'refund_still_active',
      severity: isChargeback ? 'critical' : 'warning',
      title: isChargeback
        ? 'Chargeback received but user still has access'
        : 'Refund processed but user still has access',
      description: `A ${event.eventType} of ${formatCents(event.amountCents, event.currency)} was processed but the user's entitlement is still "${ent.state}". Access should likely be revoked.`,
      userId,
      estimatedRevenueCents: event.amountCents || 0,
      confidence: 0.92,
      evidence: {
        eventId: event.id,
        eventType: event.eventType,
        amount: event.amountCents,
        currency: event.currency,
        entitlementId: ent.id,
        entitlementState: ent.state,
      },
    }];
  },
};

function formatCents(cents: number | null | undefined, currency?: string | null): string {
  if (!cents) return 'unknown amount';
  return `${(cents / 100).toFixed(2)} ${currency || 'USD'}`;
}
