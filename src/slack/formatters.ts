import type { SlackMessage, SlackBlock } from './types.js';
import type { Issue, User, Entitlement, UserIdentity, BillingConnection } from '../models/types.js';
import { getEnv } from '../config/env.js';
import type { Investigation } from '../agents/investigator.js';

// ─── Helpers ────────────────────────────────────────────────────────

function severityEmoji(severity: string): string {
  switch (severity) {
    case 'critical': return '\u{1F6A8}';
    case 'warning': return '\u{26A0}\u{FE0F}';
    case 'info': return '\u{2139}\u{FE0F}';
    default: return '\u{1F514}';
  }
}

function severityColor(severity: string): string {
  switch (severity) {
    case 'critical': return '#dc2626';
    case 'warning': return '#f59e0b';
    case 'info': return '#3b82f6';
    default: return '#6b7280';
  }
}

function stateEmoji(state: string): string {
  switch (state) {
    case 'active': return '\u{2705}';
    case 'trial': return '\u{1F3AF}';
    case 'expired': return '\u{274C}';
    case 'grace_period': case 'billing_retry': case 'past_due': return '\u{26A0}\u{FE0F}';
    case 'paused': return '\u{23F8}\u{FE0F}';
    case 'revoked': case 'refunded': return '\u{1F6AB}';
    default: return '\u{2B1C}';
  }
}

function formatCents(cents: number | null | undefined): string {
  if (cents == null) return 'Unknown';
  return `$${(cents / 100).toFixed(2)}`;
}

function dashboardUrl(): string {
  return getEnv().DASHBOARD_URL;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

// ─── User Lookup Response ───────────────────────────────────────────

export function formatUserLookup(
  user: User,
  orgName: string,
  identities: UserIdentity[],
  entitlementList: Entitlement[],
  openIssues: Issue[],
): SlackMessage {
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `\u{1F464} User Profile`, emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Email:*\n${user.email || 'N/A'}` },
        { type: 'mrkdwn', text: `*External ID:*\n\`${user.externalUserId || 'N/A'}\`` },
        { type: 'mrkdwn', text: `*Organization:*\n${orgName}` },
        { type: 'mrkdwn', text: `*RevBack ID:*\n\`${user.id.slice(0, 8)}...\`` },
      ],
    },
  ];

  // Identities
  if (identities.length > 0) {
    const identityLines = identities.map(
      (id) => `\u{2022} *${id.source}* (${id.idType}): \`${id.externalId}\``
    ).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Cross-Platform Identities:*\n${identityLines}` },
    });
  }

  // Entitlements
  if (entitlementList.length > 0) {
    const entLines = entitlementList.map(
      (e) => `${stateEmoji(e.state)} *${e.source}* \u2014 ${e.state.toUpperCase()}${e.currentPeriodEnd ? ` (until ${new Date(e.currentPeriodEnd).toLocaleDateString()})` : ''}`
    ).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Entitlements:*\n${entLines}` },
    });
  } else {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*Entitlements:* None found' },
    });
  }

  // Open Issues
  if (openIssues.length > 0) {
    const issueLines = openIssues.slice(0, 5).map(
      (i) => `${severityEmoji(i.severity)} \`${i.issueType}\` \u2014 ${truncate(i.title, 60)} (${formatCents(i.estimatedRevenueCents)})`
    ).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Open Issues (${openIssues.length}):*\n${issueLines}` },
    });
  } else {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*Open Issues:* \u{2705} None' },
    });
  }

  blocks.push({
    type: 'actions',
    elements: [{
      type: 'button',
      text: { type: 'plain_text', text: 'View in Dashboard \u2192', emoji: true },
      url: `${dashboardUrl()}/users/${user.id}`,
      style: 'primary',
    }],
  });

  return { blocks, response_type: 'ephemeral' };
}

// ─── Issues Summary Response ────────────────────────────────────────

export function formatIssuesSummary(
  orgName: string,
  orgId: string,
  stats: {
    open: number;
    critical: number;
    revenueAtRiskCents: number;
    byType: Array<{ issueType: string; count: number; revenue: string | number | null }>;
  },
  topIssues: Issue[],
): SlackMessage {
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `\u{1F4CB} Issues for ${orgName}`, emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Open Issues:*\n${stats.open}` },
        { type: 'mrkdwn', text: `*Critical:*\n${stats.critical}` },
        { type: 'mrkdwn', text: `*Revenue at Risk:*\n${formatCents(stats.revenueAtRiskCents)}` },
        { type: 'mrkdwn', text: `*Issue Types:*\n${stats.byType.length}` },
      ],
    },
  ];

  // Breakdown by type
  if (stats.byType.length > 0) {
    const typeLines = stats.byType
      .sort((a, b) => (Number(b.revenue) || 0) - (Number(a.revenue) || 0))
      .slice(0, 8)
      .map((t) => `\u{2022} \`${t.issueType}\`: ${t.count} issues (${formatCents(Number(t.revenue) || 0)})`)
      .join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*By Type:*\n${typeLines}` },
    });
  }

  // Top critical issues
  if (topIssues.length > 0) {
    blocks.push({ type: 'divider' } as SlackBlock);
    const issueLines = topIssues.slice(0, 5).map(
      (i) => `${severityEmoji(i.severity)} *${truncate(i.title, 50)}*\n    \`${i.issueType}\` | ${formatCents(i.estimatedRevenueCents)} | ${i.confidence ? Math.round(i.confidence * 100) + '%' : 'N/A'} confidence`
    ).join('\n\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Top Issues:*\n\n${issueLines}` },
    });
  }

  blocks.push({
    type: 'actions',
    elements: [{
      type: 'button',
      text: { type: 'plain_text', text: 'View All Issues \u2192', emoji: true },
      url: `${dashboardUrl()}/issues`,
      style: 'primary',
    }],
  });

  return { blocks, response_type: 'ephemeral' };
}

