import { eq, and } from 'drizzle-orm';
import type { Database } from '../../config/database.js';
import { issues, organizations } from '../../models/schema.js';
import type { SlackMessage } from '../types.js';
import { formatInvestigation, formatError } from '../formatters.js';
import { investigateIssue } from '../../agents/investigator.js';
import { isAiEnabled } from '../../agents/client.js';
import { createChildLogger } from '../../config/logger.js';

const log = createChildLogger('slack-investigate');

/**
 * /rb investigate <issue-id>
 *
 * Runs AI root cause analysis on an issue. Uses deferred response
 * pattern (responds via response_url) since AI calls take 10-30s.
 */
export async function handleInvestigate(
  db: Database,
  args: string,
  responseUrl: string,
): Promise<SlackMessage> {
  const issueId = args.trim();
  if (!issueId) {
    return formatError('Usage: `/rb investigate <issue-id>`\n\nProvide the issue UUID.');
  }

  if (!isAiEnabled()) {
    return formatError('AI features are not configured. Set `ANTHROPIC_API_KEY` to enable investigations.');
  }

  // Find the issue (cross-org for CX)
  const [issue] = await db
    .select()
    .from(issues)
    .where(eq(issues.id, issueId))
    .limit(1);

  if (!issue) {
    return formatError(`Issue "${issueId}" not found. Check the ID and try again.`);
  }

  log.info({ issueId, orgId: issue.orgId }, 'CX investigation requested');

  // Start async investigation and respond via response_url
  investigateAndRespond(db, issue.orgId, issueId, responseUrl).catch((err) => {
    log.error({ err, issueId }, 'Background investigation failed');
  });

  // Immediate acknowledgment
  return {
    blocks: [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `\u{1F52C} Investigating issue \`${issueId.slice(0, 8)}...\` \u2014 AI analysis in progress, results will appear here in 10-30 seconds...`,
      },
    }],
    response_type: 'ephemeral',
  };
}

async function investigateAndRespond(
  db: Database,
  orgId: string,
  issueId: string,
  responseUrl: string,
): Promise<void> {
  try {
    const investigation = await investigateIssue(db, orgId, issueId);

    if (!investigation) {
      await sendDeferredResponse(responseUrl, formatError('AI investigation returned no results. The issue may lack sufficient context.'));
      return;
    }

    // Fetch the issue again for the response formatter
    const [issue] = await db
      .select()
      .from(issues)
      .where(and(eq(issues.orgId, orgId), eq(issues.id, issueId)))
      .limit(1);

    if (!issue) {
      await sendDeferredResponse(responseUrl, formatError('Issue not found after investigation.'));
      return;
    }

    const message = formatInvestigation(issue, investigation);
    message.replace_original = true;
    await sendDeferredResponse(responseUrl, message);

    log.info({ issueId }, 'Investigation response sent to Slack');
  } catch (err) {
    log.error({ err, issueId }, 'Investigation failed');
    await sendDeferredResponse(responseUrl, formatError('Investigation failed. Please try again or check logs.'));
  }
}

async function sendDeferredResponse(responseUrl: string, message: SlackMessage): Promise<void> {
  try {
    const response = await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const text = await response.text();
      log.warn({ status: response.status, body: text }, 'Deferred response to Slack failed');
    }
  } catch (err) {
    log.error({ err }, 'Failed to send deferred response to Slack');
  }
}
