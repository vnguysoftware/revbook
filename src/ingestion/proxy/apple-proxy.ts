import { eq, and } from 'drizzle-orm';
import type { Database } from '../../config/database.js';
import { billingConnections, webhookLogs } from '../../models/schema.js';
import { IngestionPipeline } from '../pipeline.js';
import type { RawWebhookEvent } from '../../models/types.js';
import { createChildLogger } from '../../config/logger.js';

const log = createChildLogger('apple-proxy');

/**
 * Apple Webhook Proxy/Forwarder
 *
 * Apple only allows ONE Server Notification URL per app.
 * Enterprise customers who already have a notification URL configured
 * can't just point Apple to us without breaking their existing integration.
 *
 * Solution: The customer sets OUR URL as Apple's notification endpoint.
 * We receive the notification, forward it to their original URL, and
 * also process it for our system. Their existing system keeps working.
 *
 * Key design decisions:
 * - Forward BEFORE processing (customer's system has priority)
 * - Don't block our processing if their endpoint is down
 * - 10s timeout on forwarding (Apple expects a fast 200 back)
 * - Log forwarding results for debugging
 */

const FORWARD_TIMEOUT_MS = 10_000;

function isValidForwardUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    const blocked = [
      /^localhost$/i, /^127\./, /^10\./, /^172\.(1[6-9]|2[0-9]|3[01])\./,
      /^192\.168\./, /^169\.254\./, /^::1$/, /^fc00:/, /^fd00:/,
    ];
    for (const pattern of blocked) {
      if (pattern.test(hostname)) return false;
    }
    if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') return false;
    return true;
  } catch { return false; }
}

export interface ForwardResult {
  forwarded: boolean;
  forwardUrl: string | null;
  forwardStatusCode: number | null;
  forwardDurationMs: number;
  error: string | null;
}

export class AppleWebhookProxy {
  private pipeline: IngestionPipeline;

  constructor(private db: Database) {
    this.pipeline = new IngestionPipeline(db);
  }

  /**
   * Forward an Apple webhook to the customer's original URL if configured.
   * This is a fire-and-forget operation used by the queue-based webhook handler.
   * It does NOT process the webhook through our pipeline (the queue worker does that).
   */
  async forwardIfConfigured(
    orgId: string,
    rawEvent: RawWebhookEvent,
  ): Promise<ForwardResult> {
    // Look up the customer's original Apple notification URL
    const [conn] = await this.db
      .select()
      .from(billingConnections)
      .where(
        and(
          eq(billingConnections.orgId, orgId),
          eq(billingConnections.source, 'apple'),
        ),
      )
      .limit(1);

    const credentials = conn?.credentials as Record<string, unknown> | undefined;
    const forwardUrl = credentials?.originalNotificationUrl as string | undefined;

    if (!forwardUrl) {
      return {
        forwarded: false,
        forwardUrl: null,
        forwardStatusCode: null,
        forwardDurationMs: 0,
        error: null,
      };
    }

    const result = await this.forwardToCustomer(forwardUrl, rawEvent);

    // Log the forwarding result
    await this.logForwardResult(orgId, result).catch((err) =>
      log.warn({ err }, 'Failed to log forward result'),
    );

    return result;
  }

