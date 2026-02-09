import { eq, and, inArray } from 'drizzle-orm';
import type { IssueDetector } from '../detector.js';
import type { Database } from '../../config/database.js';
import type { DetectedIssue, EntitlementState } from '../../models/types.js';
import { entitlements } from '../../models/schema.js';

/**
 * Detector: Duplicate Cross-Platform Billing
 *
 * Same user has active paid subscriptions on 2+ billing platforms
 * for the same product. They are being double-billed.
 *
 * This is RevBack's killer feature — Stripe has zero visibility into
 * Apple subscriptions and vice versa. This is literally impossible
 * to detect without a unified view.
 */
export const duplicateBillingDetector: IssueDetector = {
  id: 'duplicate_billing',
  name: 'Duplicate Cross-Platform Billing',
  description: 'Same user has active paid subscriptions on multiple billing platforms for the same product',

  async checkEvent(db, orgId, userId, event) {
    return checkUser(db, orgId, userId);
  },

  async scheduledScan(db, orgId) {
    // Scheduled scan is a no-op stub — the real-time event check covers this.
    // A future optimization could batch-query for all users with multi-source entitlements.
    return [];
  },
};

async function checkUser(
  db: Database,
  orgId: string,
  userId: string,
): Promise<DetectedIssue[]> {
  const activeStates: EntitlementState[] = ['active', 'trial', 'grace_period', 'billing_retry'];

  const userEntitlements = await db
    .select()
    .from(entitlements)
    .where(
      and(
        eq(entitlements.orgId, orgId),
        eq(entitlements.userId, userId),
        inArray(entitlements.state, activeStates),
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
    // Need active entitlements from 2+ different sources
    const sources = new Set(ents.map(e => e.source));
    if (sources.size < 2) continue;

    issues.push({
      issueType: 'duplicate_billing',
      severity: 'critical',
      title: `Duplicate active subscriptions across ${[...sources].join(', ')}`,
      description: `User has active subscriptions on ${sources.size} platforms for the same product. They are being double-billed. Review each case and cancel/refund the duplicate subscription.`,
      userId,
      confidence: 0.90,
      evidence: {
        productId,
        activeEntitlements: ents.map(e => ({
          source: e.source,
          state: e.state,
          entitlementId: e.id,
        })),
      },
    });
  }

  return issues;
}
