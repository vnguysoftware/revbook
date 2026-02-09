import Stripe from 'stripe';
import { eq, and } from 'drizzle-orm';
import Redis from 'ioredis';
import type { Database } from '../../config/database.js';
import { billingConnections, organizations } from '../../models/schema.js';
import { IngestionPipeline } from '../pipeline.js';
import type { RawWebhookEvent } from '../../models/types.js';
import { createChildLogger } from '../../config/logger.js';

const log = createChildLogger('stripe-backfill');

/**
 * Stripe Historical Backfill
 *
 * This is CRITICAL for the "fast time-to-value" requirement.
 * Instead of waiting weeks for enough webhooks to accumulate,
 * we pull historical subscription data from Stripe API immediately
 * after connection setup.
 *
 * On first run, this:
 * 1. Lists all active subscriptions
 * 2. Lists recent events (last 30 days)
 * 3. Processes everything through the normal pipeline
 * 4. Runs issue detection on the resulting state
 *
 * Result: Customer sees value within MINUTES of connecting Stripe.
 *
 * Progress tracking:
 * All progress is tracked in Redis so the frontend can poll for
 * real-time updates. The key pattern is `backfill:{orgId}`.
 */

/** Redis key for backfill progress */
function progressKey(orgId: string): string {
  return `backfill:${orgId}`;
}

export interface BackfillProgress {
  status: 'queued' | 'counting' | 'importing_subscriptions' | 'importing_events' | 'completed' | 'failed';
  phase: string;
  totalCustomers: number;
  importedCustomers: number;
  totalEvents: number;
  importedEvents: number;
  eventsCreated: number;
  issuesFound: number;
  errors: string[];
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  estimatedSecondsRemaining: number | null;
  processingRatePerSecond: number;
}

