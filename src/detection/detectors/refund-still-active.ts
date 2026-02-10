import { eq, and, lt, gte, inArray } from 'drizzle-orm';
import type { IssueDetector } from '../detector.js';
import type { DetectedIssue } from '../../models/types.js';
import { entitlements, canonicalEvents } from '../../models/schema.js';

/**
 * Detector: Unrevoked Refund/Chargeback
 *
 * A refund or chargeback was processed but no subsequent state change
 * to "refunded" or "revoked" was observed within a grace window.
 *
 * Event-triggered: only flags if the refund event is >1 hour old
 * and entitlement is still active (gives time for cascading webhooks).
 *
 * Scheduled scan: finds refunds from the last 30 days where
 * entitlement never transitioned.
 */
export const refundStillActiveDetector: IssueDetector = {
  id: 'unrevoked_refund',
  name: 'Refund Without Access Revocation',
  description: 'A refund or chargeback was processed in your billing provider, but your app still grants the user access. Your backend should listen for refund events and revoke access when one is received — this user is getting the product for free after being refunded.',

  async checkEvent(db, orgId, userId, event) {
    if (!['refund', 'chargeback'].includes(event.eventType)) {
      return [];
    }

    if (!event.productId) return [];

    // 1-hour grace period: only flag if the event is >1 hour old
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if (event.eventTime > oneHourAgo) {
      return [];
    }

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
      issueType: 'unrevoked_refund',
      severity: isChargeback ? 'critical' : 'warning',
      title: isChargeback
        ? 'Chargeback recorded but access not revoked'
        : 'Refund processed but access not revoked',
      description: isChargeback
        ? `A chargeback of ${formatCents(event.amountCents, event.currency)} was filed. If you haven't revoked this user's access, do so immediately — this strengthens your dispute response.`
        : `A refund of ${formatCents(event.amountCents, event.currency)} was processed but no access revocation followed. Verify your app's refund webhook handler is working.`,
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
        gracePeriodHours: 1,
      },
    }];
  },

  async scheduledScan(db, orgId) {
    const issues: DetectedIssue[] = [];
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Find refund/chargeback events from last 30 days (but older than 24h)
    const refundEvents = await db
      .select()
      .from(canonicalEvents)
      .where(
        and(
          eq(canonicalEvents.orgId, orgId),
          inArray(canonicalEvents.eventType, ['refund', 'chargeback']),
          gte(canonicalEvents.eventTime, thirtyDaysAgo),
          lt(canonicalEvents.eventTime, twentyFourHoursAgo),
        ),
      );

    for (const event of refundEvents) {
      if (!event.userId || !event.productId) continue;

      // Check if the entitlement is still in an active state
      const [ent] = await db
        .select()
        .from(entitlements)
        .where(
          and(
            eq(entitlements.orgId, orgId),
            eq(entitlements.userId, event.userId),
            eq(entitlements.productId, event.productId),
          ),
        )
        .limit(1);

      if (!ent) continue;

      const activeStates = ['active', 'trial', 'grace_period', 'billing_retry'];
      if (!activeStates.includes(ent.state)) continue;

      const isChargeback = event.eventType === 'chargeback';
      issues.push({
        issueType: 'unrevoked_refund',
        severity: isChargeback ? 'critical' : 'warning',
        title: isChargeback
          ? 'Chargeback still not revoked after 24+ hours'
          : 'Refund still not revoked after 24+ hours',
        description: isChargeback
          ? `A chargeback of ${formatCents(event.amountCents, event.currency)} was filed ${daysSince(event.eventTime, now)} days ago but access has not been revoked. Revoke access immediately to strengthen your dispute response.`
          : `A refund of ${formatCents(event.amountCents, event.currency)} was processed ${daysSince(event.eventTime, now)} days ago but no revocation followed. Verify your refund webhook handler is working.`,
        userId: event.userId,
        estimatedRevenueCents: event.amountCents || 0,
        confidence: 0.90,
        evidence: {
          eventId: event.id,
          eventType: event.eventType,
          eventTime: event.eventTime.toISOString(),
          amount: event.amountCents,
          currency: event.currency,
          entitlementId: ent.id,
          entitlementState: ent.state,
          daysSinceRefund: daysSince(event.eventTime, now),
        },
      });
    }

    return issues;
  },
};

function formatCents(cents: number | null | undefined, currency?: string | null): string {
  if (!cents) return 'unknown amount';
  return `${(cents / 100).toFixed(2)} ${currency || 'USD'}`;
}

function daysSince(date: Date, now: Date): number {
  return Math.round((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}
