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

const log = createChildLogger('google-backfill');

/** Circuit breaker for Google API calls during backfill. */
const googleBackfillBreaker = new CircuitBreaker('google-backfill-api', {
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
  halfOpenMaxAttempts: 3,
});

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_PLAY_API_BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3';

/** Redis key for backfill progress */
function progressKey(orgId: string): string {
  return `backfill:google:${orgId}`;
}

interface GoogleCredentials {
  clientEmail: string;
  privateKey: string;
  packageName: string;
}

/** Voided purchase from Google Play Voided Purchases API */
interface VoidedPurchase {
  purchaseToken: string;
  purchaseTimeMillis: string;
  voidedTimeMillis: string;
  orderId: string;
  voidedSource: number;
  voidedReason: number;
  kind: string;
}

interface VoidedPurchasesResponse {
  voidedPurchases?: VoidedPurchase[];
  tokenPagination?: {
    nextPageToken?: string;
  };
}

/**
 * Google Play Historical Backfill
 *
 * Google Play has no "list all subscriptions" API, so backfill works differently:
 * 1. Accept an array of purchase tokens from the customer
 * 2. For each token: call subscriptionsv2.get, synthesize a PURCHASED notification
 * 3. Also call Voided Purchases API for recent refunds/chargebacks
 *
 * Progress is tracked in Redis so the frontend can poll for updates.
 */
export class GoogleBackfill {
  private pipeline: IngestionPipeline;
  private redis: Redis | null = null;
  private accessToken: string | null = null;
  private accessTokenExpiresAt: number = 0;

  constructor(private db: Database) {
    this.pipeline = new IngestionPipeline(db);
  }

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

      if (updated.status === 'importing_subscriptions' && updated.importedCustomers > 0) {
        const elapsed = (Date.now() - new Date(updated.startedAt).getTime()) / 1000;
        const rate = updated.importedCustomers / elapsed;
        updated.processingRatePerSecond = Math.round(rate * 10) / 10;
        const remaining = updated.totalCustomers - updated.importedCustomers;
        updated.estimatedSecondsRemaining = Math.round(remaining / Math.max(rate, 0.1));
      }