  /**
   * Handle an Apple webhook: forward to customer's URL, then process for our system.
   *
   * Returns both the forwarding result and the pipeline processing result.
   */
  async handleWebhook(
    orgId: string,
    rawEvent: RawWebhookEvent,
  ): Promise<{
    forward: ForwardResult;
    pipeline: { processed: number; skipped: number; errors: string[] };
  }> {
    // 1. Look up the customer's original Apple notification URL
    const [conn] = await this.db
      .select()
      .from(billingConnections)
      .where(
        and(
          eq(billingConnections.orgId, orgId),
          eq(billingConnections.source, 'apple'),
        ),
      )
      .limit(1);

    const credentials = conn?.credentials as Record<string, unknown> | undefined;
    const forwardUrl = credentials?.originalNotificationUrl as string | undefined;

    // 2. Forward to customer's endpoint (non-blocking for our pipeline)
    let forwardResult: ForwardResult;
    if (forwardUrl) {
      forwardResult = await this.forwardToCustomer(forwardUrl, rawEvent);
    } else {
      forwardResult = {
        forwarded: false,
        forwardUrl: null,
        forwardStatusCode: null,
        forwardDurationMs: 0,
        error: null,
      };
    }

    // 3. Log the forwarding result
    await this.logForwardResult(orgId, forwardResult).catch((err) =>
      log.warn({ err }, 'Failed to log forward result'),
    );

    // 4. Process through our pipeline regardless of forwarding result
    let pipelineResult: { processed: number; skipped: number; errors: string[] };
    try {
      pipelineResult = await this.pipeline.processWebhook(orgId, 'apple', rawEvent);
    } catch (err: any) {
      log.error({ err, orgId }, 'Apple proxy pipeline processing failed');
      pipelineResult = { processed: 0, skipped: 0, errors: [err.message] };
    }

    log.info(
      {
        orgId,
        forwarded: forwardResult.forwarded,
        forwardStatus: forwardResult.forwardStatusCode,
        processed: pipelineResult.processed,
      },
      'Apple webhook proxy completed',
    );

    return { forward: forwardResult, pipeline: pipelineResult };
  }

  /**
   * Forward the raw Apple notification to the customer's original URL.
   * Uses a 10-second timeout to avoid blocking our processing.
   */
  private async forwardToCustomer(
    forwardUrl: string,
    rawEvent: RawWebhookEvent,
  ): Promise<ForwardResult> {
    if (!isValidForwardUrl(forwardUrl)) {
      log.error({ forwardUrl }, 'Blocked SSRF: invalid forward URL');
      return {
        forwarded: false,
        forwardUrl,
        forwardStatusCode: null,
        forwardDurationMs: 0,
        error: 'Invalid URL',
      };
    }

    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);

      // Forward with the same headers (minus host/content-length which fetch recalculates)
      const forwardHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(rawEvent.headers)) {
        const lower = key.toLowerCase();
        if (lower !== 'host' && lower !== 'content-length') {
          forwardHeaders[key] = value;
        }
      }

      const response = await fetch(forwardUrl, {
        method: 'POST',
        headers: {
          ...forwardHeaders,
          'Content-Type': 'application/json',
          'X-Forwarded-By': 'RevBack',
        },
        body: rawEvent.body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        log.warn(
          { forwardUrl, status: response.status, durationMs },
          'Customer endpoint returned non-200',
        );
      }

      return {
        forwarded: true,
        forwardUrl,
        forwardStatusCode: response.status,
        forwardDurationMs: durationMs,
        error: response.ok ? null : `HTTP ${response.status}`,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        err.name === 'AbortError'
          ? `Timeout after ${FORWARD_TIMEOUT_MS}ms`
          : err.message;

      log.warn(
        { err, forwardUrl, durationMs },
        'Failed to forward Apple webhook to customer',
      );

      return {
        forwarded: false,
        forwardUrl,
        forwardStatusCode: null,
        forwardDurationMs: durationMs,
        error: errorMessage,
      };
    }
  }

  /**
   * Log the forwarding result to webhook_logs for debugging/auditing.
   */
  private async logForwardResult(
    orgId: string,
    result: ForwardResult,
  ): Promise<void> {
    await this.db.insert(webhookLogs).values({
      orgId,
      source: 'apple',
      eventType: 'proxy_forward',
      processingStatus: result.forwarded ? 'processed' : 'failed',
      httpStatus: result.forwardStatusCode,
      errorMessage: result.error,
      rawHeaders: {
        forwardUrl: result.forwardUrl,
        forwardDurationMs: result.forwardDurationMs,
      },
      rawBody: null,
      processedAt: new Date(),
    });
  }
}
