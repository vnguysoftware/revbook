import { eq, and, count, sql } from 'drizzle-orm';
import type { Database } from '../config/database.js';
import { issues } from '../models/schema.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('ai-learner');

// ─── Types ──────────────────────────────────────────────────────────

export interface IssueFeedback {
  wasRealIssue: boolean;
  actualCause?: string;
  notes?: string;
}

export interface DetectorHealth {
  detectorId: string;
  totalDetected: number;
  resolved: number;
  dismissed: number;
  open: number;
  acknowledged: number;
  truePositiveRate: number;
  falsePositiveRate: number;
  avgConfidence: number;
}

export interface LearningMetrics {
  detectors: DetectorHealth[];
  overallTruePositiveRate: number;
  totalIssues: number;
  totalActioned: number;
}

/**
 * Record feedback for an issue: was it a real issue, what was the actual cause?
 *
 * Stores feedback in the issue's evidence JSON and updates the issue status.
 */
export async function recordFeedback(
  db: Database,
  orgId: string,
  issueId: string,
  feedback: IssueFeedback,
): Promise<void> {
  // Fetch current issue
  const [issue] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.orgId, orgId), eq(issues.id, issueId)))
    .limit(1);

  if (!issue) {
    throw new Error('Issue not found');
  }

  const evidence = (issue.evidence || {}) as Record<string, unknown>;

  // Store feedback in evidence
  const updatedEvidence = {
    ...evidence,
    feedback: {
      wasRealIssue: feedback.wasRealIssue,
      actualCause: feedback.actualCause || null,
      notes: feedback.notes || null,
      submittedAt: new Date().toISOString(),
    },
  };

  // Update status based on feedback
  const newStatus = feedback.wasRealIssue ? 'resolved' : 'dismissed';
  const resolution = feedback.wasRealIssue
    ? `Confirmed real issue. ${feedback.actualCause ? `Actual cause: ${feedback.actualCause}` : ''}`
    : `Dismissed as false positive. ${feedback.notes ? `Reason: ${feedback.notes}` : ''}`;

  await db
    .update(issues)
    .set({
      evidence: updatedEvidence,
      status: newStatus,
      resolution: resolution.trim(),
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(issues.orgId, orgId), eq(issues.id, issueId)));

  log.info(
    {
      issueId,
      wasRealIssue: feedback.wasRealIssue,
      detectorId: issue.detectorId,
    },
    'Feedback recorded for issue',
  );
}

/**
 * Calculate detector health metrics based on historical outcomes.
 *
 * True positive = issue was resolved (confirmed real)
 * False positive = issue was dismissed (not a real issue)
 * Unactioned = still open or acknowledged
 */
export async function getDetectorHealthMetrics(
  db: Database,
  orgId: string,
): Promise<LearningMetrics> {
  // Get counts per detector per status
  const detectorStats = await db
    .select({
      detectorId: issues.detectorId,
      status: issues.status,
      count: count(),
      avgConfidence: sql<number>`AVG(${issues.confidence})`,
    })
    .from(issues)
    .where(eq(issues.orgId, orgId))
    .groupBy(issues.detectorId, issues.status);

  // Aggregate into per-detector metrics
  const detectorMap = new Map<string, DetectorHealth>();

  for (const row of detectorStats) {
    if (!detectorMap.has(row.detectorId)) {
      detectorMap.set(row.detectorId, {
        detectorId: row.detectorId,
        totalDetected: 0,
        resolved: 0,
        dismissed: 0,
        open: 0,
        acknowledged: 0,
        truePositiveRate: 0,
        falsePositiveRate: 0,
        avgConfidence: 0,
      });
    }

    const detector = detectorMap.get(row.detectorId)!;
    detector.totalDetected += row.count;

    switch (row.status) {
      case 'resolved':
        detector.resolved += row.count;
        break;
      case 'dismissed':
        detector.dismissed += row.count;
        break;
      case 'open':
        detector.open += row.count;
        break;
      case 'acknowledged':
        detector.acknowledged += row.count;
        break;
    }

    // Weighted average of confidence
    detector.avgConfidence =
      (detector.avgConfidence * (detector.totalDetected - row.count) +
        (row.avgConfidence || 0) * row.count) /
      detector.totalDetected;
  }

  // Calculate TP/FP rates
  let globalResolved = 0;
  let globalDismissed = 0;
  let globalTotal = 0;

  const detectors: DetectorHealth[] = [];

  for (const detector of detectorMap.values()) {
    const actioned = detector.resolved + detector.dismissed;
    if (actioned > 0) {
      detector.truePositiveRate = detector.resolved / actioned;
      detector.falsePositiveRate = detector.dismissed / actioned;
    } else {
      // No feedback yet — assume neutral
      detector.truePositiveRate = 0;
      detector.falsePositiveRate = 0;
    }

    // Round for cleanliness
    detector.truePositiveRate = Math.round(detector.truePositiveRate * 1000) / 1000;
    detector.falsePositiveRate = Math.round(detector.falsePositiveRate * 1000) / 1000;
    detector.avgConfidence = Math.round(detector.avgConfidence * 1000) / 1000;

    globalResolved += detector.resolved;
    globalDismissed += detector.dismissed;
    globalTotal += detector.totalDetected;

    detectors.push(detector);
  }

  // Sort by total detected descending
  detectors.sort((a, b) => b.totalDetected - a.totalDetected);

  const globalActioned = globalResolved + globalDismissed;
  const overallTruePositiveRate =
    globalActioned > 0 ? Math.round((globalResolved / globalActioned) * 1000) / 1000 : 0;

  return {
    detectors,
    overallTruePositiveRate,
    totalIssues: globalTotal,
    totalActioned: globalActioned,
  };
}

/**
 * Get the confidence adjustment factor for a detector based on its
 * historical accuracy. This can be used to adjust future confidence scores.
 *
 * Returns a multiplier: 1.0 = no adjustment, <1.0 = reduce confidence, >1.0 = increase
 *
 * Uses a simple Bayesian-inspired approach:
 * - Start with prior of 0.5 (assume 50% TP rate)
 * - Update with observed TP rate as more data comes in
 * - Weight shifts from prior to observed as sample size grows
 */
export function computeConfidenceAdjustment(detector: DetectorHealth): number {
  const actioned = detector.resolved + detector.dismissed;

  if (actioned < 5) {
    // Not enough data — no adjustment
    return 1.0;
  }

  // Weight between prior (0.5) and observed rate based on sample size
  // At 5 samples, 50% prior / 50% observed. At 50+, ~90% observed.
  const observedWeight = Math.min(actioned / 55, 0.9);
  const priorWeight = 1 - observedWeight;

  const adjustedRate = priorWeight * 0.7 + observedWeight * detector.truePositiveRate;

  // Map to a multiplier (0.5 to 1.3 range)
  // If TP rate is high (>0.8), slightly boost confidence
  // If TP rate is low (<0.5), reduce confidence
  if (adjustedRate >= 0.8) {
    return 1.0 + (adjustedRate - 0.8) * 0.6; // max 1.12
  } else if (adjustedRate >= 0.5) {
    return 1.0; // neutral zone
  } else {
    return 0.5 + adjustedRate; // min 0.5
  }
}
