import { eq, and, gte, count } from 'drizzle-orm';
import type { Database } from '../../config/database.js';
import { billingConnections, webhookLogs, organizations } from '../../models/schema.js';
import type { SlackMessage } from '../types.js';
import { formatStatus, formatError } from '../formatters.js';
import { createChildLogger } from '../../config/logger.js';

const log = createChildLogger('slack-status');

/**
 * /rb status <org-slug>
 *
 * Check integration health: billing connections and webhook freshness.
 */
export async function handleStatus(db: Database, args: string): Promise<SlackMessage> {
  const slug = args.trim();
  if (!slug) {
    return formatError('Usage: `/rb status <org-slug>`\n\nProvide the organization slug.');
  }

  // Find org
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);

  if (!org) {
    return formatError(`Organization "${slug}" not found. Check the slug and try again.`);
  }

  log.info({ orgId: org.id, slug }, 'CX status check');

  // Get billing connections
  const connections = await db
    .select()
    .from(billingConnections)
    .where(eq(billingConnections.orgId, org.id));

  // Get webhook stats for last 24h
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [totalWebhooks] = await db
    .select({ count: count() })
    .from(webhookLogs)
    .where(and(eq(webhookLogs.orgId, org.id), gte(webhookLogs.createdAt, dayAgo)));

  const [failedWebhooks] = await db
    .select({ count: count() })
    .from(webhookLogs)
    .where(
      and(
        eq(webhookLogs.orgId, org.id),
        gte(webhookLogs.createdAt, dayAgo),
        eq(webhookLogs.processingStatus, 'failed'),
      ),
    );

  // Find the most recent webhook timestamp from connections
  let lastWebhookAt: Date | null = null;
  for (const conn of connections) {
    if (conn.lastWebhookAt && (!lastWebhookAt || conn.lastWebhookAt > lastWebhookAt)) {
      lastWebhookAt = conn.lastWebhookAt;
    }
  }

  return formatStatus(org.name, connections, {
    total: totalWebhooks.count,
    recentFailures: failedWebhooks.count,
    lastWebhookAt,
  });
}
