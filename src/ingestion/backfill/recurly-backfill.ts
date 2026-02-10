import { eq, and } from 'drizzle-orm';
import Redis from 'ioredis';
import type { Database } from '../../config/database.js';
import { billingConnections } from '../../models/schema.js';
import { IngestionPipeline } from '../pipeline.js';
import type { RawWebhookEvent } from '../../models/types.js';
import { readCredentials } from '../../security/credentials.js';
import { createChildLogger } from '../../config/logger.js';
import { CircuitBreaker } from '../../security/circuit-breaker.js';
import type { BackfillProgress, BackfillResult } from './stripe-backfill.js';

const log = createChildLogger('recurly-backfill');

/** Circuit breaker for Recurly API calls during backfill. */
const recurlyBackfillBreaker = new CircuitBreaker('recurly-backfill-api', {
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
  halfOpenMaxAttempts: 3,
});

const RECURLY_BASE_URL = 'https://v3.recurly.com';
const RECURLY_API_VERSION = 'application/vnd.recurly.v2021-02-25+json';

/**
 * Recurly Historical Backfill
 *
 * Pulls historical subscription data from Recurly API v3 immediately
 * after connection setup. For each subscription, a synthetic webhook-like
 * event is constructed and fed through the trusted ingestion pipeline.
 *
 * Progress is tracked in Redis so the frontend can poll for updates.
 *
 * MVP scope: subscription backfill only (no event history phase).
 */

/** Redis key for backfill progress */
function progressKey(orgId: string): string {
  return `backfill:recurly:${orgId}`;
}

/** Recurly subscription shape (subset of fields we need). */
interface RecurlySubscription {
  uuid: string;
  state: string;
  plan: { code: string; name: string };
  account: { code: string; email: string };
  unit_amount: number;
  currency: string;
  current_period_started_at: string;
  current_period_ends_at: string;
  trial_started_at: string | null;
  trial_ends_at: string | null;
}

/** Recurly list API response envelope. */
interface RecurlyListResponse<T> {
  has_more: boolean;
  data: T[];
  next: string | null;
}

export class RecurlyBackfill {
  private pipeline: IngestionPipeline;
  private redis: Redis | null = null;

  constructor(private db: Database) {
    this.pipeline = new IngestionPipeline(db);
  }

