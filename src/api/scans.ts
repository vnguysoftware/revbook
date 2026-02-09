import { Hono } from 'hono';
import type { Database } from '../config/database.js';
import type { AuthContext } from '../middleware/auth.js';
import { triggerScanNow, getScanSchedules } from '../queue/scan-scheduler.js';
import { getQueue, QUEUE_NAMES } from '../config/queue.js';
import { IssueDetectionEngine } from '../detection/engine.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('scan-api');

/**
 * Scan management API routes.
 *
 * Routes (mounted under /api/v1/admin/scans):
 *   POST /trigger    - Trigger a specific scan immediately
 *   GET  /history    - Show recent scan results
 *   GET  /schedules  - Show all configured scan schedules
 */
export function createScanRoutes(db: Database) {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();

  // ── POST /trigger — Trigger a scan immediately ──────────────────────
  app.post('/trigger', async (c) => {
    const { orgId } = c.get('auth');

    let body: { detectorId?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const detectorId = body.detectorId || 'all';

    // Validate detector exists if a specific one was requested
    if (detectorId !== 'all') {
      const engine = new IssueDetectionEngine(db);
      const detectors = engine.getDetectors();
      const found = detectors.find(d => d.id === detectorId);

      if (!found) {
        return c.json({
          error: 'Unknown detector',
          message: `Detector "${detectorId}" not found. Available detectors: ${detectors.map(d => d.id).join(', ')}`,
        }, 400);
      }

      if (!found.hasScheduledScan) {
        return c.json({
          error: 'Detector has no scheduled scan',
          message: `Detector "${detectorId}" does not have a scheduledScan method. It only runs in response to events.`,
        }, 400);
      }
    }

    try {
      const jobId = await triggerScanNow(detectorId, orgId);

      log.info({ orgId, detectorId, jobId }, 'Manual scan triggered via API');

      return c.json({
        ok: true,
        jobId,
        detectorId,
        orgId,
        message: `Scan job queued. Check /admin/scans/history for results.`,
      });
    } catch (err: any) {
      log.error({ err, orgId, detectorId }, 'Failed to trigger scan');
      return c.json({
        error: 'Failed to trigger scan',
        message: err.message,
      }, 500);
    }
  });

  // ── GET /history — Recent scan results ──────────────────────────────
  app.get('/history', async (c) => {
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);

    try {
      const queue = getQueue(QUEUE_NAMES.SCHEDULED_SCANS);

      // Get recent completed scans
      const completedJobs = await queue.getCompleted(0, limit - 1);
      // Get recent failed scans
      const failedJobs = await queue.getFailed(0, Math.min(limit, 20) - 1);
      // Get currently active scans
      const activeJobs = await queue.getActive(0, 9);
      // Get waiting scans
      const waitingJobs = await queue.getWaiting(0, 9);

      const completed = completedJobs.map(job => ({
        id: job.id,
        name: job.name,
        detectorId: job.data?.detectorId,
        orgId: job.data?.orgId,
        status: 'completed' as const,
        result: job.returnvalue,
        scheduledAt: job.data?.scheduledAt,
        processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
        finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
        duration: job.processedOn && job.finishedOn
          ? job.finishedOn - job.processedOn
          : null,
      }));

      const failed = failedJobs.map(job => ({
        id: job.id,
        name: job.name,
        detectorId: job.data?.detectorId,
        orgId: job.data?.orgId,
        status: 'failed' as const,
        error: job.failedReason,
        attempts: job.attemptsMade,
        scheduledAt: job.data?.scheduledAt,
        processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
        finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
      }));

      const active = activeJobs.map(job => ({
        id: job.id,
        name: job.name,
        detectorId: job.data?.detectorId,
        orgId: job.data?.orgId,
        status: 'active' as const,
        scheduledAt: job.data?.scheduledAt,
        processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
      }));

      const waiting = waitingJobs.map(job => ({
        id: job.id,
        name: job.name,
        detectorId: job.data?.detectorId,
        orgId: job.data?.orgId,
        status: 'waiting' as const,
        scheduledAt: job.data?.scheduledAt,
      }));

      // Get repeatable job info for next run times
      const repeatableJobs = await queue.getRepeatableJobs();
      const nextRuns = repeatableJobs.map(job => ({
        name: job.name,
        pattern: job.pattern,
        next: job.next ? new Date(job.next).toISOString() : null,
      }));

      return c.json({
        active,
        waiting,
        completed,
        failed,
        nextScheduledRuns: nextRuns,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      log.error({ err }, 'Failed to get scan history');
      return c.json({
        error: 'Failed to get scan history',
        message: err.message,
      }, 500);
    }
  });

  // ── GET /schedules — List all configured scan schedules ─────────────
  app.get('/schedules', async (c) => {
    const schedules = getScanSchedules();

    // Also get info about available detectors with scheduled scans
    const engine = new IssueDetectionEngine(db);
    const detectors = engine.getDetectors().filter(d => d.hasScheduledScan);

    return c.json({
      schedules,
      detectors,
    });
  });

  return app;
}
