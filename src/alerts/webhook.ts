import { randomUUID } from 'crypto';
import type { Issue, WebhookAlertConfig, WebhookEventType, WebhookPayload } from '../models/types.js';
import { signWebhookPayload } from './webhook-signing.js';
import { enrichIssueForWebhook } from '../detection/detector-meta.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('alert-webhook');

/**
 * Build a structured webhook payload envelope.
 */
export function buildWebhookPayload(
  issue: Issue,
  eventType: WebhookEventType,
): WebhookPayload {
  const enrichment = enrichIssueForWebhook(issue.issueType);

  return {
    id: `evt_${randomUUID().replace(/-/g, '')}`,
    eventType,
    timestamp: new Date().toISOString(),
    apiVersion: '2026-02-01',
    data: {
      issue: {
        id: issue.id,
        orgId: issue.orgId,
        userId: issue.userId,
        issueType: issue.issueType,
        severity: issue.severity,
        status: issue.status,
        title: issue.title,
        description: issue.description,
        estimatedRevenueCents: issue.estimatedRevenueCents,
        confidence: issue.confidence,
        detectorId: issue.detectorId,
        detectionTier: issue.detectionTier,
        evidence: issue.evidence,
        category: enrichment.category,
        recommendedAction: enrichment.recommendedAction,
        resolvedAt: issue.resolvedAt,
        resolution: issue.resolution,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
      },
    },
  };
}

/**
 * Send a webhook alert to a customer HTTP endpoint.
 *
 * Signs the payload, POSTs with appropriate headers, 10s timeout.
 */
export async function sendWebhookAlert(
  config: WebhookAlertConfig,
  issue: Issue,
  eventType: WebhookEventType,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Check event type filter
    if (config.eventTypes && config.eventTypes.length > 0 && !config.eventTypes.includes(eventType)) {
      log.debug({ eventType, issueId: issue.id }, 'Event type not in webhook filter, skipping');
      return { success: true }; // Not an error — just filtered out
    }

    const payload = buildWebhookPayload(issue, eventType);
    const body = JSON.stringify(payload);
    const { signature } = signWebhookPayload(body, config.signingSecret);
    const deliveryId = payload.id;

    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RevBack-Signature': signature,
        'X-RevBack-Event': eventType,
        'X-RevBack-Delivery': deliveryId,
        'User-Agent': 'RevBack-Webhook/1.0',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => '');
      log.warn({ status: response.status, body: responseBody, issueId: issue.id }, 'Webhook delivery failed');
      return { success: false, error: `HTTP ${response.status}: ${responseBody.slice(0, 200)}` };
    }

    log.info({ issueId: issue.id, deliveryId, url: config.url }, 'Webhook alert sent');
    return { success: true };
  } catch (err: any) {
    log.error({ err, issueId: issue.id }, 'Webhook alert delivery error');
    return { success: false, error: err.message };
  }
}

/**
 * Send a test webhook to verify the endpoint.
 */
export async function sendWebhookTestAlert(
  config: WebhookAlertConfig,
): Promise<{ success: boolean; error?: string }> {
  try {
    const testPayload: WebhookPayload = {
      id: `evt_test_${randomUUID().replace(/-/g, '')}`,
      eventType: 'issue.created',
      timestamp: new Date().toISOString(),
      apiVersion: '2026-02-01',
      data: {
        issue: {
          id: 'test-issue-id',
          issueType: 'test',
          severity: 'info',
          status: 'open',
          title: 'Test Webhook Delivery',
          description: 'This is a test event to verify your webhook endpoint is configured correctly.',
          estimatedRevenueCents: 0,
          confidence: 1.0,
          category: 'test',
          recommendedAction: 'No action needed — this is a test event.',
          createdAt: new Date().toISOString(),
        },
      },
    };

    const body = JSON.stringify(testPayload);
    const { signature } = signWebhookPayload(body, config.signingSecret);

    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RevBack-Signature': signature,
        'X-RevBack-Event': 'issue.created',
        'X-RevBack-Delivery': testPayload.id,
        'User-Agent': 'RevBack-Webhook/1.0',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => '');
      return { success: false, error: `HTTP ${response.status}: ${responseBody.slice(0, 200)}` };
    }

    log.info({ url: config.url }, 'Webhook test alert sent');
    return { success: true };
  } catch (err: any) {
    log.error({ err }, 'Webhook test alert delivery error');
    return { success: false, error: err.message };
  }
}
