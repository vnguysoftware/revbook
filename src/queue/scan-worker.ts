import type { Job } from 'bullmq';
import { getDb } from '../config/database.js';
import { createWorker, QUEUE_NAMES } from '../config/queue.js';
import { IssueDetectionEngine } from '../detection/engine.js';
import { organizations } from '../models/schema.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('scan-worker');

// ─── Job Data Types ──────────────────────────────────────────────────

export interface ScanJobData {
  /** Which detector to run, or 'all' for all detectors */
  detectorId: string;
  /** Specific org to scan, or 'all' to scan every active org */
  orgId: string;
  /** When this scan was scheduled (ISO string) */
  scheduledAt: string;
}

export interface ScanJobResult {
  orgId: string;
  detectorId: string;
  total: number;
  new: number;
  durationMs: number;
  completedAt: string;
}

// ─── Worker Processor ────────────────────────────────────────────────

async function processScanJob(job: Job<ScanJobData>): Promise<ScanJobResult[]> {
  const { detectorId, orgId, scheduledAt } = job.data;
  const startTime = Date.now();

  log.info({
    jobId: job.id,
    detectorId,
    orgId,
    scheduledAt,
  }, 'Processing scan job');

  const db = getDb();
  const engine = new IssueDetectionEngine(db);
  const results: ScanJobResult[] = [];

  // Determine which orgs to scan
  const orgIds = await resolveOrgIds(orgId);

  if (orgIds.length === 0) {
    log.warn({ orgId }, 'No organizations found to scan');
    return results;
  }

  for (const currentOrgId of orgIds) {
    const orgStart = Date.now();

    try {
      let scanResult: { total: number; new: number };

      if (detectorId === 'all') {
        scanResult = await engine.runScheduledScans(currentOrgId);
      } else {
        const singleResult = await engine.runSingleDetectorScan(currentOrgId, detectorId);
        if (!singleResult) {
          log.warn({ detectorId, orgId: currentOrgId }, 'Detector not found or has no scheduled scan');
          continue;
        }
        scanResult = singleResult;
      }

      const durationMs = Date.now() - orgStart;

      const result: ScanJobResult = {
        orgId: currentOrgId,
        detectorId,
        total: scanResult.total,
        new: scanResult.new,
        durationMs,
        completedAt: new Date().toISOString(),
      };

      results.push(result);

      log.info({
        orgId: currentOrgId,
        detectorId,
        total: scanResult.total,
        newIssues: scanResult.new,
        durationMs,
      }, 'Scan completed for org');

    } catch (err) {
      log.error({
        err,
        orgId: currentOrgId,
        detectorId,
      }, 'Scan failed for org');
    }
  }

  const totalDuration = Date.now() - startTime;
  log.info({
    jobId: job.id,
    detectorId,
    orgsScanned: results.length,
    totalDurationMs: totalDuration,
  }, 'Scan job completed');

  return results;
}

/**
 * Resolve 'all' orgId to a list of all active org IDs,
 * or return the single orgId as an array.
 */
async function resolveOrgIds(orgId: string): Promise<string[]> {
  if (orgId !== 'all') {
    return [orgId];
  }

  const db = getDb();
  const orgs = await db.select({ id: organizations.id }).from(organizations);
  return orgs.map(o => o.id);
}

// ─── Start Worker ────────────────────────────────────────────────────

let _workerStarted = false;

/**
 * Start the scheduled scan processing worker.
 * Should be called once during server initialization.
 */
export function startScanWorker(): void {
  if (_workerStarted) {
    log.warn('Scan worker already started');
    return;
  }

  createWorker<ScanJobData>(
    QUEUE_NAMES.SCHEDULED_SCANS,
    processScanJob,
    {
      // Scans can be CPU/DB intensive; run only 2 at a time
      concurrency: 2,
    },
  );

  _workerStarted = true;
  log.info('Scheduled scan worker started');
}
