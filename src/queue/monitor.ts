import { Hono } from 'hono';
import { getQueue, QUEUE_NAMES, type QueueName } from '../config/queue.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('queue-monitor');

/**
 * Queue monitoring routes.
 *
 * Provides real-time health metrics for all queues.
 *
 * Routes (mounted under /api/v1/admin/queues):
 *   GET /  - Return health overview for all queues
 */
export function createQueueMonitorRoutes() {
  const app = new Hono();

  // ── GET / — Queue health overview ──────────────────────────────────
  app.get('/', async (c) => {
    const queueNames = Object.values(QUEUE_NAMES) as QueueName[];
    const health: Record<string, unknown> = {};

    for (const name of queueNames) {
      try {
        health[name] = await getQueueHealth(name);
      } catch (err: any) {
        log.error({ queue: name, err: err.message }, 'Failed to get queue health');
        health[name] = { error: err.message };
      }
    }

    return c.json({ queues: health, timestamp: new Date().toISOString() });
  });

  return app;
}

/**
 * Get health metrics for a single queue.
 */
async function getQueueHealth(name: QueueName): Promise<Record<string, unknown>> {
  const queue = getQueue(name);

  // Get job counts by state
  const counts = await queue.getJobCounts(
    'waiting',
    'active',
    'completed',
    'failed',
    'delayed',
    'paused',
  );

  // Get oldest waiting job age
  let oldestWaitingAgeMs: number | null = null;
  const waitingJobs = await queue.getWaiting(0, 0); // Just the first (oldest) one
  if (waitingJobs.length > 0) {
    const oldest = waitingJobs[0];
    oldestWaitingAgeMs = Date.now() - (oldest.timestamp || Date.now());
  }

  // Calculate processing rate from completed jobs in the last minute
  const completedJobs = await queue.getCompleted(0, 99);
  const oneMinuteAgo = Date.now() - 60_000;
  const recentCompleted = completedJobs.filter(
    (job) => job.finishedOn && job.finishedOn > oneMinuteAgo,
  );
  const processingRatePerMinute = recentCompleted.length;

  // Calculate average processing time from recent completed jobs
  let avgProcessingTimeMs: number | null = null;
  if (recentCompleted.length > 0) {
    const totalProcessingTime = recentCompleted.reduce((sum, job) => {
      const processingTime =
        (job.finishedOn || Date.now()) - (job.processedOn || job.timestamp || Date.now());
      return sum + processingTime;
    }, 0);
    avgProcessingTimeMs = Math.round(totalProcessingTime / recentCompleted.length);
  }

  return {
    name,
    counts: {
      waiting: counts.waiting,
      active: counts.active,
      completed: counts.completed,
      failed: counts.failed,
      delayed: counts.delayed,
      paused: counts.paused,
    },
    metrics: {
      processingRatePerMinute,
      avgProcessingTimeMs,
      oldestWaitingAgeMs,
    },
  };
}
