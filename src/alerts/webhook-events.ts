import { eq, and } from 'drizzle-orm';
import type { Database } from '../config/database.js';
import { alertConfigurations, issues } from '../models/schema.js';
import type { WebhookAlertConfig, WebhookEventType } from '../models/types.js';
import { enqueueWebhookDelivery } from '../queue/webhook-delivery-worker.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('webhook-events');

/**
 * Dispatch a webhook event for an issue status change.
 *
 * Queries all webhook alert configs for the org, filters by severity/type/eventType,
 * and enqueues delivery jobs for each matching config.
 */
export async function dispatchWebhookEvent(
  db: Database,
  orgId: string,
  issueId: string,
  eventType: WebhookEventType,
): Promise<void> {
  try {
    // Get the issue
    const [issue] = await db
      .select()
      .from(issues)
      .where(and(eq(issues.orgId, orgId), eq(issues.id, issueId)))
      .limit(1);

    if (!issue) {
      log.warn({ orgId, issueId }, 'Issue not found for webhook dispatch');
      return;
    }

    // Get all enabled webhook configs for this org
    const configs = await db
      .select()
      .from(alertConfigurations)
      .where(
        and(
          eq(alertConfigurations.orgId, orgId),
          eq(alertConfigurations.channel, 'webhook'),
          eq(alertConfigurations.enabled, true),
        ),
      );

    if (configs.length === 0) {
      log.debug({ orgId }, 'No webhook configurations found');
      return;
    }

    for (const config of configs) {
      // Check severity filter
      const severityFilter = config.severityFilter as string[];
      if (!severityFilter.includes(issue.severity)) {
        continue;
      }

      // Check issue type filter
      const issueTypes = config.issueTypes as string[] | null;
      if (issueTypes && issueTypes.length > 0 && !issueTypes.includes(issue.issueType)) {
        continue;
      }

      const webhookConfig = config.config as unknown as WebhookAlertConfig;

      // Check event type filter
      if (webhookConfig.eventTypes && webhookConfig.eventTypes.length > 0 && !webhookConfig.eventTypes.includes(eventType)) {
        continue;
      }

      // Enqueue for async delivery with retries
      await enqueueWebhookDelivery({
        orgId,
        alertConfigId: config.id,
        issueId: issue.id,
        issue,
        config: webhookConfig,
        eventType,
      });
    }

    log.info({ orgId, issueId, eventType, configCount: configs.length }, 'Webhook events dispatched');
  } catch (err) {
    log.error({ err, orgId, issueId, eventType }, 'Failed to dispatch webhook events');
  }
}