// ─── Status Response ────────────────────────────────────────────────

export function formatStatus(
  orgName: string,
  connections: BillingConnection[],
  webhookStats: { total: number; recentFailures: number; lastWebhookAt: Date | null },
): SlackMessage {
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `\u{1F4E1} Integration Status: ${orgName}`, emoji: true },
    },
  ];

  if (connections.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: 'No billing connections configured.' },
    });
  } else {
    const connLines = connections.map((conn) => {
      const status = conn.isActive ? '\u{2705} Connected' : '\u{274C} Disconnected';
      const lastSync = conn.lastSyncAt
        ? `Last sync: ${new Date(conn.lastSyncAt).toLocaleString()}`
        : 'Never synced';
      const lastWebhook = conn.lastWebhookAt
        ? `Last webhook: ${new Date(conn.lastWebhookAt).toLocaleString()}`
        : 'No webhooks received';
      return `*${conn.source.toUpperCase()}:* ${status}\n    ${lastSync} | ${lastWebhook}`;
    }).join('\n\n');

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: connLines },
    });
  }

  // Webhook health
  blocks.push({
    type: 'section',
    fields: [
      { type: 'mrkdwn', text: `*Webhooks (24h):*\n${webhookStats.total}` },
      { type: 'mrkdwn', text: `*Recent Failures:*\n${webhookStats.recentFailures > 0 ? `\u{26A0}\u{FE0F} ${webhookStats.recentFailures}` : '\u{2705} 0'}` },
      { type: 'mrkdwn', text: `*Last Webhook:*\n${webhookStats.lastWebhookAt ? new Date(webhookStats.lastWebhookAt).toLocaleString() : 'N/A'}` },
    ],
  });

  blocks.push({
    type: 'actions',
    elements: [{
      type: 'button',
      text: { type: 'plain_text', text: 'View Setup \u2192', emoji: true },
      url: `${dashboardUrl()}/setup`,
      style: 'primary',
    }],
  });

  return { blocks, response_type: 'ephemeral' };
}

// ─── Investigation Response ─────────────────────────────────────────

