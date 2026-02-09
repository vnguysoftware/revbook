import { eq, and, desc, inArray } from 'drizzle-orm';
import type { IssueDetector } from '../detector.js';
import type { DetectedIssue } from '../../models/types.js';
import { entitlements, accessChecks, users } from '../../models/schema.js';
import { hasAccessCheckData } from '../tier.js';

/**
 * Detector: Access Without Payment (Tier 2 — App Verified)
 *
 * Requires access-check integration. Finds users whose app reports
 * hasAccess = true but whose entitlement is expired, revoked, refunded,
 * or inactive. This is the verified version of "Expired Subscription Still Active".
 */
export const verifiedAccessNoPaymentDetector: IssueDetector = {
  id: 'verified_access_no_payment',
  name: 'Access Without Payment',
  description: 'A user has been confirmed by your app as having access despite no active subscription. This is verified via your app integration.',

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

    // Find access checks where hasAccess = true
    // We check these against entitlements to see if they should still have access
    const recentChecksWithAccess = await db
      .select()
      .from(accessChecks)
      .where(
        and(
          eq(accessChecks.orgId, orgId),
          eq(accessChecks.hasAccess, true),
        ),
      )
      .orderBy(desc(accessChecks.reportedAt))
      .limit(500);

    // Deduplicate by userId to only check each user once
    const seenUsers = new Set<string>();

    for (const check of recentChecksWithAccess) {
      if (!check.userId) continue;
      if (seenUsers.has(check.userId)) continue;
      seenUsers.add(check.userId);

      // Check entitlement state for this user
      const userEnts = await db
        .select()
        .from(entitlements)
        .where(
          and(
            eq(entitlements.orgId, orgId),
            eq(entitlements.userId, check.userId),
          ),
        );

      // If user has no entitlements at all, or all are in inactive states
      const inactiveStates = ['expired', 'revoked', 'refunded', 'inactive'];
      const hasActiveEntitlement = userEnts.some(e => !inactiveStates.includes(e.state));

      if (!hasActiveEntitlement) {
        issues.push({
          issueType: 'verified_access_no_payment',
          severity: 'critical',
          title: 'User has access without active subscription',
          description: `Your app reported hasAccess=true for this user at ${check.reportedAt.toISOString()}, but their subscription is ${userEnts.length > 0 ? userEnts.map(e => e.state).join(', ') : 'not found'}. They may be accessing the product without paying.`,
          userId: check.userId,
          confidence: 0.95,
          detectionTier: 'app_verified',
          evidence: {
            accessCheckId: check.id,
            accessCheckTime: check.reportedAt.toISOString(),
            hasAccess: true,
            entitlementStates: userEnts.map(e => ({ id: e.id, state: e.state, productId: e.productId })),
          },
        });
      }
    }

    return issues;
  },
};