export class StripeBackfill {
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
        const eventEstimate = updated.totalEvents > 0
          ? (updated.totalEvents - updated.importedEvents) / Math.max(rate, 1)
          : 0;
        updated.estimatedSecondsRemaining = Math.round(remaining / Math.max(rate, 0.1) + eventEstimate);
      } else if (updated.status === 'importing_events' && updated.importedEvents > 0) {
        const phaseStart = Date.now() - 1000; // approximate
        const elapsed = (Date.now() - new Date(updated.startedAt).getTime()) / 1000;
        const rate = (updated.importedCustomers + updated.importedEvents) / elapsed;
        updated.processingRatePerSecond = Math.round(rate * 10) / 10;
        const remaining = updated.totalEvents - updated.importedEvents;
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

  async run(orgId: string): Promise<BackfillResult> {
    const result: BackfillResult = {
      subscriptionsProcessed: 0,
      eventsProcessed: 0,
      errors: [],
      durationMs: 0,
    };

    const startTime = Date.now();
    // Unique run ID to prevent idempotency key collisions on re-runs
    const runId = Date.now().toString(36);
    const lockKey = `backfill-lock:${orgId}`;

    // Acquire a Redis-based lock to prevent concurrent backfills for the same org
    const redis = await this.getRedis();
    if (redis) {
      const acquired = await redis.set(lockKey, Date.now().toString(), 'EX', 3600, 'NX');
      if (!acquired) {
        throw new Error('Backfill already in progress for this organization');
      }
    }

    try {
      await this.updateProgress(orgId, {
        status: 'counting',
        phase: 'Connecting to Stripe and counting records...',
        startedAt: new Date().toISOString(),
      });

      // Get Stripe credentials
      const [conn] = await this.db
        .select()
        .from(billingConnections)
        .where(
          and(
            eq(billingConnections.orgId, orgId),
            eq(billingConnections.source, 'stripe'),
          ),
        )
        .limit(1);

      if (!conn) {
        await this.updateProgress(orgId, {
          status: 'failed',
          phase: 'Stripe not connected',
          errors: ['Stripe not connected'],
        });
        throw new Error('Stripe not connected');
      }

      const creds = conn.credentials as { apiKey: string };
      const stripe = new Stripe(creds.apiKey);

      try {
        // Phase 0: Count total subscriptions for progress bar
        log.info({ orgId }, 'Counting Stripe subscriptions');
        let totalSubs = 0;
        try {
          // Use a quick count query
          const countResult = await stripe.subscriptions.list({ limit: 1, status: 'all' });
          // Stripe doesn't give total_count, so we estimate from has_more
          // For accurate count, we'd need to paginate. Use a fast estimate instead.
          totalSubs = countResult.data.length;
          if (countResult.has_more) {
            // Estimate based on common enterprise sizes
            totalSubs = 1000; // Start with estimate, refine as we go
          }
        } catch {
          totalSubs = 0;
        }

        await this.updateProgress(orgId, {
          status: 'importing_subscriptions',
          phase: 'Importing subscriptions from Stripe...',
          totalCustomers: totalSubs,
        });

        // Phase 1: Backfill active subscriptions
        log.info({ orgId }, 'Starting subscription backfill');
        await this.backfillSubscriptions(orgId, stripe, result, runId);

        await this.updateProgress(orgId, {
          status: 'importing_events',
          phase: 'Importing recent events from Stripe...',
          importedCustomers: result.subscriptionsProcessed,
          totalCustomers: result.subscriptionsProcessed, // Now we know the real count
        });

        // Phase 2: Backfill recent events (last 30 days)
        log.info({ orgId }, 'Starting event backfill');
        await this.backfillEvents(orgId, stripe, result);

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
          importedEvents: result.eventsProcessed,
          eventsCreated: result.eventsProcessed,
          completedAt: new Date().toISOString(),
          estimatedSecondsRemaining: 0,
        });

      } catch (err: any) {
        log.error({ err, orgId }, 'Backfill failed');
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
      }, 'Backfill completed');

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
    stripe: Stripe,
    result: BackfillResult,
    runId: string,
  ) {
    let hasMore = true;
    let startingAfter: string | undefined;

    while (hasMore) {
      const params: Stripe.SubscriptionListParams = {
        limit: 100,
        status: 'all', // Get active, past_due, canceled, etc.
        expand: ['data.customer', 'data.latest_invoice'],
      };
      if (startingAfter) params.starting_after = startingAfter;

      const subs = await stripe.subscriptions.list(params);

      for (const sub of subs.data) {
        try {
          // Synthesize a subscription.created event
          const syntheticEvent: Stripe.Event = {
            id: `backfill_sub_${sub.id}_${runId}`,
            object: 'event',
            api_version: '2025-02-24.acacia' as any,
            created: sub.created,
            type: sub.status === 'active' || sub.status === 'trialing'
              ? 'customer.subscription.created'
              : 'customer.subscription.deleted',
            data: {
              object: sub as any,
            },
            livemode: true,
            pending_webhooks: 0,
            request: null as any,
          };

          const rawEvent: RawWebhookEvent = {
            source: 'stripe',
            headers: {},
            body: JSON.stringify(syntheticEvent),
            receivedAt: new Date(),
          };

          await this.pipeline.processTrustedWebhook(orgId, 'stripe', rawEvent);
          result.subscriptionsProcessed++;

          // Update progress every 10 subscriptions to avoid Redis spam
          if (result.subscriptionsProcessed % 10 === 0) {
            await this.updateProgress(orgId, {
              importedCustomers: result.subscriptionsProcessed,
            });
          }
        } catch (err: any) {
          log.warn({ err, subId: sub.id }, 'Failed to backfill subscription');
          result.errors.push(`Sub ${sub.id}: ${err.message}`);
        }
      }

      hasMore = subs.has_more;
      if (subs.data.length > 0) {
        startingAfter = subs.data[subs.data.length - 1].id;
      }

      // Update total count as we discover more
      if (hasMore) {
        await this.updateProgress(orgId, {
          totalCustomers: result.subscriptionsProcessed + 100, // estimate: at least one more page
          importedCustomers: result.subscriptionsProcessed,
        });
      }
    }
  }

  private async backfillEvents(
    orgId: string,
    stripe: Stripe,
    result: BackfillResult,
  ) {
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
    let hasMore = true;
    let startingAfter: string | undefined;

    const relevantTypes = [
      'invoice.payment_succeeded',
      'invoice.payment_failed',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'charge.refunded',
      'charge.dispute.created',
    ];

    while (hasMore) {
      const params: Stripe.EventListParams = {
        limit: 100,
        created: { gte: thirtyDaysAgo },
        types: relevantTypes,
      };
      if (startingAfter) params.starting_after = startingAfter;

      const events = await stripe.events.list(params);

      for (const event of events.data) {
        try {
          const rawEvent: RawWebhookEvent = {
            source: 'stripe',
            headers: {},
            body: JSON.stringify(event),
            receivedAt: new Date(),
          };

          await this.pipeline.processTrustedWebhook(orgId, 'stripe', rawEvent);
          result.eventsProcessed++;

          // Update progress every 10 events
          if (result.eventsProcessed % 10 === 0) {
            await this.updateProgress(orgId, {
              importedEvents: result.eventsProcessed,
              eventsCreated: result.eventsProcessed,
            });
          }
        } catch (err: any) {
          // Idempotency check will handle most duplicates silently
          if (!err.message?.includes('duplicate')) {
            log.warn({ err, eventId: event.id }, 'Failed to backfill event');
            result.errors.push(`Event ${event.id}: ${err.message}`);
          }
        }
      }

      hasMore = events.has_more;
      if (events.data.length > 0) {
        startingAfter = events.data[events.data.length - 1].id;
      }
    }
  }
}

export interface BackfillResult {
  subscriptionsProcessed: number;
  eventsProcessed: number;
  errors: string[];
  durationMs: number;
}