      await redis.set(key, JSON.stringify(updated), 'EX', 86400);
    } catch (err) {
      log.warn({ err }, 'Failed to update Google backfill progress');
    }
  }

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
   * Get an OAuth2 access token for the Google Play Developer API.
   */
  private async getAccessToken(creds: GoogleCredentials): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 300_000) {
      return this.accessToken;
    }

    const jose = await import('jose');
    const now = Math.floor(Date.now() / 1000);
    const privateKey = await jose.importPKCS8(creds.privateKey, 'RS256');

    const jwt = await new jose.SignJWT({
      iss: creds.clientEmail,
      sub: creds.clientEmail,
      aud: GOOGLE_TOKEN_URL,
      iat: now,
      exp: now + 3600,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .sign(privateKey);

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Google OAuth2 token exchange failed ${response.status}: ${body}`);
    }

    const tokenData = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = tokenData.access_token;
    this.accessTokenExpiresAt = Date.now() + tokenData.expires_in * 1000;

    return this.accessToken;
  }

  async run(orgId: string, purchaseTokens: string[] = []): Promise<BackfillResult> {
    const result: BackfillResult = {
      subscriptionsProcessed: 0,
      eventsProcessed: 0,
      errors: [],
      durationMs: 0,
    };

    const startTime = Date.now();
    const runId = Date.now().toString(36);
    const lockKey = `backfill-lock:google:${orgId}`;

    const redis = await this.getRedis();
    if (redis) {
      const acquired = await redis.set(lockKey, Date.now().toString(), 'EX', 3600, 'NX');
      if (!acquired) {
        throw new Error('Google Play backfill already in progress for this organization');
      }
    }

    try {
      await this.updateProgress(orgId, {
        status: 'counting',
        phase: 'Connecting to Google Play...',
        startedAt: new Date().toISOString(),
      });

      // Get Google credentials
      const [conn] = await this.db
        .select()
        .from(billingConnections)
        .where(
          and(
            eq(billingConnections.orgId, orgId),
            eq(billingConnections.source, 'google'),
          ),
        )
        .limit(1);

      if (!conn) {
        await this.updateProgress(orgId, {
          status: 'failed',
          phase: 'Google Play not connected',
          errors: ['Google Play not connected'],
        });
        throw new Error('Google Play not connected');
      }

      const creds = readCredentials<GoogleCredentials>(conn.credentials);

      try {
        const totalTokens = purchaseTokens.length;

        await this.updateProgress(orgId, {
          status: 'importing_subscriptions',
          phase: totalTokens > 0
            ? `Importing ${totalTokens} purchase tokens...`
            : 'Importing voided purchases...',
          totalCustomers: totalTokens,
        });

        // Phase 1: Backfill specific purchase tokens
        if (purchaseTokens.length > 0) {
          await this.backfillPurchaseTokens(orgId, creds, purchaseTokens, result, runId);
        }

        // Phase 2: Backfill voided purchases (always)
        log.info({ orgId }, 'Fetching voided purchases from Google Play');
        await this.updateProgress(orgId, {
          phase: 'Importing voided purchases...',
        });
        await this.backfillVoidedPurchases(orgId, creds, result, runId);

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
          importedEvents: result.eventsProcessed,
          completedAt: new Date().toISOString(),
          estimatedSecondsRemaining: 0,
        });
      } catch (err: any) {
        log.error({ err, orgId }, 'Google Play backfill failed');
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
      log.info({ orgId, ...result }, 'Google Play backfill completed');
    } finally {
      if (redis) {
        await redis.del(lockKey).catch(() => {});
      }
      if (this.redis) {
        await this.redis.quit().catch(() => {});
      }
    }

    return result;
  }

  private async backfillPurchaseTokens(
    orgId: string,
    creds: GoogleCredentials,
    purchaseTokens: string[],
    result: BackfillResult,
    runId: string,
  ): Promise<void> {
    const accessToken = await this.getAccessToken(creds);

    for (const token of purchaseTokens) {
      try {
        // Fetch subscription details
        const url = `${GOOGLE_PLAY_API_BASE}/applications/${creds.packageName}/purchases/subscriptionsv2/tokens/${token}`;
        const subDetails = await googleBackfillBreaker.execute(async () => {
          const response = await fetch(url, {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Accept': 'application/json',
            },
          });
          if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`Google Play API error ${response.status}: ${body}`);
          }
          return response.json() as Promise<any>;
        });

        // Synthesize a PURCHASED notification for the pipeline
        const productId = subDetails.lineItems?.[0]?.productId || 'unknown';
        const syntheticNotification = {
          version: '1.0',
          packageName: creds.packageName,
          eventTimeMillis: String(new Date(subDetails.startTime).getTime()),
          subscriptionNotification: {
            version: '1.0',
            notificationType: 4, // PURCHASED
            purchaseToken: token,
            subscriptionId: productId,
          },
        };

        const pubSubMessage = {
          message: {
            data: Buffer.from(JSON.stringify(syntheticNotification)).toString('base64'),
            messageId: `backfill_google_${token}_${runId}`,
            publishTime: new Date().toISOString(),
          },
          subscription: 'backfill',
        };

        const rawEvent: RawWebhookEvent = {
          source: 'google',
          headers: {},
          body: JSON.stringify(pubSubMessage),
          receivedAt: new Date(),
        };

        await this.pipeline.processTrustedWebhook(orgId, 'google', rawEvent);
        result.subscriptionsProcessed++;

        if (result.subscriptionsProcessed % 10 === 0) {
          await this.updateProgress(orgId, {
            importedCustomers: result.subscriptionsProcessed,
          });
        }
      } catch (err: any) {
        log.warn({ err, purchaseToken: token }, 'Failed to backfill Google purchase token');
        result.errors.push(`Token ${token.slice(0, 20)}...: ${err.message}`);
      }
    }
  }

  private async backfillVoidedPurchases(
    orgId: string,
    creds: GoogleCredentials,
    result: BackfillResult,
    runId: string,
  ): Promise<void> {
    const accessToken = await this.getAccessToken(creds);
    let nextPageToken: string | undefined;

    do {
      try {
        const params = new URLSearchParams({ maxResults: '100' });
        if (nextPageToken) {
          params.set('token', nextPageToken);
        }

        const url = `${GOOGLE_PLAY_API_BASE}/applications/${creds.packageName}/purchases/voidedpurchases?${params}`;
        const response = await googleBackfillBreaker.execute(async () => {
          const res = await fetch(url, {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Accept': 'application/json',
            },
          });
          if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`Google Voided Purchases API error ${res.status}: ${body}`);
          }
          return res.json() as Promise<VoidedPurchasesResponse>;
        });

        if (response.voidedPurchases) {
          for (const voided of response.voidedPurchases) {
            try {
              // voidedReason: 0 = other, 1 = remorse (refund), 2 = friendly fraud, 3 = chargeback
              const refundType = voided.voidedReason === 1 ? 1 : 0; // Map remorse to refund, rest to chargeback
              const syntheticNotification = {
                version: '1.0',
                packageName: creds.packageName,
                eventTimeMillis: voided.voidedTimeMillis,
                voidedPurchaseNotification: {
                  purchaseToken: voided.purchaseToken,
                  orderId: voided.orderId,
                  productType: 1,
                  refundType,
                },
              };

              const pubSubMessage = {
                message: {
                  data: Buffer.from(JSON.stringify(syntheticNotification)).toString('base64'),
                  messageId: `backfill_voided_${voided.orderId}_${runId}`,
                  publishTime: new Date().toISOString(),
                },
                subscription: 'backfill',
              };

              const rawEvent: RawWebhookEvent = {
                source: 'google',
                headers: {},
                body: JSON.stringify(pubSubMessage),
                receivedAt: new Date(),
              };

              await this.pipeline.processTrustedWebhook(orgId, 'google', rawEvent);
              result.eventsProcessed++;
            } catch (err: any) {
              log.warn({ err, orderId: voided.orderId }, 'Failed to backfill voided purchase');
              result.errors.push(`Voided ${voided.orderId}: ${err.message}`);
            }
          }
        }

        nextPageToken = response.tokenPagination?.nextPageToken;
      } catch (err: any) {
        log.error({ err }, 'Failed to fetch voided purchases page');
        result.errors.push(`Voided purchases: ${err.message}`);
        break;
      }
    } while (nextPageToken);
  }
}
