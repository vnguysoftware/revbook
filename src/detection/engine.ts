import { eq, and } from 'drizzle-orm';
import type { Database } from '../config/database.js';
import { issues } from '../models/schema.js';
import type { CanonicalEvent, DetectedIssue, Issue } from '../models/types.js';
import type { IssueDetector } from './detector.js';
import { webhookGapDetector } from './detectors/webhook-gap.js';
import { duplicateBillingDetector } from './detectors/duplicate-billing.js';
import { refundStillActiveDetector } from './detectors/refund-still-active.js';
import { crossPlatformConflictDetector } from './detectors/cross-platform-conflict.js';
import { renewalAnomalyDetector } from './detectors/renewal-anomaly.js';
import { dataFreshnessDetector } from './detectors/data-freshness.js';
import { verifiedPaidNoAccessDetector } from './detectors/verified-paid-no-access.js';
import { verifiedAccessNoPaymentDetector } from './detectors/verified-access-no-payment.js';
import { dispatchAlert } from '../alerts/dispatcher.js';
import { notifyCxChannel } from '../slack/notifications.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('issue-detection');

/**
 * Issue Detection Engine
 *
 * Orchestrates all issue detectors and manages the lifecycle
 * of detected issues: creation, deduplication, and auto-resolution.
 *
 * Registry: 8 detectors total
 *   Tier 1 (Billing Only):
 *     P0: webhook_delivery_gap, duplicate_billing, unrevoked_refund
 *     P1: cross_platform_conflict, renewal_anomaly, data_freshness
 *   Tier 2 (App Verified):
 *     P0: verified_paid_no_access, verified_access_no_payment
 *
 * Demoted to internal (files kept for reference, not registered):
 *   payment_without_entitlement, entitlement_without_payment
 *
 * Removed (moved to analytics):
 *   trial_no_conversion, silent_renewal_failure, stale_subscription
 */
export class IssueDetectionEngine {
  private detectors: IssueDetector[];

  constructor(private db: Database) {
    this.detectors = [
      // Tier 1 — P0: Ship day 1
      webhookGapDetector,
      duplicateBillingDetector,
      refundStillActiveDetector,
      // Tier 1 — P1: Cross-platform and aggregate anomalies
      crossPlatformConflictDetector,
      renewalAnomalyDetector,
      dataFreshnessDetector,
      // Tier 2: App-verified (requires access-check integration)
      verifiedPaidNoAccessDetector,
      verifiedAccessNoPaymentDetector,
    ];
  }

  /**
   * Run all event-triggered detectors for a specific event.
   * Called in real-time from the ingestion pipeline.
   */
  async checkForIssues(
    orgId: string,
    userId: string,
    event: CanonicalEvent,
  ): Promise<void> {
    for (const detector of this.detectors) {
      try {
        const detected = await detector.checkEvent(this.db, orgId, userId, event);
        for (const issue of detected) {
          await this.createOrUpdateIssue(orgId, issue, detector.id);
        }
      } catch (err) {
        log.error(
          { err, detectorId: detector.id, eventId: event.id },
          'Detector failed',
        );
      }
    }
  }

  /**
   * Run all scheduled scan detectors.
   * Called periodically by a cron job.
   */
  async runScheduledScans(orgId: string): Promise<{ total: number; new: number }> {
    let total = 0;
    let newIssues = 0;

    for (const detector of this.detectors) {
      if (!detector.scheduledScan) continue;

      try {
        const detected = await detector.scheduledScan(this.db, orgId);
        total += detected.length;

        for (const issue of detected) {
          const created = await this.createOrUpdateIssue(orgId, issue, detector.id);
          if (created) newIssues++;
        }
      } catch (err) {
        log.error({ err, detectorId: detector.id }, 'Scheduled scan failed');
      }
    }

    log.info({ orgId, total, newIssues }, 'Scheduled scan completed');
    return { total, new: newIssues };
  }

  /**
   * Create a new issue or skip if a similar one already exists.
   * Returns true if a new issue was created.
   */
  private async createOrUpdateIssue(
    orgId: string,
    detected: DetectedIssue,
    detectorId: string,
  ): Promise<boolean> {
    // Deduplication: check for existing open issue of same type for same user
    if (detected.userId) {
      const existing = await this.db
        .select({ id: issues.id })
        .from(issues)
        .where(
          and(
            eq(issues.orgId, orgId),
            eq(issues.userId, detected.userId),
            eq(issues.issueType, detected.issueType),
            eq(issues.status, 'open'),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        log.debug(
          { issueType: detected.issueType, userId: detected.userId },
          'Duplicate issue, skipping',
        );
        return false;
      }
    }

    try {
      const [newIssue] = await this.db.insert(issues).values({
        orgId,
        userId: detected.userId,
        issueType: detected.issueType,
        severity: detected.severity,
        title: detected.title,
        description: detected.description,
        estimatedRevenueCents: detected.estimatedRevenueCents,
        confidence: detected.confidence,
        detectorId,
        detectionTier: detected.detectionTier || 'billing_only',
        evidence: detected.evidence,
      }).returning();

      log.info({
        issueType: detected.issueType,
        severity: detected.severity,
        userId: detected.userId,
        revenue: detected.estimatedRevenueCents,
      }, 'New issue detected');

      // Dispatch alert for the new issue (fire and forget — never block detection)
      dispatchAlert(this.db, orgId, newIssue as Issue).catch((err) => {
        log.error({ err, issueId: newIssue.id }, 'Failed to dispatch alert for new issue');
      });

      // Notify CX channel for critical/warning issues (fire and forget)
      notifyCxChannel(this.db, orgId, newIssue as Issue).catch((err) => {
        log.error({ err, issueId: newIssue.id }, 'Failed to notify CX channel');
      });

      return true;
    } catch (err: any) {
      // Handle race condition: if a duplicate was inserted between check and insert
      if (err.code === '23505') { // PostgreSQL unique violation
        log.debug(
          { issueType: detected.issueType, userId: detected.userId },
          'Duplicate issue (concurrent insert), skipping',
        );
        return false;
      }
      throw err;
    }
  }

  /**
   * Run a single detector's scheduled scan by detector ID.
   * Returns null if the detector doesn't exist or doesn't have a scheduled scan.
   */
  async runSingleDetectorScan(
    orgId: string,
    detectorId: string,
  ): Promise<{ total: number; new: number } | null> {
    const detector = this.detectors.find(d => d.id === detectorId);
    if (!detector || !detector.scheduledScan) return null;

    let total = 0;
    let newIssues = 0;

    try {
      const detected = await detector.scheduledScan(this.db, orgId);
      total = detected.length;

      for (const issue of detected) {
        const created = await this.createOrUpdateIssue(orgId, issue, detector.id);
        if (created) newIssues++;
      }
    } catch (err) {
      log.error({ err, detectorId: detector.id }, 'Single detector scan failed');
      throw err;
    }

    log.info({ orgId, detectorId, total, newIssues }, 'Single detector scan completed');
    return { total, new: newIssues };
  }

  /**
   * Get all registered detectors — used for the dashboard.
   */
  getDetectors() {
    return this.detectors.map(d => ({
      id: d.id,
      name: d.name,
      description: d.description,
      hasScheduledScan: !!d.scheduledScan,
    }));
  }
}
