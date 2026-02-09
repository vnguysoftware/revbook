import { eq, and, desc, inArray } from 'drizzle-orm';
import type { IssueDetector } from '../detector.js';
import type { DetectedIssue } from '../../models/types.js';
import { entitlements, accessChecks } from '../../models/schema.js';
import { hasAccessCheckData } from '../tier.js';

/**
 * Detector: Paid But No Access (Tier 2 — App Verified)
 *
 * Requires access-check integration. Finds users who have an active
 * entitlement (they're paying) but whose app reports hasAccess = false.
 * This is the verified version of "Payment Not Provisioned".
 */
export const verifiedPaidNoAccessDetector: IssueDetector = {
  id: 'verified_paid_no_access',
  name: 'Paid But No Access',
  description: 'A paying customer has been confirmed by your app as not having access. This is verified via your app integration.',

  async checkEvent() {
    // Tier 2 detectors only run on scheduled scans
    return [];
  },

  async scheduledScan(db, orgId) {
    const issues: DetectedIssue[] = [];

    // Early return if org has no access-check data
    if (!(await hasAccessCheckData(db, orgId))) {
      return issues;
    }

    // Find active entitlements
    const activeEnts = await db
      .select()
      .from(entitlements)
      .where(
        and(
          eq(entitlements.orgId, orgId),
          inArray(entitlements.state, ['active', 'trial']),
        ),
      );

    for (const ent of activeEnts) {
      // Get the latest access check for this user
      const [latestCheck] = await db
        .select()
        .from(accessChecks)
        .where(
          and(
            eq(accessChecks.orgId, orgId),
            eq(accessChecks.userId, ent.userId),
          ),
        )
        .orderBy(desc(accessChecks.reportedAt))
        .limit(1);

      if (!latestCheck) continue;

      // User is paying but app reports no access
      if (latestCheck.hasAccess === false) {
        issues.push({
          issueType: 'verified_paid_no_access',
          severity: 'critical',
          title: 'Paying customer confirmed without access',
          description: `User has an active ${ent.state} entitlement but your app reported hasAccess=false at ${latestCheck.reportedAt.toISOString()}. This customer is paying but cannot use the product.`,
          userId: ent.userId,
          confidence: 0.95,
          detectionTier: 'app_verified',
          evidence: {
            entitlementId: ent.id,
            entitlementState: ent.state,
            accessCheckId: latestCheck.id,
            accessCheckTime: latestCheck.reportedAt.toISOString(),
            hasAccess: false,
          },
        });
      }
    }

    return issues;
  },
};
