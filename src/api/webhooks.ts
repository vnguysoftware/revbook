import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import type { Database } from '../config/database.js';
import { billingConnections, webhookLogs, organizations } from '../models/schema.js';
import { getNormalizer } from '../ingestion/normalizer/base.js';
import { enqueueWebhookJob } from '../queue/webhook-worker.js';
import { AppleWebhookProxy } from '../ingestion/proxy/apple-proxy.js';
import type { BillingSource, RawWebhookEvent } from '../models/types.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('webhook-api');

/**
 * Webhook receiver endpoints.
 *
 * Each org gets unique webhook URLs for each billing source:
 *   POST /webhooks/:orgSlug/stripe
 *   POST /webhooks/:orgSlug/apple
 *   POST /webhooks/:orgSlug/google
 *
 * Design principles:
 * 1. Verify signature BEFORE enqueuing (security-critical)
 * 2. Log webhook and enqueue to BullMQ
 * 3. Return 200 immediately (target <100ms response)
 * (Processing happens asynchronously via webhook worker)
 */
export function createWebhookRoutes(db: Database) {
  const app = new Hono();
  const appleProxy = new AppleWebhookProxy(db);

  // Generic webhook handler for any billing source
  const handleWebhook = async (
    c: any,
    source: BillingSource,
  ) => {
    const orgSlug = c.req.param('orgSlug');
    const startTime = Date.now();

    // Look up org by slug
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, orgSlug))
      .limit(1);

    if (!org) {
      return c.json({ error: 'Organization not found' }, 404);
    }

    // Build raw event
    const rawBody = await c.req.text();
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value: string, key: string) => {
      headers[key] = value;
    });

    const rawEvent: RawWebhookEvent = {
      source,
      headers,
      body: rawBody,
      receivedAt: new Date(),
    };

    // ── Step 1: Verify signature BEFORE enqueuing (security-critical) ──
    try {
      const [connection] = await db
        .select()
        .from(billingConnections)
        .where(
          and(
            eq(billingConnections.orgId, org.id),
            eq(billingConnections.source, source),
          ),
        )
        .limit(1);

      if (!connection) {
        log.warn({ orgSlug, source }, 'No billing connection found');
        return c.json({ error: 'Billing connection not configured' }, 404);
      }

      if (connection.webhookSecret) {
        const normalizer = getNormalizer(source);
        const valid = await normalizer.verifySignature(rawEvent, connection.webhookSecret);
        if (!valid) {
          log.warn({ orgSlug, source }, 'Webhook signature verification failed');
          return c.json({ error: 'Invalid signature' }, 401);
        }
      }
    } catch (err: any) {
      log.error({ err, orgSlug, source }, 'Signature verification error');
      return c.json({ error: 'Signature verification error' }, 500);
    }

    // ── Step 1b: Apple proxy forwarding (fire and forget) ────────────
    // If this is an Apple webhook and the customer has an existing
    // notification URL, forward to it before we process.
    if (source === 'apple') {
      appleProxy.forwardIfConfigured(org.id, rawEvent).catch((err) => {
        log.warn({ err, orgSlug }, 'Apple proxy forwarding failed (non-blocking)');
      });
    }

    // ── Step 2: Log webhook immediately with 'queued' status ──────────
    let webhookLogId: string;
    try {
      const [webhookLog] = await db
        .insert(webhookLogs)
        .values({
          orgId: org.id,
          source,
          rawHeaders: headers,
          rawBody,
          processingStatus: 'queued',
        })
        .returning({ id: webhookLogs.id });

      webhookLogId = webhookLog.id;
    } catch (err: any) {
      log.error({ err, orgSlug, source }, 'Failed to create webhook log');
      // Still return 200 to prevent provider from retrying
      return c.json({ ok: true });
    }

    // ── Step 3: Enqueue to BullMQ for async processing ────────────────
    try {
      await enqueueWebhookJob({
        orgId: org.id,
        source,
        rawPayload: rawBody,
        headers,
        webhookLogId,
        receivedAt: rawEvent.receivedAt.toISOString(),
      });
    } catch (err: any) {
      log.error({ err, orgSlug, source, webhookLogId }, 'Failed to enqueue webhook job');
      // Update webhook log to reflect enqueue failure
      await db
        .update(webhookLogs)
        .set({
          processingStatus: 'failed',
          errorMessage: `Failed to enqueue: ${err.message}`,
        })
        .where(eq(webhookLogs.id, webhookLogId))
        .catch((dbErr) => log.error({ err: dbErr }, 'Failed to update webhook log'));
    }

    // ── Step 4: Update last webhook timestamp (fire and forget) ───────
    db.update(billingConnections)
      .set({ lastWebhookAt: new Date() })
      .where(
        and(
          eq(billingConnections.orgId, org.id),
          eq(billingConnections.source, source),
        ),
      )
      .catch((err) => log.warn({ err }, 'Failed to update lastWebhookAt'));

    const elapsed = Date.now() - startTime;
    log.info({ orgSlug, source, webhookLogId, elapsedMs: elapsed }, 'Webhook received and enqueued');

    // Return 200 immediately
    return c.json({ ok: true, webhookLogId });
  };

  app.post('/:orgSlug/stripe', (c) => handleWebhook(c, 'stripe'));
  app.post('/:orgSlug/apple', (c) => handleWebhook(c, 'apple'));
  app.post('/:orgSlug/google', (c) => handleWebhook(c, 'google'));

  return app;
}
