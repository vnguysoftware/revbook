import { eq, and, desc, count, sum, sql } from 'drizzle-orm';
import type { Database } from '../config/database.js';
import {
  users,
  userIdentities,
  entitlements,
  issues,
  organizations,
  billingConnections,
  canonicalEvents,
} from '../models/schema.js';
import { callClaude, isAiEnabled } from '../agents/client.js';
import { getSlackClient } from './client.js';
import { isCxEngineer } from './cx-auth.js';
import { createChildLogger } from '../config/logger.js';
import { getRedisConnection } from '../config/queue.js';

const log = createChildLogger('slack-conversation');

// ─── Rate Limiting ──────────────────────────────────────────────────

const aiConversationRates = new Map<string, number[]>();
const MAX_AI_CONVERSATIONS_PER_HOUR = 10;

function checkAiRate(userId: string): boolean {
  const now = Date.now();
  const windowStart = now - 3_600_000;
  let timestamps = aiConversationRates.get(userId) || [];
  timestamps = timestamps.filter((ts) => ts > windowStart);
  timestamps.push(now);
  aiConversationRates.set(userId, timestamps);
  return timestamps.length <= MAX_AI_CONVERSATIONS_PER_HOUR;
}

// ─── Tool Definitions ──────────────────────────────────────────────

interface ToolResult {
  name: string;
  result: unknown;
}

