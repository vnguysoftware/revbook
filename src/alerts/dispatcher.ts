import { eq, and } from 'drizzle-orm';
import type { Database } from '../config/database.js';
import { alertConfigurations, alertDeliveryLogs } from '../models/schema.js';
import type { Issue, SlackAlertConfig, EmailAlertConfig, WebhookAlertConfig } from '../models/types.js';
import { sendSlackAlert } from './slack.js';
import { sendEmailAlert } from './email.js';
import { enqueueWebhookDelivery } from '../queue/webhook-delivery-worker.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('alert-dispatcher');

/**
 * Alert Dispatcher
 *
 * Central function for dispatching alerts when new issues are detected.
 * Looks up all enabled alert configurations for the org, filters by
 * severity and issue type, and sends to all matching channels.
 */
export async function dispatchAlert(
  db: Database,
  orgId: string,
  issue: Issue,
): Promise<void> {
  try {
    // Fetch all enabled alert configurations for this org
    const configs = await db
      .select()
      .from(alertConfigurations)
      .where(
        and(
          eq(alertConfigurations.orgId, orgId),
          eq(alertConfigurations.enabled, true),
        ),
      );

    if (configs.length === 0) {
      log.debug({ orgId }, 'No alert configurations found for org');
      return;
    }

    for (const config of configs) {
      // Check severity filter
      const severityFilter = config.severityFilter as string[];
      if (!severityFilter.includes(issue.severity)) {
        log.debug(
          { configId: config.id, severity: issue.severity },
          'Issue severity not in filter, skipping',
        );
        continue;
      }

      // Check issue type filter (null = all types)
      const issueTypes = config.issueTypes as string[] | null;
      if (issueTypes && issueTypes.length > 0 && !issueTypes.includes(issue.issueType)) {
        log.debug(
          { configId: config.id, issueType: issue.issueType },
          'Issue type not in filter, skipping',
        );
        continue;
      }

      // Dispatch based on channel type
      let result: { success: boolean; error?: string };

      switch (config.channel) {
        case 'slack': {
          const slackConfig = config.config as unknown as SlackAlertConfig;
          result = await sendSlackAlert(slackConfig.webhookUrl, issue);
          break;
        }
        case 'email': {
          const emailConfig = config.config as unknown as EmailAlertConfig;
          result = await sendEmailAlert(emailConfig.recipients, issue);
          break;
        }
        case 'webhook': {
          const webhookConfig = config.config as unknown as WebhookAlertConfig;
          // Webhooks are delivered async via BullMQ for retries
          await enqueueWebhookDelivery({
            orgId,
            alertConfigId: config.id,
            issueId: issue.id,
            issue,
            config: webhookConfig,
            eventType: 'issue.created',
          });
          result = { success: true };
          break;
        }
        default:
          log.warn({ channel: config.channel }, 'Unknown alert channel');
          continue;
      }

      // Log the delivery attempt (webhook logs its own via the worker)
      if (config.channel !== 'webhook') {
        await db.insert(alertDeliveryLogs).values({
          orgId,
          alertConfigId: config.id,
          issueId: issue.id,
          channel: config.channel,
          status: result.success ? 'sent' : 'failed',
          errorMessage: result.error || null,
        }).catch((err) => {
          log.error({ err, configId: config.id }, 'Failed to log alert delivery');
        });
      }

      if (result.success) {
        log.info(
          { configId: config.id, channel: config.channel, issueId: issue.id },
          'Alert dispatched successfully',
        );
      } else {
        log.warn(
          { configId: config.id, channel: config.channel, issueId: issue.id, error: result.error },
          'Alert dispatch failed',
        );
      }
    }
  } catch (err) {
    log.error({ err, orgId, issueId: issue.id }, 'Alert dispatch error');
    // Don't throw — alert failures should never break the detection pipeline
  }
}
