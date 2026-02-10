import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { createChildLogger } from './logger.js';

const log = createChildLogger('queue-config');

// ─── Queue Names ──────────────────────────────────────────────────────

export const QUEUE_NAMES = {
  WEBHOOK_PROCESSING: 'webhook-processing',
  SCHEDULED_SCANS: 'scheduled-scans',
  BACKFILL_IMPORT: 'backfill-import',
  AI_INVESTIGATION: 'ai-investigation',
  WEBHOOK_DELIVERY: 'webhook-delivery',
  DATA_RETENTION: 'data-retention',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ─── Redis Connection ─────────────────────────────────────────────────

let _connection: IORedis | null = null;

export function getRedisConnection(redisUrl?: string): IORedis {
  if (!_connection) {
    const url = redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';
    _connection = new IORedis(url, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
      retryStrategy(times: number) {
        const delay = Math.min(times * 200, 5000);
        log.warn({ attempt: times, delayMs: delay }, 'Redis reconnecting');
        return delay;
      },
    });

    _connection.on('connect', () => {
      log.info('Redis connected');
    });

    _connection.on('error', (err) => {
      log.error({ err }, 'Redis connection error');
    });

    _connection.on('close', () => {
      log.warn('Redis connection closed');
    });
  }
  return _connection;
}

// ─── Queue Instances ──────────────────────────────────────────────────

const _queues = new Map<string, Queue>();

export function getQueue(name: QueueName): Queue {
  if (!_queues.has(name)) {
    const connection = getRedisConnection();
    const queue = new Queue(name, {
      connection,
      defaultJobOptions: {
        removeOnComplete: {
          age: 24 * 3600, // Keep completed jobs for 24 hours
          count: 10000,   // Keep max 10k completed jobs
        },
        removeOnFail: false, // Keep failed jobs for DLQ inspection
      },
    });
    _queues.set(name, queue);
    log.info({ queue: name }, 'Queue instance created');
  }
  return _queues.get(name)!;
}

// ─── Queue Events (for monitoring) ───────────────────────────────────

const _queueEvents = new Map<string, QueueEvents>();

export function getQueueEvents(name: QueueName): QueueEvents {
  if (!_queueEvents.has(name)) {
    const connection = getRedisConnection();
    const events = new QueueEvents(name, { connection });
    _queueEvents.set(name, events);
  }
  return _queueEvents.get(name)!;
}

// ─── Worker Factory ──────────────────────────────────────────────────

const _workers: Worker[] = [];

export function createWorker<T>(
  name: QueueName,
  processor: (job: import('bullmq').Job<T>) => Promise<unknown>,
  opts?: Partial<import('bullmq').WorkerOptions>,
): Worker<T> {
  const connection = getRedisConnection();
  const worker = new Worker<T>(name, processor, {
    connection,
    concurrency: 5,
    ...opts,
  });

  worker.on('completed', (job) => {
    log.debug({ jobId: job?.id, queue: name }, 'Job completed');
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, queue: name, err: err.message }, 'Job failed');
  });

  worker.on('error', (err) => {
    log.error({ queue: name, err }, 'Worker error');
  });

  _workers.push(worker);
  log.info({ queue: name, concurrency: opts?.concurrency ?? 5 }, 'Worker created');
  return worker;
}

// ─── Graceful Shutdown ───────────────────────────────────────────────

export async function closeAllQueues(): Promise<void> {
  log.info('Closing all queue resources...');

  // Close workers first (drain active jobs)
  for (const worker of _workers) {
    try {
      await worker.close();
    } catch (err) {
      log.error({ err }, 'Error closing worker');
    }
  }
  _workers.length = 0;

  // Close queue event listeners
  for (const [, events] of _queueEvents) {
    try {
      await events.close();
    } catch (err) {
      log.error({ err }, 'Error closing queue events');
    }
  }
  _queueEvents.clear();

  // Close queues
  for (const [, queue] of _queues) {
    try {
      await queue.close();
    } catch (err) {
      log.error({ err }, 'Error closing queue');
    }
  }
  _queues.clear();

  // Close Redis connection
  if (_connection) {
    try {
      await _connection.quit();
    } catch (err) {
      log.error({ err }, 'Error closing Redis connection');
    }
    _connection = null;
  }

  log.info('All queue resources closed');
}
