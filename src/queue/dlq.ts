import { Hono } from 'hono';
import { getQueue, QUEUE_NAMES } from '../config/queue.js';
import type { WebhookJobData } from './webhook-worker.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('dlq');

/**
 * Dead Letter Queue management routes.
 *
 * Events that fail processing after 3 attempts are kept in the
 * BullMQ failed state. These endpoints allow inspecting and retrying them.
 *
 * Routes (mounted under /api/v1/admin/dlq):
 *   GET    /         - List DLQ events with error details
 *   POST   /:id/retry - Retry a specific DLQ event
 *   POST   /retry-all - Retry all DLQ events
 */
export function createDlqRoutes() {
  const app = new Hono();

  // ── GET / — List DLQ (failed) jobs ──────────────────────────────────
  app.get('/', async (c) => {
    const queue = getQueue(QUEUE_NAMES.WEBHOOK_PROCESSING);
    const start = parseInt(c.req.query('offset') || '0');
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);

    const failedJobs = await queue.getFailed(start, start + limit - 1);
    const totalFailed = await queue.getFailedCount();

    const items = failedJobs.map((job) => {
      const data = job.data as WebhookJobData;
      return {
        id: job.id,
        orgId: data.orgId,
        source: data.source,
        webhookLogId: data.webhookLogId,
        receivedAt: data.receivedAt,
        attempts: job.attemptsMade,
        failedReason: job.failedReason,
        stacktrace: job.stacktrace?.slice(0, 3), // First 3 stack traces
        timestamp: job.timestamp,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
      };
    });

    return c.json({
      total: totalFailed,
      offset: start,
      limit,
      items,
    });
  });

  // ── POST /:id/retry — Retry a specific failed job ──────────────────
  app.post('/:id/retry', async (c) => {
    const jobId = c.req.param('id');
    const queue = getQueue(QUEUE_NAMES.WEBHOOK_PROCESSING);

    const job = await queue.getJob(jobId);
    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }

    const state = await job.getState();
    if (state !== 'failed') {
      return c.json({ error: `Job is in '${state}' state, not 'failed'` }, 400);
    }

    await job.retry();

    log.info({ jobId }, 'DLQ job retried');
    return c.json({ ok: true, jobId, message: 'Job re-queued for processing' });
  });

  // ── POST /retry-all — Retry all failed jobs ────────────────────────
  app.post('/retry-all', async (c) => {
    const queue = getQueue(QUEUE_NAMES.WEBHOOK_PROCESSING);
    const failedJobs = await queue.getFailed(0, -1);

    let retried = 0;
    let errors = 0;

    for (const job of failedJobs) {
      try {
        await job.retry();
        retried++;
      } catch (err: any) {
        log.error({ jobId: job.id, err: err.message }, 'Failed to retry DLQ job');
        errors++;
      }
    }

    log.info({ retried, errors, total: failedJobs.length }, 'DLQ retry-all completed');
    return c.json({
      ok: true,
      retried,
      errors,
      total: failedJobs.length,
    });
  });

  return app;
}
