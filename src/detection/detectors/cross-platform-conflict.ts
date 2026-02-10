import { eq, and } from 'drizzle-orm';
import type { IssueDetector } from '../detector.js';
import type { Database } from '../../config/database.js';
import type { DetectedIssue, EntitlementState } from '../../models/types.js';
import { entitlements } from '../../models/schema.js';

/**
 * Detector: Cross-Platform State Conflict
 *
 * Same user has conflicting states across providers — active on one,
 * expired/revoked/refunded on another. This suggests one platform
 * processed a cancellation/refund that the other didn't.
 *
 * Note: duplicate active subscriptions are handled by the separate
 * `duplicate_billing` detector.
 */
export const crossPlatformConflictDetector: IssueDetector = {
  id: 'cross_platform_conflict',
  name: 'Cross-Platform State Conflict',
  description: 'This user\'s subscription status differs between billing platforms — for example, their Stripe subscription is active but their Apple subscription shows as expired. This means your app may grant or deny access inconsistently depending on which platform it checks.',

  async checkEvent(db, orgId, userId, event) {
    return checkUser(db, orgId, userId);
  },

  async scheduledScan(db, orgId) {
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

  const activeStates: EntitlementState[] = ['active', 'trial', 'grace_period', 'billing_retry'];
  const inactiveStates: EntitlementState[] = ['inactive', 'expired', 'revoked', 'refunded'];

  for (const [productId, ents] of byProduct) {
    if (ents.length < 2) continue;

    const hasActive = ents.some(e => activeStates.includes(e.state as EntitlementState));
    const hasInactive = ents.some(e => inactiveStates.includes(e.state as EntitlementState));

    if (hasActive && hasInactive) {
      const activeEnt = ents.find(e => activeStates.includes(e.state as EntitlementState))!;
      const inactiveEnt = ents.find(e => inactiveStates.includes(e.state as EntitlementState))!;

      issues.push({
        issueType: 'cross_platform_conflict',
        severity: 'warning',
        title: `${activeEnt.source} says active, ${inactiveEnt.source} says ${inactiveEnt.state}`,
        description: `User has conflicting subscription states: ${activeEnt.source} shows "${activeEnt.state}" but ${inactiveEnt.source} shows "${inactiveEnt.state}" for the same product. Verify whether the user should still have access.`,
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
  }

  return issues;
}
