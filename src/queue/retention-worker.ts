import { lt, sql } from 'drizzle-orm';
import { getDb } from '../config/database.js';
import { getQueue, createWorker, QUEUE_NAMES } from '../config/queue.js';
import { webhookLogs, canonicalEvents } from '../models/schema.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('retention-worker');

const BATCH_SIZE = 1000;

/**
 * Data retention worker.
 * - Deletes webhook_logs older than 90 days
 * - NULLs canonical_events.rawPayload older than 2 years
 * Runs daily at 3 AM UTC.
 */

async function processRetention(): Promise<{ webhookLogsDeleted: number; payloadsCleared: number }> {
  const db = getDb();
  let webhookLogsDeleted = 0;
  let payloadsCleared = 0;

  // 1. Delete old webhook logs (90 days)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  while (true) {
    const deleted = await db
      .delete(webhookLogs)
      .where(lt(webhookLogs.createdAt, ninetyDaysAgo))
      .returning({ id: webhookLogs.id });
    webhookLogsDeleted += deleted.length;
    if (deleted.length < BATCH_SIZE) break;
  }

  // 2. Clear old raw payloads (2 years)
  const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000);
  while (true) {
    const result = await db.execute(sql`
      UPDATE canonical_events
      SET raw_payload = NULL
      WHERE id IN (
        SELECT id FROM canonical_events
        WHERE created_at < ${twoYearsAgo}
        AND raw_payload IS NOT NULL
        LIMIT ${BATCH_SIZE}
      )
    `);
    const count = Number((result as unknown as { rowCount?: number }).rowCount ?? 0);
    payloadsCleared += count;
    if (count < BATCH_SIZE) break;
  }

  return { webhookLogsDeleted, payloadsCleared };
}

export function startRetentionWorker(): void {
  createWorker(
    QUEUE_NAMES.DATA_RETENTION,
    async (job) => {
      log.info({ jobId: job.id }, 'Starting data retention cleanup');
      const result = await processRetention();
      log.info(result, 'Data retention cleanup complete');
      return result;
    },
    { concurrency: 1 },
  );

  log.info('Data retention worker started');
}

export async function startRetentionScheduler(): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.DATA_RETENTION);

  // Remove existing repeatable jobs to avoid duplicates
  const existing = await queue.getRepeatableJobs();
  for (const job of existing) {
    await queue.removeRepeatableByKey(job.key);
  }

  // Schedule daily at 3 AM UTC
  await queue.add(
    'retention-cleanup',
    {},
    {
      repeat: { pattern: '0 3 * * *' },
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 30 },
    },
  );

  log.info('Data retention scheduler configured (daily at 3 AM UTC)');
}
