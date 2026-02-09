import { eq, and } from 'drizzle-orm';
import type { Database } from '../config/database.js';
import { canonicalEvents, webhookLogs, products, billingConnections } from '../models/schema.js';
import type { NormalizedEvent, RawWebhookEvent, BillingSource } from '../models/types.js';
import { getNormalizer } from './normalizer/base.js';
import { IdentityResolver } from '../identity/resolver.js';
import { EntitlementEngine } from '../entitlement/engine.js';
import { IssueDetectionEngine } from '../detection/engine.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('ingestion-pipeline');

/**
 * The main ingestion pipeline. Processes raw webhook events through:
 * 1. Signature verification
 * 2. Event normalization
 * 3. Identity resolution
 * 4. Product resolution
 * 5. Canonical event storage
 * 6. Entitlement state updates
 * 7. Issue detection
 */
export class IngestionPipeline {
  private identityResolver: IdentityResolver;
  private entitlementEngine: EntitlementEngine;
  private issueDetectionEngine: IssueDetectionEngine;

  constructor(private db: Database) {
    this.identityResolver = new IdentityResolver(db);
    this.entitlementEngine = new EntitlementEngine(db);
    this.issueDetectionEngine = new IssueDetectionEngine(db);
  }

  /**
   * Process a raw webhook event end-to-end.
   * Creates the webhook log entry inline (used for synchronous/non-queued processing).
   */
  async processWebhook(
    orgId: string,
    source: BillingSource,
    rawEvent: RawWebhookEvent,
  ): Promise<{ processed: number; skipped: number; errors: string[] }> {
    // Log the raw webhook
    const [webhookLog] = await this.db
      .insert(webhookLogs)
      .values({
        orgId,
        source,
        rawHeaders: rawEvent.headers,
        rawBody: rawEvent.body,
        processingStatus: 'received',
      })
      .returning();

    return this.processWebhookWithLog(orgId, source, rawEvent, webhookLog.id);
  }

  /**
   * Process a webhook event from the queue.
   * The webhook log entry is already created at enqueue time, so we skip creation.
   */
  async processWebhookFromQueue(
    orgId: string,
    source: BillingSource,
    rawEvent: RawWebhookEvent,
    webhookLogId: string,
  ): Promise<{ processed: number; skipped: number; errors: string[] }> {
    return this.processWebhookWithLog(orgId, source, rawEvent, webhookLogId);
  }

  /**
   * Core webhook processing logic shared between sync and queue paths.
   */
  private async processWebhookWithLog(
    orgId: string,
    source: BillingSource,
    rawEvent: RawWebhookEvent,
    webhookLogId: string,
  ): Promise<{ processed: number; skipped: number; errors: string[] }> {
    const result = { processed: 0, skipped: 0, errors: [] as string[] };

    try {
      // 1. Get the billing connection for signature verification
      const [connection] = await this.db
        .select()
        .from(billingConnections)
        .where(and(eq(billingConnections.orgId, orgId), eq(billingConnections.source, source)))
        .limit(1);

      if (!connection) {
        throw new Error(`No billing connection found for org ${orgId} source ${source}`);
      }

      // 2. Verify signature
      const normalizer = getNormalizer(source);
      if (connection.webhookSecret) {
        const valid = await normalizer.verifySignature(rawEvent, connection.webhookSecret);
        if (!valid) {
          throw new Error('Webhook signature verification failed');
        }
      }

      // 3. Normalize into canonical events
      const normalized = await normalizer.normalize(orgId, rawEvent);

      if (normalized.length === 0) {
        await this.db
          .update(webhookLogs)
          .set({ processingStatus: 'skipped', processedAt: new Date() })
          .where(eq(webhookLogs.id, webhookLogId));
        result.skipped = 1;
        return result;
      }

      // 4. Process each normalized event
      for (const event of normalized) {
        try {
          await this.processNormalizedEvent(event);
          result.processed++;
        } catch (err: any) {
          log.error({ err, eventType: event.eventType }, 'Failed to process normalized event');
          result.errors.push(err.message);
        }
      }

      // Update webhook log
      await this.db
        .update(webhookLogs)
        .set({
          processingStatus: result.errors.length > 0 ? 'failed' : 'processed',
          eventType: normalized[0]?.eventType,
          externalEventId: normalized[0]?.externalEventId,
          processedAt: new Date(),
          errorMessage: result.errors.length > 0 ? result.errors.join('; ') : null,
        })
        .where(eq(webhookLogs.id, webhookLogId));
    } catch (err: any) {
      log.error({ err, orgId, source }, 'Pipeline processing failed');
      await this.db
        .update(webhookLogs)
        .set({
          processingStatus: 'failed',
          errorMessage: err.message,
          processedAt: new Date(),
        })
        .where(eq(webhookLogs.id, webhookLogId));
      result.errors.push(err.message);
    }

    return result;
  }