export function formatInvestigation(
  issue: Issue,
  investigation: Investigation,
): SlackMessage {
  const emoji = severityEmoji(issue.severity);
  const confidence = Math.round(investigation.confidence * 100);

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${emoji} Investigation: ${truncate(issue.title, 60)}`, emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Issue Type:*\n\`${issue.issueType}\`` },
        { type: 'mrkdwn', text: `*Severity:*\n${issue.severity.toUpperCase()}` },
        { type: 'mrkdwn', text: `*AI Confidence:*\n${confidence}%` },
        { type: 'mrkdwn', text: `*Revenue Impact:*\n${formatCents(issue.estimatedRevenueCents)}` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Root Cause:*\n${investigation.rootCause}` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Impact:*\n${investigation.impact}` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Recommendation:*\n${investigation.recommendation}` },
    },
  ];

  if (investigation.reasoning) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Reasoning:*\n${truncate(investigation.reasoning, 500)}` },
    });
  }

  blocks.push({
    type: 'actions',
    elements: [{
      type: 'button',
      text: { type: 'plain_text', text: 'View Issue \u2192', emoji: true },
      url: `${dashboardUrl()}/issues/${issue.id}`,
      style: 'primary',
    }],
  });

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `Investigation generated at ${investigation.generatedAt} | Issue ID: ${issue.id}`,
    }],
  });

  return { blocks, response_type: 'ephemeral' };
}

// ─── CX Notification (proactive alert to CX channel) ───────────────

export function formatCxNotification(issue: Issue, orgName: string): SlackMessage {
  const emoji = severityEmoji(issue.severity);
  const color = severityColor(issue.severity);

  return {
    text: `${emoji} ${issue.severity.toUpperCase()} issue detected for ${orgName}`,
    attachments: [{
      color,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `${emoji} CX Alert: ${issue.severity.toUpperCase()} Issue for ${orgName}`,
            emoji: true,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Type:*\n\`${issue.issueType}\`` },
            { type: 'mrkdwn', text: `*Severity:*\n${issue.severity.toUpperCase()}` },
            { type: 'mrkdwn', text: `*Revenue Impact:*\n${formatCents(issue.estimatedRevenueCents)}` },
            { type: 'mrkdwn', text: `*Confidence:*\n${issue.confidence ? Math.round(issue.confidence * 100) + '%' : 'N/A'}` },
          ],
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*${issue.title}*\n${truncate(issue.description, 300)}` },
        },
        {
          type: 'actions',
          elements: [{
            type: 'button',
            text: { type: 'plain_text', text: 'Investigate \u2192', emoji: true },
            url: `${dashboardUrl()}/issues/${issue.id}`,
            style: 'primary',
          }],
        },
        {
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: `Detected at ${new Date(issue.createdAt).toISOString()} | Issue ID: ${issue.id} | Use \`/rb investigate ${issue.id}\` for AI analysis`,
          }],
        },
      ],
    }],
  };
}

// ─── Help Response ──────────────────────────────────────────────────

export function formatHelp(): SlackMessage {
  return {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '\u{1F4D6} RevBack CX Bot \u2014 Command Reference', emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            '*Available Commands:*',
            '',
            '\u{2022} `/rb lookup <email|ID>` \u2014 Search for a user across all organizations. Accepts email, external user ID, or billing platform ID (Stripe customer_id, etc.)',
            '',
            '\u{2022} `/rb issues <org-slug>` \u2014 Show open issue summary and top critical issues for an organization',
            '',
            '\u{2022} `/rb status <org-slug>` \u2014 Check integration health (connections, webhook freshness)',
            '',
            '\u{2022} `/rb investigate <issue-id>` \u2014 Run AI root cause analysis on a specific issue (may take 10-30s)',
            '',
            '\u{2022} `/rb help` \u2014 Show this help message',
          ].join('\n'),
        },
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: 'All responses are ephemeral (only visible to you). Sensitive data is never posted publicly.',
        }],
      },
    ],
    response_type: 'ephemeral',
  };
}

// ─── Error Response ─────────────────────────────────────────────────

export function formatError(message: string): SlackMessage {
  return {
    blocks: [{
      type: 'section',
      text: { type: 'mrkdwn', text: `\u{274C} ${message}` },
    }],
    response_type: 'ephemeral',
  };
}

export function formatUnauthorized(): SlackMessage {
  return formatError('You are not authorized to use RevBack CX commands. Contact your admin to be added to the CX engineer allowlist.');
}
