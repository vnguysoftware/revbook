import { getQueue, QUEUE_NAMES } from '../config/queue.js';
import { createChildLogger } from '../config/logger.js';
import type { ScanJobData } from './scan-worker.js';

const log = createChildLogger('scan-scheduler');

/**
 * Scan Schedule Configuration
 *
 * Each entry defines a repeatable BullMQ job that triggers a specific
 * detector scan on a cron schedule. All scheduled scans run across
 * all active organizations (orgId: 'all').
 */
const SCAN_SCHEDULES = [
  {
    name: 'webhook-gap-scan',
    detectorId: 'webhook_delivery_gap',
    // Every 15 minutes
    pattern: '*/15 * * * *',
    description: 'Check for webhook delivery gaps',
  },
  {
    name: 'silent-renewal-scan',
    detectorId: 'silent_renewal_failure',
    // Every hour at :05
    pattern: '5 * * * *',
    description: 'Check for silent renewal failures',
  },
  {
    name: 'access-no-payment-scan',
    detectorId: 'access_no_payment',
    // Every hour at :10
    pattern: '10 * * * *',
    description: 'Check for access without payment',
  },
  {
    name: 'paid-no-access-scan',
    detectorId: 'paid_no_access',
    // Every 30 minutes
    pattern: '*/30 * * * *',
    description: 'Check for paid but no access',
  },
  {
    name: 'cross-platform-mismatch-scan',
    detectorId: 'cross_platform_mismatch',
    // Every 6 hours at :15
    pattern: '15 */6 * * *',
    description: 'Check for cross-platform state mismatches',
  },
  {
    name: 'trial-no-conversion-scan',
    detectorId: 'trial_no_conversion',
    // Daily at midnight
    pattern: '0 0 * * *',
    description: 'Check for trials without conversion',
  },
  {
    name: 'stale-subscription-scan',
    detectorId: 'stale_subscription',
    // Daily at 2 AM
    pattern: '0 2 * * *',
    description: 'Check for stale subscriptions with no recent events',
  },
] as const;

/**
 * Register all repeatable scan jobs with BullMQ.
 *
 * This is idempotent — BullMQ uses the repeat key to deduplicate,
 * so calling this multiple times won't create duplicate schedules.
 *
 * Graceful degradation: if Redis is unavailable, this logs a warning
 * and returns without throwing.
 */
export async function startScanScheduler(): Promise<void> {
  try {
    const queue = getQueue(QUEUE_NAMES.SCHEDULED_SCANS);

    // Remove any previously-registered repeatable jobs that are no longer in the schedule
    const existingRepeatables = await queue.getRepeatableJobs();
    const currentNames = new Set<string>(SCAN_SCHEDULES.map(s => s.name));

    for (const existing of existingRepeatables) {
      if (!currentNames.has(existing.name)) {
        await queue.removeRepeatableByKey(existing.key);
        log.info({ name: existing.name }, 'Removed stale repeatable job');
      }
    }

    // Register all scan schedules
    for (const schedule of SCAN_SCHEDULES) {
      const jobData: ScanJobData = {
        detectorId: schedule.detectorId,
        orgId: 'all',
        scheduledAt: new Date().toISOString(),
      };

      await queue.add(schedule.name, jobData, {
        repeat: {
          pattern: schedule.pattern,
        },
        removeOnComplete: {
          age: 24 * 3600, // Keep completed scan results for 24 hours
          count: 100,
        },
        removeOnFail: {
          age: 7 * 24 * 3600, // Keep failed scans for 7 days
          count: 500,
        },
      });

      log.info({
        name: schedule.name,
        detectorId: schedule.detectorId,
        cron: schedule.pattern,
      }, `Scheduled: ${schedule.description}`);
    }

    log.info({
      totalSchedules: SCAN_SCHEDULES.length,
    }, 'All scan schedules registered');

  } catch (err) {
    log.error({ err }, 'Failed to start scan scheduler — scans will not run. Is Redis available?');
  }
}

/**
 * Trigger a scan immediately (outside of the normal schedule).
 * Used for manual triggers during onboarding or debugging.
 */
export async function triggerScanNow(
  detectorId: string,
  orgId: string,
): Promise<string> {
  const queue = getQueue(QUEUE_NAMES.SCHEDULED_SCANS);

  const jobData: ScanJobData = {
    detectorId,
    orgId,
    scheduledAt: new Date().toISOString(),
  };

  const job = await queue.add(`manual-${detectorId}`, jobData, {
    // Manual triggers get slightly higher priority (lower number = higher priority)
    priority: 1,
    removeOnComplete: {
      age: 24 * 3600,
      count: 100,
    },
  });

  log.info({
    jobId: job.id,
    detectorId,
    orgId,
  }, 'Manual scan triggered');

  return job.id!;
}

/**
 * Get all registered scan schedules for display/API.
 */
export function getScanSchedules() {
  return SCAN_SCHEDULES.map(s => ({
    name: s.name,
    detectorId: s.detectorId,
    cron: s.pattern,
    description: s.description,
  }));
}
