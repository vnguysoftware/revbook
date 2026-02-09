import type { Database } from '../config/database.js';
import type { CanonicalEvent, DetectedIssue } from '../models/types.js';

/**
 * Base interface for all issue detectors.
 *
 * Each detector checks for a specific class of billing/entitlement
 * anomaly. Detectors are triggered after each event is processed
 * and can also run on a schedule for time-based checks.
 */
export interface IssueDetector {
  /** Unique identifier for this detector */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description of what this detector catches */
  description: string;

  /**
   * Check for issues triggered by a specific event.
   * Called in real-time as events are processed.
   */
  checkEvent(
    db: Database,
    orgId: string,
    userId: string,
    event: CanonicalEvent,
  ): Promise<DetectedIssue[]>;

  /**
   * Run a scheduled scan across all users/entitlements.
   * Called periodically (e.g., every 15 minutes) for time-based issues.
   */
  scheduledScan?(
    db: Database,
    orgId: string,
  ): Promise<DetectedIssue[]>;
}
