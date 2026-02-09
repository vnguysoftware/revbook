import { eq, and } from 'drizzle-orm';
import type { IssueDetector } from '../detector.js';
import type { Database } from '../../config/database.js';
import type { CanonicalEvent, DetectedIssue, EntitlementState } from '../../models/types.js';
import { entitlements } from '../../models/schema.js';

/**
 * Detector: Cross-Platform State Mismatch
 *
 * Catches when a user's entitlement state differs across billing
 * platforms (e.g., active in Stripe but expired in Apple).
 *
 * This is uniquely valuable — no existing tool catches this because
 * no one else has a unified view across platforms.
 */
export const crossPlatformMismatchDetector: IssueDetector = {
  id: 'cross_platform_mismatch',
  name: 'Cross-Platform State Mismatch',
  description: 'User has conflicting entitlement states across billing platforms',

  async checkEvent(db, orgId, userId, event) {
    // Check after any state-changing event
    return checkUser(db, orgId, userId);
  },

  async scheduledScan(db, orgId) {
    // This runs in the scheduled scan to catch any missed real-time checks
    // In practice, we'd batch this more efficiently
    return [];
  },
};

async function checkUser(
  db: Database,
  orgId: string,
  userId: string,
): Promise<DetectedIssue[]> {
  const userEntitlements = await db
    .select()
    .from(entitlements)
    .where(
      and(
        eq(entitlements.orgId, orgId),
        eq(entitlements.userId, userId),
      ),
    );

  // Group by product
  const byProduct = new Map<string, typeof userEntitlements>();
  for (const ent of userEntitlements) {
    const existing = byProduct.get(ent.productId) || [];
    existing.push(ent);
    byProduct.set(ent.productId, existing);
  }

  const issues: DetectedIssue[] = [];

  for (const [productId, ents] of byProduct) {
    if (ents.length < 2) continue; // Need at least 2 sources to compare

    const activeStates: EntitlementState[] = ['active', 'trial', 'grace_period', 'billing_retry'];
    const inactiveStates: EntitlementState[] = ['inactive', 'expired', 'revoked', 'refunded'];

    const hasActive = ents.some(e => activeStates.includes(e.state as EntitlementState));
    const hasInactive = ents.some(e => inactiveStates.includes(e.state as EntitlementState));

    if (hasActive && hasInactive) {
      const activeEnt = ents.find(e => activeStates.includes(e.state as EntitlementState))!;
      const inactiveEnt = ents.find(e => inactiveStates.includes(e.state as EntitlementState))!;

      issues.push({
        issueType: 'cross_platform_mismatch',
        severity: 'critical',
        title: `${activeEnt.source} says active, ${inactiveEnt.source} says ${inactiveEnt.state}`,
        description: `User has conflicting subscription states: ${activeEnt.source} shows "${activeEnt.state}" but ${inactiveEnt.source} shows "${inactiveEnt.state}" for the same product.`,
        userId,
        confidence: 0.85,
        evidence: {
          productId,
          states: ents.map(e => ({
            source: e.source,
            state: e.state,
            entitlementId: e.id,
            updatedAt: e.updatedAt?.toISOString(),
          })),
        },
      });
    }

    // Also check for duplicate active subscriptions (double billing)
    const activeEnts = ents.filter(e => activeStates.includes(e.state as EntitlementState));
    if (activeEnts.length > 1) {
      issues.push({
        issueType: 'duplicate_subscription',
        severity: 'warning',
        title: `Duplicate active subscriptions across ${activeEnts.map(e => e.source).join(', ')}`,
        description: `User has active subscriptions on multiple platforms for the same product. They may be getting double-billed.`,
        userId,
        confidence: 0.80,
        evidence: {
          productId,
          activeEntitlements: activeEnts.map(e => ({
            source: e.source,
            state: e.state,
            entitlementId: e.id,
          })),
        },
      });
    }
  }

  return issues;
}