  /**
   * Connect to Redis for progress tracking.
   * Falls back gracefully if Redis is not available.
   */
  private async getRedis(): Promise<Redis | null> {
    if (this.redis) return this.redis;
    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      this.redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
      await this.redis.connect();
      return this.redis;
    } catch (err) {
      log.warn({ err }, 'Redis not available, progress tracking disabled');
      return null;
    }
  }

  /**
   * Update progress in Redis. Expires after 24 hours.
   */
  private async updateProgress(orgId: string, progress: Partial<BackfillProgress>): Promise<void> {
    const redis = await this.getRedis();
    if (!redis) return;

    try {
      const key = progressKey(orgId);
      const existing = await redis.get(key);
      const current: BackfillProgress = existing
        ? JSON.parse(existing)
        : {
            status: 'queued',
            phase: 'Initializing',
            totalCustomers: 0,
            importedCustomers: 0,
            totalEvents: 0,
            importedEvents: 0,
            eventsCreated: 0,
            issuesFound: 0,
            errors: [],
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            completedAt: null,
            estimatedSecondsRemaining: null,
            processingRatePerSecond: 0,
          };

      const updated = { ...current, ...progress, updatedAt: new Date().toISOString() };

      // Calculate estimated time remaining
      if (updated.status === 'importing_subscriptions' && updated.importedCustomers > 0) {
        const elapsed = (Date.now() - new Date(updated.startedAt).getTime()) / 1000;
        const rate = updated.importedCustomers / elapsed;
        updated.processingRatePerSecond = Math.round(rate * 10) / 10;
        const remaining = updated.totalCustomers - updated.importedCustomers;
        updated.estimatedSecondsRemaining = Math.round(remaining / Math.max(rate, 0.1));
      }

      await redis.set(key, JSON.stringify(updated), 'EX', 86400); // 24h TTL
    } catch (err) {
      log.warn({ err }, 'Failed to update backfill progress');
    }
  }

  /**
   * Get current progress from Redis.
   */
  static async getProgress(orgId: string): Promise<BackfillProgress | null> {
    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
      await redis.connect();
      const key = progressKey(orgId);
      const data = await redis.get(key);
      await redis.quit();
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  /**
   * Make an authenticated request to the Recurly API v3.
   */
  private async recurlyFetch<T>(apiKey: string, path: string): Promise<T> {
    const url = path.startsWith('https://') ? path : `${RECURLY_BASE_URL}${path}`;
    const auth = Buffer.from(`${apiKey}:`).toString('base64');

    const response = await fetch(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': RECURLY_API_VERSION,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Recurly API error ${response.status}: ${body}`);
    }

    return response.json() as Promise<T>;
  }

  async run(orgId: string): Promise<BackfillResult> {
    const result: BackfillResult = {
      subscriptionsProcessed: 0,
      eventsProcessed: 0,
      errors: [],
      durationMs: 0,
    };

    const startTime = Date.now();
    const runId = Date.now().toString(36);
    const lockKey = `backfill-lock:recurly:${orgId}`;

    // Acquire a Redis-based lock to prevent concurrent backfills for the same org
    const redis = await this.getRedis();
    if (redis) {
      const acquired = await redis.set(lockKey, Date.now().toString(), 'EX', 3600, 'NX');
      if (!acquired) {
        throw new Error('Recurly backfill already in progress for this organization');
      }
    }

    try {
      await this.updateProgress(orgId, {
        status: 'counting',
        phase: 'Connecting to Recurly and counting records...',
        startedAt: new Date().toISOString(),
      });

      // Get Recurly credentials
      const [conn] = await this.db
        .select()
        .from(billingConnections)
        .where(
          and(
            eq(billingConnections.orgId, orgId),
            eq(billingConnections.source, 'recurly'),
          ),
        )
        .limit(1);

      if (!conn) {
        await this.updateProgress(orgId, {
          status: 'failed',
          phase: 'Recurly not connected',
          errors: ['Recurly not connected'],
        });
        throw new Error('Recurly not connected');
      }

      const creds = readCredentials<{ apiKey: string }>(conn.credentials);

      try {
        // Phase 0: Estimate subscription count
        log.info({ orgId }, 'Counting Recurly subscriptions');
        let totalSubs = 0;
        try {
          const countResult = await recurlyBackfillBreaker.execute(() =>
            this.recurlyFetch<RecurlyListResponse<RecurlySubscription>>(
              creds.apiKey,
              '/subscriptions?state=all&limit=1&order=asc&sort=created_at',
            ),
          );
          totalSubs = countResult.data.length;
          if (countResult.has_more) {
            totalSubs = 1000; // Start with estimate, refine as we go
          }
        } catch {
          totalSubs = 0;
        }

        await this.updateProgress(orgId, {
          status: 'importing_subscriptions',
          phase: 'Importing subscriptions from Recurly...',
          totalCustomers: totalSubs,
        });

        // Phase 1: Backfill subscriptions
        log.info({ orgId }, 'Starting Recurly subscription backfill');
        await this.backfillSubscriptions(orgId, creds.apiKey, result, runId);

        // No Phase 2 for Recurly MVP (events API differs from Stripe's)

        // Update sync status
        await this.db
          .update(billingConnections)
          .set({
            lastSyncAt: new Date(),
            syncStatus: 'completed',
          })
          .where(eq(billingConnections.id, conn.id));

        await this.updateProgress(orgId, {
          status: 'completed',
          phase: 'Import complete',
          importedCustomers: result.subscriptionsProcessed,
          totalCustomers: result.subscriptionsProcessed,
          completedAt: new Date().toISOString(),
          estimatedSecondsRemaining: 0,
        });
      } catch (err: any) {
        log.error({ err, orgId }, 'Recurly backfill failed');
        result.errors.push(err.message);

        await this.db
          .update(billingConnections)
          .set({ syncStatus: 'failed' })
          .where(eq(billingConnections.id, conn.id));

        await this.updateProgress(orgId, {
          status: 'failed',
          phase: `Failed: ${err.message}`,
          errors: result.errors,
        });
      }

      result.durationMs = Date.now() - startTime;
      log.info({
        orgId,
        ...result,
      }, 'Recurly backfill completed');
    } finally {
      // Release the backfill lock
      if (redis) {
        await redis.del(lockKey).catch(() => {});
      }

      // Clean up Redis connection
      if (this.redis) {
        await this.redis.quit().catch(() => {});
      }
    }

    return result;
  }

  private async backfillSubscriptions(
    orgId: string,
    apiKey: string,
    result: BackfillResult,
    runId: string,
  ) {
    let nextPath: string | null = '/subscriptions?state=all&limit=200&order=asc&sort=created_at';

    while (nextPath) {
      const response = await recurlyBackfillBreaker.execute(() =>
        this.recurlyFetch<RecurlyListResponse<RecurlySubscription>>(apiKey, nextPath!),
      );

      for (const sub of response.data) {
        try {
          // Synthesize a webhook-like payload for the RecurlyNormalizer
          const syntheticPayload = {
            id: `backfill_sub_${sub.uuid}_${runId}`,
            object_type: 'subscription',
            event_type: sub.state === 'active' || sub.state === 'live' ? 'created' : 'expired',
            account: {
              code: sub.account?.code,
              email: sub.account?.email,
            },
            subscription: {
              uuid: sub.uuid,
              plan: sub.plan,
              state: sub.state,
              unit_amount_in_cents: sub.unit_amount,
              currency: sub.currency,
              current_period_started_at: sub.current_period_started_at,
              current_period_ends_at: sub.current_period_ends_at,
              trial_started_at: sub.trial_started_at,
              trial_ends_at: sub.trial_ends_at,
            },
          };

          const rawEvent: RawWebhookEvent = {
            source: 'recurly',
            headers: {},
            body: JSON.stringify(syntheticPayload),
            receivedAt: new Date(),
          };

          await this.pipeline.processTrustedWebhook(orgId, 'recurly', rawEvent);
          result.subscriptionsProcessed++;

          // Update progress every 10 subscriptions to avoid Redis spam
          if (result.subscriptionsProcessed % 10 === 0) {
            await this.updateProgress(orgId, {
              importedCustomers: result.subscriptionsProcessed,
            });
          }
        } catch (err: any) {
          log.warn({ err, subId: sub.uuid }, 'Failed to backfill Recurly subscription');
          result.errors.push(`Sub ${sub.uuid}: ${err.message}`);
        }
      }

      // Handle cursor-based pagination
      if (response.has_more && response.next) {
        nextPath = response.next;
      } else {
        nextPath = null;
      }

      // Update total count as we discover more
      if (nextPath) {
        await this.updateProgress(orgId, {
          totalCustomers: result.subscriptionsProcessed + 200, // estimate: at least one more page
          importedCustomers: result.subscriptionsProcessed,
        });
      }
    }
  }
}
