import { eq, and, lt } from 'drizzle-orm';
import type { IssueDetector } from '../detector.js';
import type { CanonicalEvent, DetectedIssue } from '../../models/types.js';
import { entitlements } from '../../models/schema.js';

/**
 * Detector: Trial Expired Without Conversion Event
 *
 * Catches when a trial has ended (based on trial_end timestamp)
 * but no conversion or expiration event was received. This indicates
 * a possible missed webhook or billing system issue.
 */
export const trialNoConversionDetector: IssueDetector = {
  id: 'trial_no_conversion',
  name: 'Trial Expired Without Conversion',
  description: 'This user\'s trial period ended but your app received no conversion or cancellation event from the billing provider. The user may be in limbo — neither paying nor explicitly churned.',

  async checkEvent() {
    return []; // Scheduled scan only
  },

  async scheduledScan(db, orgId) {
    const issues: DetectedIssue[] = [];
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    // Find trial entitlements where trial should have ended
    const trialEnts = await db
      .select()
      .from(entitlements)
      .where(
        and(
          eq(entitlements.orgId, orgId),
          eq(entitlements.state, 'trial'),
          lt(entitlements.trialEnd, twoHoursAgo),
        ),
      );

    for (const ent of trialEnts) {
      if (!ent.trialEnd) continue;

      const hoursSince =
        (now.getTime() - ent.trialEnd.getTime()) / (1000 * 60 * 60);

      issues.push({
        issueType: 'trial_no_conversion',
        severity: hoursSince > 12 ? 'warning' : 'info',
        title: `Trial expired ${Math.round(hoursSince)}h ago with no conversion event`,
        description: `User's trial ended ${Math.round(hoursSince)} hours ago but no trial_conversion or expiration event has been received. The user may be stuck in trial state.`,
        userId: ent.userId,
        confidence: Math.min(0.6 + hoursSince * 0.02, 0.90),
        evidence: {
          entitlementId: ent.id,
          source: ent.source,
          trialEnd: ent.trialEnd.toISOString(),
          hoursSinceTrialEnd: Math.round(hoursSince),
        },
      });
    }

    return issues;
  },
};
