import { eq, and, gt, inArray } from 'drizzle-orm';
import type { IssueDetector } from '../detector.js';
import type { Database } from '../../config/database.js';
import type { CanonicalEvent, DetectedIssue } from '../../models/types.js';
import { entitlements, canonicalEvents } from '../../models/schema.js';

/**
 * Detector: Paid but No Access
 *
 * Catches the most critical issue: a user paid successfully but
 * their entitlement is inactive/expired. This means they're being
 * charged but can't use the product.
 *
 * This is the #1 revenue-impacting issue and generates the most
 * support tickets.
 */
export const paidNoAccessDetector: IssueDetector = {
  id: 'paid_no_access',
  name: 'Paid but No Access',
  description: 'User has a successful payment but their entitlement is not active',

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
        issueType: 'paid_no_access',
        severity: 'critical',
        title: `User paid but has no access`,
        description: `Payment of ${formatCents(event.amountCents, event.currency)} succeeded but entitlement is "${ent.state}". The user is being charged without receiving access to the product.`,
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
          issueType: 'paid_no_access',
          severity: 'critical',
          title: `User paid but has no access (scheduled scan)`,
          description: `User has a successful payment from ${payment.eventTime.toISOString()} but entitlement is "${ent.state}".`,
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
