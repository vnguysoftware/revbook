import type { Job } from 'bullmq';
import { getDb } from '../config/database.js';
import { getQueue, createWorker, QUEUE_NAMES } from '../config/queue.js';
import { IngestionPipeline } from '../ingestion/pipeline.js';
import type { BillingSource, RawWebhookEvent } from '../models/types.js';
import { webhookLogs } from '../models/schema.js';
import { eq } from 'drizzle-orm';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('webhook-worker');

// ─── Job Data Types ──────────────────────────────────────────────────

export interface WebhookJobData {
  orgId: string;
  source: BillingSource;
  rawPayload: string;          // The raw body string
  headers: Record<string, string>;
  webhookLogId: string;
  receivedAt: string;          // ISO string (jobs must be serializable)
}

export interface WebhookJobResult {
  processed: number;
  skipped: number;
  errors: string[];
}

// ─── Enqueue Webhook Job ─────────────────────────────────────────────

/**
 * Enqueue a webhook event for async processing.
 * Called from the webhook HTTP handler after signature verification.
 */
export async function enqueueWebhookJob(data: WebhookJobData): Promise<string> {
  const queue = getQueue(QUEUE_NAMES.WEBHOOK_PROCESSING);

  const job = await queue.add('process-webhook', data, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000, // 2s, 4s, 8s
    },
    // Use webhookLogId as deduplication key to prevent double-enqueue
    jobId: `webhook-${data.webhookLogId}`,
  });

  log.info({
    jobId: job.id,
    orgId: data.orgId,
    source: data.source,
    webhookLogId: data.webhookLogId,
  }, 'Webhook job enqueued');

  return job.id!;
}

// ─── Worker Processor ────────────────────────────────────────────────

/**
 * Process a single webhook job.
 * Reconstructs the RawWebhookEvent and feeds it through the IngestionPipeline.
 */
async function processWebhookJob(job: Job<WebhookJobData>): Promise<WebhookJobResult> {
  const { orgId, source, rawPayload, headers, webhookLogId, receivedAt } = job.data;

  log.info({
    jobId: job.id,
    orgId,
    source,
    webhookLogId,
    attempt: job.attemptsMade + 1,
  }, 'Processing webhook job');

  const db = getDb();
  const pipeline = new IngestionPipeline(db);

  // Update webhook log status to processing
  await db
    .update(webhookLogs)
    .set({ processingStatus: 'processing' })
    .where(eq(webhookLogs.id, webhookLogId));

  // Reconstruct the raw event
  const rawEvent: RawWebhookEvent = {
    source,
    headers,
    body: rawPayload,
    receivedAt: new Date(receivedAt),
  };

  try {
    // The pipeline handles: normalize -> identity resolve -> entitlement update -> detection
    // Note: The pipeline.processWebhook also logs the webhook, but since we already
    // created the webhook log entry at enqueue time, we use processWebhookFromQueue
    // which skips the initial webhook log creation.
    const result = await pipeline.processWebhookFromQueue(orgId, source, rawEvent, webhookLogId);

    log.info({
      jobId: job.id,
      webhookLogId,
      processed: result.processed,
      skipped: result.skipped,
      errors: result.errors.length,
    }, 'Webhook job completed');

    return result;
  } catch (err: any) {
    // Update webhook log with error
    await db
      .update(webhookLogs)
      .set({
        processingStatus: 'failed',
        errorMessage: err.message,
        processedAt: new Date(),
      })
      .where(eq(webhookLogs.id, webhookLogId));

    throw err; // Re-throw so BullMQ handles retries
  }
}

// ─── Start Worker ────────────────────────────────────────────────────

let _workerStarted = false;

/**
 * Start the webhook processing worker.
 * Should be called once during server initialization.
 */
export function startWebhookWorker(): void {
  if (_workerStarted) {
    log.warn('Webhook worker already started');
    return;
  }

  const worker = createWorker<WebhookJobData>(
    QUEUE_NAMES.WEBHOOK_PROCESSING,
    processWebhookJob,
    {
      concurrency: 5,
    },
  );

  // Handle final failure (moved to DLQ)
  worker.on('failed', async (job, err) => {
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      log.error({
        jobId: job.id,
        webhookLogId: job.data.webhookLogId,
        orgId: job.data.orgId,
        source: job.data.source,
        error: err.message,
        attempts: job.attemptsMade,
      }, 'Webhook job moved to DLQ after max retries');

      // Update webhook log to permanent failure
      try {
        const db = getDb();
        await db
          .update(webhookLogs)
          .set({
            processingStatus: 'dlq',
            errorMessage: `Failed after ${job.attemptsMade} attempts: ${err.message}`,
            processedAt: new Date(),
          })
          .where(eq(webhookLogs.id, job.data.webhookLogId));
      } catch (dbErr) {
        log.error({ err: dbErr }, 'Failed to update webhook log for DLQ');
      }
    }
  });

  _workerStarted = true;
  log.info('Webhook processing worker started');
}
