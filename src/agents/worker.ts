import type { Job } from 'bullmq';
import { getDb } from '../config/database.js';
import { QUEUE_NAMES, createWorker, getQueue } from '../config/queue.js';
import { investigateIssue } from './investigator.js';
import { isAiEnabled } from './client.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('ai-worker');

// ─── Job Types ──────────────────────────────────────────────────────

interface InvestigationJob {
  type: 'investigate';
  orgId: string;
  issueId: string;
}

interface GroupingJob {
  type: 'group_incidents';
  orgId: string;
}

type AiJob = InvestigationJob | GroupingJob;

// ─── Worker ─────────────────────────────────────────────────────────

/**
 * Start the AI investigation worker.
 * Processes AI jobs asynchronously via BullMQ so API endpoints
 * can return immediately without blocking on Claude API calls.
 */
export function startAiWorker(): void {
  if (!isAiEnabled()) {
    log.info('AI features not configured — AI worker not started');
    return;
  }

  createWorker<AiJob>(
    QUEUE_NAMES.AI_INVESTIGATION,
    async (job: Job<AiJob>) => {
      const { data } = job;

      switch (data.type) {
        case 'investigate':
          log.info({ issueId: data.issueId }, 'Processing AI investigation job');
          const result = await investigateIssue(getDb(), data.orgId, data.issueId);
          if (result) {
            log.info(
              { issueId: data.issueId, confidence: result.confidence },
              'AI investigation completed',
            );
          }
          return result;

        case 'group_incidents':
          log.info({ orgId: data.orgId }, 'Processing incident grouping job');
          // Import dynamically to avoid circular dependency
          const { findIncidentClusters } = await import('./grouper.js');
          const clusters = await findIncidentClusters(getDb(), data.orgId);
          log.info(
            { orgId: data.orgId, clusterCount: clusters.length },
            'Incident grouping completed',
          );
          return clusters;

        default:
          log.warn({ type: (data as any).type }, 'Unknown AI job type');
      }
    },
    {
      concurrency: 2, // Limit concurrent AI calls
      limiter: {
        max: 10,
        duration: 60000, // Max 10 jobs per minute to avoid rate limits
      },
    },
  );

  log.info('AI investigation worker started');
}

// ─── Job Enqueue Helpers ────────────────────────────────────────────

/**
 * Enqueue an AI investigation job. Returns the job ID.
 * The investigation runs asynchronously — the API can poll for results.
 */
export async function enqueueInvestigation(
  orgId: string,
  issueId: string,
): Promise<string | null> {
  if (!isAiEnabled()) {
    return null;
  }

  const queue = getQueue(QUEUE_NAMES.AI_INVESTIGATION);
  const job = await queue.add(
    'investigate',
    { type: 'investigate', orgId, issueId },
    {
      jobId: `investigate-${issueId}`,
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 3600 }, // Keep for 1 hour
    },
  );

  log.info({ issueId, jobId: job.id }, 'Investigation job enqueued');
  return job.id ?? null;
}

/**
 * Enqueue an incident grouping job.
 */
export async function enqueueGrouping(orgId: string): Promise<string | null> {
  if (!isAiEnabled()) {
    return null;
  }

  const queue = getQueue(QUEUE_NAMES.AI_INVESTIGATION);
  const job = await queue.add(
    'group_incidents',
    { type: 'group_incidents', orgId },
    {
      jobId: `group-${orgId}-${Date.now()}`,
      attempts: 1,
      removeOnComplete: { age: 3600 },
    },
  );

  log.info({ orgId, jobId: job.id }, 'Grouping job enqueued');
  return job.id ?? null;
}
