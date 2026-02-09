import { eq } from 'drizzle-orm';
import type { Database } from '../config/database.js';
import type { Issue } from '../models/types.js';
import { organizations } from '../models/schema.js';
import { getSlackClient, isSlackEnabled } from './client.js';
import { formatCxNotification } from './formatters.js';
import { getEnv } from '../config/env.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('slack-cx-notify');

/**
 * Post a critical issue alert to the CX channel.
 * Called after dispatchAlert() in the detection engine for critical/warning issues.
 * Never throws — CX notification failures should not block the detection pipeline.
 */
export async function notifyCxChannel(
  db: Database,
  orgId: string,
  issue: Issue,
): Promise<void> {
  try {
    if (!isSlackEnabled()) return;

    const env = getEnv();
    const channelId = env.SLACK_CX_CHANNEL_ID;
    if (!channelId) return;

    // Only notify for critical and warning severity
    if (issue.severity !== 'critical' && issue.severity !== 'warning') return;

    const client = getSlackClient();
    if (!client) return;

    // Get org name for context
    const [org] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    const orgName = org?.name || 'Unknown Org';
    const message = formatCxNotification(issue, orgName);

    await client.chat.postMessage({
      channel: channelId,
      text: message.text,
      attachments: message.attachments as any,
    });

    log.info(
      { issueId: issue.id, orgId, severity: issue.severity },
      'CX notification sent',
    );
  } catch (err) {
    log.error({ err, issueId: issue.id }, 'Failed to send CX notification');
  }
}