const TOOL_DEFINITIONS = [
  {
    name: 'search_user',
    description: 'Search for a user across all organizations by email, external user ID, or billing platform ID',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Email, external user ID, or billing platform ID' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_user_profile',
    description: 'Get detailed user profile including identities, entitlements, issues, and recent events',
    input_schema: {
      type: 'object' as const,
      properties: {
        user_id: { type: 'string', description: 'RevBack user UUID' },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'get_issues_summary',
    description: 'Get open issue summary and stats for an organization',
    input_schema: {
      type: 'object' as const,
      properties: {
        org_slug: { type: 'string', description: 'Organization slug' },
      },
      required: ['org_slug'],
    },
  },
  {
    name: 'get_issue_detail',
    description: 'Get full details for a specific issue including evidence',
    input_schema: {
      type: 'object' as const,
      properties: {
        issue_id: { type: 'string', description: 'Issue UUID' },
      },
      required: ['issue_id'],
    },
  },
  {
    name: 'get_integration_status',
    description: 'Get billing connection and webhook health for an organization',
    input_schema: {
      type: 'object' as const,
      properties: {
        org_slug: { type: 'string', description: 'Organization slug' },
      },
      required: ['org_slug'],
    },
  },
  {
    name: 'get_revenue_impact',
    description: 'Get total revenue at risk from open issues for an organization',
    input_schema: {
      type: 'object' as const,
      properties: {
        org_slug: { type: 'string', description: 'Organization slug' },
      },
      required: ['org_slug'],
    },
  },
];

const SYSTEM_PROMPT = `You are RevBack CX Bot, an AI assistant for customer experience engineers at RevBack.
RevBack detects payment and subscription billing issues across platforms (Stripe, Apple App Store, Google Play).

Your role:
- Help CX engineers quickly investigate and respond to customer questions about billing issues
- Use your tools to query RevBack data and provide concise, actionable answers
- After analyzing data, draft a customer-facing response the CX engineer can copy-paste

Guidelines:
- Be concise and structured — CX engineers need quick answers
- Always use tools to fetch real data — never guess or hallucinate
- When drafting customer-facing messages, be professional and empathetic
- Format responses for Slack (use *bold*, \`code\`, bullet points)
- Mention specific data points (issue IDs, dates, amounts) to support your analysis
- If you can't find relevant data, say so clearly`;

// ─── Conversation Handler ──────────────────────────────────────────

/**
 * Handle an @mention or DM to the bot in conversational AI mode.
 * Uses Claude with tools to query RevBack data and generate responses.
 */
export async function handleConversation(
  db: Database,
  userId: string,
  text: string,
  channelId: string,
  threadTs: string | undefined,
  messageTs: string,
): Promise<void> {
  try {
    // Auth check
    if (!isCxEngineer(userId)) {
      await postMessage(channelId, messageTs, 'You are not authorized to use RevBack CX Bot.');
      return;
    }

    if (!isAiEnabled()) {
      await postMessage(channelId, messageTs, 'AI features are not configured. Set `ANTHROPIC_API_KEY` to enable conversations.');
      return;
    }

    // Rate limit check
    if (!checkAiRate(userId)) {
      await postMessage(channelId, messageTs, 'AI rate limit reached (max 10 conversations/hour). Try again later or use slash commands.');
      return;
    }

    // Use the thread timestamp for conversation continuity, or the message ts
    const conversationKey = threadTs || messageTs;

    // Load conversation history from Redis
    const history = await loadConversationHistory(conversationKey);
    history.push({ role: 'user' as const, content: text });

    // Post a thinking indicator
    const client = getSlackClient();
    if (!client) return;

    // Run Claude with tools
    const response = await runConversationTurn(db, history);

    if (response) {
      // Save updated history
      history.push({ role: 'assistant' as const, content: response });
      await saveConversationHistory(conversationKey, history);

      // Post response in thread
      await postMessage(channelId, threadTs || messageTs, response);
    }
  } catch (err) {
    log.error({ err, userId, channelId }, 'Conversation handler error');
    await postMessage(channelId, threadTs || messageTs, 'An error occurred while processing your message. Please try again.');
  }
}

async function runConversationTurn(
  db: Database,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<string | null> {
  // Use callClaude with a tool-use prompt pattern
  // Since our callClaude doesn't support tools natively, we'll simulate with structured prompts
  const toolDescriptions = TOOL_DEFINITIONS.map(
    (t) => `- **${t.name}**: ${t.description}`
  ).join('\n');

  const systemPrompt = `${SYSTEM_PROMPT}

You have access to these data query tools:
${toolDescriptions}

To use a tool, respond with a JSON block like:
\`\`\`tool_call
{"tool": "tool_name", "args": {"param": "value"}}
\`\`\`

You can make multiple tool calls. After getting results, provide your final answer to the CX engineer.
If no tools are needed, respond directly.`;

  // First pass: let Claude decide what tools to call
  let response = await callClaude({
    systemPrompt,
    messages,
    maxTokens: 2048,
    temperature: 0.3,
  });

  if (!response) return null;

  let content = response.content;

  // Check for tool calls and execute them (up to 3 rounds)
  for (let round = 0; round < 3; round++) {
    const toolCalls = extractToolCalls(content);
    if (toolCalls.length === 0) break;

    const results: ToolResult[] = [];
    for (const call of toolCalls) {
      const result = await executeToolCall(db, call.tool, call.args);
      results.push({ name: call.tool, result });
    }

    // Feed results back to Claude for final answer
    const resultsText = results.map(
      (r) => `Tool: ${r.name}\nResult:\n${JSON.stringify(r.result, null, 2)}`
    ).join('\n\n---\n\n');

    const followUp = await callClaude({
      systemPrompt,
      messages: [
        ...messages,
        { role: 'assistant' as const, content },
        { role: 'user' as const, content: `Tool results:\n\n${resultsText}\n\nNow provide your answer based on these results.` },
      ],
      maxTokens: 2048,
      temperature: 0.3,
    });

    if (!followUp) break;
    content = followUp.content;
  }

  // Clean out any remaining tool call blocks from the final response
  return content.replace(/```tool_call\n[\s\S]*?```/g, '').trim();
}

function extractToolCalls(text: string): Array<{ tool: string; args: Record<string, string> }> {
  const calls: Array<{ tool: string; args: Record<string, string> }> = [];
  const regex = /```tool_call\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.tool && TOOL_DEFINITIONS.some((t) => t.name === parsed.tool)) {
        calls.push({ tool: parsed.tool, args: parsed.args || {} });
      }
    } catch {
      // Skip malformed tool calls
    }
  }
  return calls;
}

// ─── Tool Execution ────────────────────────────────────────────────

async function executeToolCall(
  db: Database,
  toolName: string,
  args: Record<string, string>,
): Promise<unknown> {
  try {
    switch (toolName) {
      case 'search_user':
        return await toolSearchUser(db, args.query);
      case 'get_user_profile':
        return await toolGetUserProfile(db, args.user_id);
      case 'get_issues_summary':
        return await toolGetIssuesSummary(db, args.org_slug);
      case 'get_issue_detail':
        return await toolGetIssueDetail(db, args.issue_id);
      case 'get_integration_status':
        return await toolGetIntegrationStatus(db, args.org_slug);
      case 'get_revenue_impact':
        return await toolGetRevenueImpact(db, args.org_slug);
      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err: any) {
    log.error({ err, toolName }, 'Tool execution error');
    return { error: err.message };
  }
}

async function toolSearchUser(db: Database, query: string) {
  // Search across all orgs
  const byEmail = await db.select().from(users).where(eq(users.email, query)).limit(5);
  if (byEmail.length > 0) return { users: byEmail };

  const byExternalId = await db.select().from(users).where(eq(users.externalUserId, query)).limit(5);
  if (byExternalId.length > 0) return { users: byExternalId };

  const byIdentity = await db
    .select({ userId: userIdentities.userId, orgId: userIdentities.orgId })
    .from(userIdentities)
    .where(eq(userIdentities.externalId, query))
    .limit(5);

  if (byIdentity.length > 0) {
    const foundUsers = await db
      .select()
      .from(users)
      .where(eq(users.id, byIdentity[0].userId))
      .limit(5);
    return { users: foundUsers };
  }

  // Partial email search
  const partial = await db
    .select()
    .from(users)
    .where(sql`${users.email} ILIKE ${'%' + query + '%'}`)
    .limit(5);

  return { users: partial };
}

async function toolGetUserProfile(db: Database, userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return { error: 'User not found' };

  const [identityList, entitlementList, openIssues, recentEvents] = await Promise.all([
    db.select().from(userIdentities).where(eq(userIdentities.userId, userId)),
    db.select().from(entitlements).where(eq(entitlements.userId, userId)),
    db.select().from(issues).where(and(eq(issues.userId, userId), eq(issues.status, 'open'))).orderBy(desc(issues.createdAt)).limit(10),
    db.select({
      id: canonicalEvents.id,
      source: canonicalEvents.source,
      eventType: canonicalEvents.eventType,
      eventTime: canonicalEvents.eventTime,
      status: canonicalEvents.status,
      amountCents: canonicalEvents.amountCents,
    }).from(canonicalEvents).where(eq(canonicalEvents.userId, userId)).orderBy(desc(canonicalEvents.eventTime)).limit(20),
  ]);

  return { user, identities: identityList, entitlements: entitlementList, openIssues, recentEvents };
}

async function toolGetIssuesSummary(db: Database, orgSlug: string) {
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, orgSlug)).limit(1);
  if (!org) return { error: `Organization "${orgSlug}" not found` };

  const [openCount] = await db.select({ count: count() }).from(issues)
    .where(and(eq(issues.orgId, org.id), eq(issues.status, 'open')));
  const [criticalCount] = await db.select({ count: count() }).from(issues)
    .where(and(eq(issues.orgId, org.id), eq(issues.status, 'open'), eq(issues.severity, 'critical')));
  const [revenue] = await db.select({ total: sum(issues.estimatedRevenueCents) }).from(issues)
    .where(and(eq(issues.orgId, org.id), eq(issues.status, 'open')));

  const topIssues = await db.select().from(issues)
    .where(and(eq(issues.orgId, org.id), eq(issues.status, 'open')))
    .orderBy(desc(issues.severity), desc(issues.estimatedRevenueCents))
    .limit(10);

  return {
    orgName: org.name,
    open: openCount.count,
    critical: criticalCount.count,
    revenueAtRiskCents: Number(revenue.total) || 0,
    topIssues: topIssues.map((i) => ({
      id: i.id,
      type: i.issueType,
      severity: i.severity,
      title: i.title,
      revenue: i.estimatedRevenueCents,
      confidence: i.confidence,
    })),
  };
}

async function toolGetIssueDetail(db: Database, issueId: string) {
  const [issue] = await db.select().from(issues).where(eq(issues.id, issueId)).limit(1);
  if (!issue) return { error: 'Issue not found' };
  return { issue };
}

async function toolGetIntegrationStatus(db: Database, orgSlug: string) {
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, orgSlug)).limit(1);
  if (!org) return { error: `Organization "${orgSlug}" not found` };

  const connections = await db.select().from(billingConnections).where(eq(billingConnections.orgId, org.id));

  return {
    orgName: org.name,
    connections: connections.map((c) => ({
      source: c.source,
      isActive: c.isActive,
      lastSyncAt: c.lastSyncAt,
      lastWebhookAt: c.lastWebhookAt,
      syncStatus: c.syncStatus,
    })),
  };
}

async function toolGetRevenueImpact(db: Database, orgSlug: string) {
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, orgSlug)).limit(1);
  if (!org) return { error: `Organization "${orgSlug}" not found` };

  const [total] = await db.select({ total: sum(issues.estimatedRevenueCents) }).from(issues)
    .where(and(eq(issues.orgId, org.id), eq(issues.status, 'open')));

  const bySeverity = await db
    .select({ severity: issues.severity, count: count(), revenue: sum(issues.estimatedRevenueCents) })
    .from(issues)
    .where(and(eq(issues.orgId, org.id), eq(issues.status, 'open')))
    .groupBy(issues.severity);

  return {
    orgName: org.name,
    totalRevenueAtRiskCents: Number(total.total) || 0,
    bySeverity,
  };
}

// ─── Conversation History (Redis) ──────────────────────────────────

const CONVERSATION_TTL = 1800; // 30 minutes

async function loadConversationHistory(
  key: string,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  try {
    const redis = getRedisConnection();
    const data = await redis.get(`revback:slack:conv:${key}`);
    if (data) return JSON.parse(data);
  } catch (err) {
    log.debug({ err }, 'Failed to load conversation history');
  }
  return [];
}

async function saveConversationHistory(
  key: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<void> {
  try {
    const redis = getRedisConnection();
    // Keep last 10 messages to manage context window
    const trimmed = history.slice(-10);
    await redis.set(`revback:slack:conv:${key}`, JSON.stringify(trimmed), 'EX', CONVERSATION_TTL);
  } catch (err) {
    log.debug({ err }, 'Failed to save conversation history');
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

async function postMessage(channel: string, threadTs: string, text: string): Promise<void> {
  try {
    const client = getSlackClient();
    if (!client) return;

    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text,
    });
  } catch (err) {
    log.error({ err, channel }, 'Failed to post Slack message');
  }
}
