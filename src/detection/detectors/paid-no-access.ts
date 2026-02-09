import { eq, and, gt, inArray } from 'drizzle-orm';
import type { IssueDetector } from '../detector.js';
import type { Database } from '../../config/database.js';
import type { CanonicalEvent, DetectedIssue } from '../../models/types.js';
import { entitlements, canonicalEvents } from '../../models/schema.js';

/**
 * Detector: Payment Not Provisioned
 *
 * A successful payment was recorded but the subscription state was
 * not updated. This may indicate a webhook processing failure or
 * billing system inconsistency.
 */
export const paidNoAccessDetector: IssueDetector = {
  id: 'payment_without_entitlement',
  name: 'Payment Not Provisioned',
  description: 'A successful payment was recorded but the subscription state was not updated. This may indicate a webhook processing failure or billing system inconsistency.',

  async checkEvent(db, orgId, userId, event) {
    const issues: DetectedIssue[] = [];

    // Only trigger on successful payment events
    if (
      event.status !== 'success' ||
      !['purchase', 'renewal'].includes(event.eventType)
    ) {
      return issues;
    }

    if (!event.productId) return issues;

    // Check entitlement state
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

    if (!ent) return issues;

    const inactiveStates = ['inactive', 'expired', 'revoked', 'refunded'];
    if (inactiveStates.includes(ent.state)) {
      issues.push({
        issueType: 'payment_without_entitlement',
        severity: 'critical',
        title: `Payment succeeded but entitlement is ${ent.state}`,
        description: `Payment of ${formatCents(event.amountCents, event.currency)} succeeded but entitlement state is "${ent.state}" instead of "active". This may indicate a missed webhook or state machine failure.`,
        userId,
        estimatedRevenueCents: event.amountCents || 0,
        confidence: 0.95,
        evidence: {
          eventId: event.id,
          eventType: event.eventType,
          paymentAmount: event.amountCents,
          currency: event.currency,
          entitlementState: ent.state,
          entitlementId: ent.id,
          source: event.source,
        },
      });
    }

    return issues;
  },

  async scheduledScan(db, orgId) {
    const issues: DetectedIssue[] = [];

    // Find all inactive entitlements that have recent successful payments
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const inactiveEnts = await db
      .select()
      .from(entitlements)
      .where(
        and(
          eq(entitlements.orgId, orgId),
          inArray(entitlements.state, ['inactive', 'expired']),
        ),
      );

    for (const ent of inactiveEnts) {
      const recentPayments = await db
        .select()
        .from(canonicalEvents)
        .where(
          and(
            eq(canonicalEvents.orgId, orgId),
            eq(canonicalEvents.userId, ent.userId),
            eq(canonicalEvents.productId, ent.productId),
            eq(canonicalEvents.status, 'success'),
            inArray(canonicalEvents.eventType, ['purchase', 'renewal']),
            gt(canonicalEvents.eventTime, thirtyMinutesAgo),
          ),
        )
        .limit(1);

      if (recentPayments.length > 0) {
        const payment = recentPayments[0];
        issues.push({
          issueType: 'payment_without_entitlement',
          severity: 'critical',
          title: `Payment succeeded but entitlement is ${ent.state} (scheduled scan)`,
          description: `Successful payment from ${payment.eventTime.toISOString()} but entitlement state is "${ent.state}". Expected state transition to "active" did not occur.`,
          userId: ent.userId,
          estimatedRevenueCents: payment.amountCents || 0,
          confidence: 0.90,
          evidence: {
            eventId: payment.id,
            entitlementId: ent.id,
            entitlementState: ent.state,
            paymentTime: payment.eventTime.toISOString(),
          },
        });
      }
    }

    return issues;
  },
};

function formatCents(cents: number | null | undefined, currency?: string | null): string {
  if (!cents) return 'unknown amount';
  return `${(cents / 100).toFixed(2)} ${currency || 'USD'}`;
}
