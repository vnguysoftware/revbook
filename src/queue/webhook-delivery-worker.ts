import type { Job } from 'bullmq';
import { getDb } from '../config/database.js';
import { getQueue, createWorker, QUEUE_NAMES } from '../config/queue.js';
import { alertDeliveryLogs } from '../models/schema.js';
import type { Issue, WebhookAlertConfig, WebhookEventType } from '../models/types.js';
import { sendWebhookAlert } from '../alerts/webhook.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('webhook-delivery-worker');

// ─── Job Data Types ──────────────────────────────────────────────────

export interface WebhookDeliveryJobData {
  orgId: string;
  alertConfigId: string;
  issueId: string;
  issue: Issue;
  config: WebhookAlertConfig;
  eventType: WebhookEventType;
}

// ─── Enqueue Webhook Delivery ─────────────────────────────────────────

/**
 * Enqueue a webhook delivery job with retries and exponential backoff.
 */
export async function enqueueWebhookDelivery(data: WebhookDeliveryJobData): Promise<string> {
  const queue = getQueue(QUEUE_NAMES.WEBHOOK_DELIVERY);

  const job = await queue.add('deliver-webhook', data, {
    attempts: 7,
    backoff: {
      type: 'exponential',
      delay: 2000, // 2s, 4s, 8s, 16s, 32s, 64s, 128s
    },
  });

  log.info({
    jobId: job.id,
    orgId: data.orgId,
    alertConfigId: data.alertConfigId,
    issueId: data.issueId,
    eventType: data.eventType,
  }, 'Webhook delivery job enqueued');

  return job.id!;
}

// ─── Worker Processor ────────────────────────────────────────────────

async function processWebhookDelivery(job: Job<WebhookDeliveryJobData>): Promise<void> {
  const { orgId, alertConfigId, issueId, issue, config, eventType } = job.data;

  log.info({
    jobId: job.id,
    orgId,
    issueId,
    eventType,
    attempt: job.attemptsMade + 1,
  }, 'Processing webhook delivery');

  const db = getDb();
  const result = await sendWebhookAlert(config, issue, eventType);

  // Log the delivery attempt
  await db.insert(alertDeliveryLogs).values({
    orgId,
    alertConfigId,
    issueId,
    channel: 'webhook',
    status: result.success ? 'sent' : 'failed',
    errorMessage: result.error || null,
  }).catch((err) => {
    log.error({ err, alertConfigId }, 'Failed to log webhook delivery');
  });

  if (!result.success) {
    throw new Error(result.error || 'Webhook delivery failed');
  }

  log.info({ jobId: job.id, issueId, eventType }, 'Webhook delivery completed');
}

// ─── Start Worker ────────────────────────────────────────────────────

let _workerStarted = false;

/**
 * Start the webhook delivery worker.
 * Should be called once during server initialization.
 */
export function startWebhookDeliveryWorker(): void {
  if (_workerStarted) {
    log.warn('Webhook delivery worker already started');
    return;
  }

  createWorker<WebhookDeliveryJobData>(
    QUEUE_NAMES.WEBHOOK_DELIVERY,
    processWebhookDelivery,
    { concurrency: 10 },
  );

  _workerStarted = true;
  log.info('Webhook delivery worker started');
}
