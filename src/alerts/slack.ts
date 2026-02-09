import type { Issue } from '../models/types.js';
import { getEnv } from '../config/env.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('alert-slack');

/**
 * Rate limiter: max 1 Slack message per second to avoid Slack API rate limits.
 */
let lastSentAt = 0;
const MIN_INTERVAL_MS = 1000;

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastSentAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_INTERVAL_MS - elapsed));
  }
  lastSentAt = Date.now();
}

/**
 * Severity-to-color mapping for Slack attachments.
 */
function severityColor(severity: string): string {
  switch (severity) {
    case 'critical':
      return '#dc2626'; // red
    case 'warning':
      return '#f59e0b'; // yellow/amber
    case 'info':
      return '#3b82f6'; // blue
    default:
      return '#6b7280'; // gray
  }
}

/**
 * Severity-to-emoji mapping for the title.
 */
function severityEmoji(severity: string): string {
  switch (severity) {
    case 'critical':
      return '\u{1F6A8}'; // rotating light
    case 'warning':
      return '\u{26A0}\u{FE0F}'; // warning
    case 'info':
      return '\u{2139}\u{FE0F}'; // info
    default:
      return '\u{1F514}'; // bell
  }
}

/**
 * Format an issue as a rich Slack Block Kit message.
 */
function formatSlackMessage(issue: Issue, dashboardUrl: string) {
  const emoji = severityEmoji(issue.severity);
  const color = severityColor(issue.severity);
  const revenueImpact = issue.estimatedRevenueCents
    ? `$${(issue.estimatedRevenueCents / 100).toFixed(2)}`
    : 'Unknown';
  const confidence = issue.confidence
    ? `${Math.round(issue.confidence * 100)}%`
    : 'N/A';
  const issueUrl = `${dashboardUrl}/issues/${issue.id}`;

  return {
    attachments: [
      {
        color,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `${emoji} ${issue.severity.charAt(0).toUpperCase() + issue.severity.slice(1)} Billing Issue Detected`,
              emoji: true,
            },
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Type:*\n\`${issue.issueType}\``,
              },
              {
                type: 'mrkdwn',
                text: `*Severity:*\n${issue.severity.toUpperCase()}`,
              },
              {
                type: 'mrkdwn',
                text: `*Revenue Impact:*\n${revenueImpact}`,
              },
              {
                type: 'mrkdwn',
                text: `*Confidence:*\n${confidence}`,
              },
            ],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${issue.title}*\n${issue.description}`,
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'View in Dashboard \u2192',
                  emoji: true,
                },
                url: issueUrl,
                style: 'primary',
              },
            ],
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `Detected at ${new Date(issue.createdAt).toISOString()} | Issue ID: ${issue.id}`,
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Format a test alert for verifying the Slack webhook.
 */
function formatTestMessage(dashboardUrl: string) {
  return {
    attachments: [
      {
        color: '#22c55e', // green
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '\u2705 RevBack Test Alert',
              emoji: true,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'Your Slack integration is working correctly. You will receive alerts here when billing issues are detected.',
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'Open Dashboard \u2192',
                  emoji: true,
                },
                url: dashboardUrl,
                style: 'primary',
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Send an issue alert to a Slack webhook URL.
 */
export async function sendSlackAlert(
  webhookUrl: string,
  issue: Issue,
): Promise<{ success: boolean; error?: string }> {
  try {
    const env = getEnv();
    await waitForRateLimit();

    const payload = formatSlackMessage(issue, env.DASHBOARD_URL);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      log.warn({ status: response.status, body, issueId: issue.id }, 'Slack webhook failed');
      return { success: false, error: `Slack returned ${response.status}: ${body}` };
    }

    log.info({ issueId: issue.id }, 'Slack alert sent');
    return { success: true };
  } catch (err: any) {
    log.error({ err, issueId: issue.id }, 'Slack alert delivery error');
    return { success: false, error: err.message };
  }
}

/**
 * Send a test message to a Slack webhook URL.
 */
export async function sendSlackTestAlert(
  webhookUrl: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const env = getEnv();
    await waitForRateLimit();

    const payload = formatTestMessage(env.DASHBOARD_URL);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      log.warn({ status: response.status, body }, 'Slack test webhook failed');
      return { success: false, error: `Slack returned ${response.status}: ${body}` };
    }

    log.info('Slack test alert sent');
    return { success: true };
  } catch (err: any) {
    log.error({ err }, 'Slack test alert delivery error');
    return { success: false, error: err.message };
  }
}