  /**
   * Process raw events from trusted sources (like backfill).
   * Skips signature verification since these events come from
   * authenticated API calls, not webhooks.
   */
  async processTrustedWebhook(
    orgId: string,
    source: BillingSource,
    rawEvent: RawWebhookEvent,
  ): Promise<{ processed: number; skipped: number; errors: string[] }> {
    const result = { processed: 0, skipped: 0, errors: [] as string[] };

    try {
      const normalizer = getNormalizer(source);
      const normalized = await normalizer.normalize(orgId, rawEvent);

      if (normalized.length === 0) {
        result.skipped = 1;
        return result;
      }

      for (const event of normalized) {
        try {
          await this.processNormalizedEvent(event);
          result.processed++;
        } catch (err: any) {
          log.error({ err, eventType: event.eventType }, 'Failed to process normalized event');
          result.errors.push(err.message);
        }
      }
    } catch (err: any) {
      log.error({ err, orgId, source }, 'Trusted pipeline processing failed');
      result.errors.push(err.message);
    }

    return result;
  }

  private async processNormalizedEvent(event: NormalizedEvent): Promise<void> {
    // 1. Resolve user identity
    let userId: string | undefined;
    if (event.identityHints.length > 0) {
      userId = await this.identityResolver.resolve(event.orgId, event.identityHints);
    }

    // 2. Resolve product
    let productId: string | undefined;
    if (event.rawPayload) {
      productId = await this.resolveProduct(event.orgId, event.source, event.rawPayload);
    }

    // 3. Store canonical event with atomic idempotency via ON CONFLICT DO NOTHING
    const inserted = await this.db
      .insert(canonicalEvents)
      .values({
        orgId: event.orgId,
        userId,
        productId,
        source: event.source,
        eventType: event.eventType,
        eventTime: event.eventTime,
        status: event.status,
        amountCents: event.amountCents,
        currency: event.currency,
        externalEventId: event.externalEventId,
        externalSubscriptionId: event.externalSubscriptionId,
        idempotencyKey: event.idempotencyKey,
        rawPayload: event.rawPayload,
        processedAt: new Date(),
      })
      .onConflictDoNothing({ target: canonicalEvents.idempotencyKey })
      .returning();

    if (inserted.length === 0) {
      log.debug({ idempotencyKey: event.idempotencyKey }, 'Duplicate event, skipping');
      return;
    }

    const storedEvent = inserted[0];

    log.info({
      eventId: storedEvent.id,
      eventType: event.eventType,
      source: event.source,
      userId,
    }, 'Canonical event stored');

    // 5. Update entitlement state
    if (userId && productId) {
      await this.entitlementEngine.processEvent(storedEvent);
    }

    // 6. Run issue detection
    if (userId) {
      await this.issueDetectionEngine.checkForIssues(event.orgId, userId, storedEvent);
    }
  }

  /**
   * Resolve product from raw payload.
   * Matches external product IDs to our canonical products.
   */
  private async resolveProduct(
    orgId: string,
    source: BillingSource,
    rawPayload: Record<string, unknown>,
  ): Promise<string | undefined> {
    let externalProductId: string | undefined;

    if (source === 'stripe') {
      const obj = (rawPayload as any)?.data?.object;
      externalProductId =
        obj?.items?.data?.[0]?.price?.product ||
        obj?.lines?.data?.[0]?.price?.product;
    } else if (source === 'apple') {
      externalProductId = (rawPayload as any)?.transaction?.productId;
    } else if (source === 'google') {
      externalProductId = (rawPayload as any)?.productId;
    }

    if (!externalProductId) return undefined;

    // Search products by external ID in the jsonb field
    const allProducts = await this.db
      .select()
      .from(products)
      .where(eq(products.orgId, orgId));

    for (const product of allProducts) {
      const extIds = product.externalIds as Record<string, string>;
      if (extIds[source] === externalProductId) {
        return product.id;
      }
    }

    // Auto-create product if not found (for onboarding ease)
    const [newProduct] = await this.db
      .insert(products)
      .values({
        orgId,
        name: externalProductId,
        externalIds: { [source]: externalProductId },
      })
      .returning();

    log.info({ orgId, productId: newProduct.id, externalProductId }, 'Auto-created product from event');
    return newProduct.id;
  }
}
