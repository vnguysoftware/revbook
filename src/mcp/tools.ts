import { z } from 'zod';
import { eq, and, desc, count, sum, gte, sql, inArray } from 'drizzle-orm';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Database } from '../config/database.js';
import {
  issues,
  users,
  userIdentities,
  entitlements,
  canonicalEvents,
  billingConnections,
} from '../models/schema.js';
import { DETECTOR_META, CATEGORY_ISSUE_TYPES, enrichIssue } from '../detection/detector-meta.js';
import { dispatchWebhookEvent } from '../alerts/webhook-events.js';
import type { WebhookEventType } from '../models/types.js';

/**
 * Register all MCP tools on the server.
 *
 * Each tool maps to an existing REST API endpoint — no business logic duplication.
 * Tools receive orgId from the MCP session context (set during auth in transport).
 */
export function registerTools(server: McpServer, db: Database): void {

  // ─── list_issues ──────────────────────────────────────────────────

  server.tool(
    'list_issues',
    'List detected billing issues. Filter by status, severity, type, or category. Returns enriched issues with recommended actions.',
    {
      status: z.enum(['open', 'acknowledged', 'resolved', 'dismissed']).default('open').describe('Issue status filter'),
      severity: z.enum(['critical', 'warning', 'info']).optional().describe('Severity filter'),
      type: z.string().optional().describe('Issue type filter (e.g. duplicate_billing, unrevoked_refund)'),
      category: z.enum(['integration_health', 'cross_platform', 'revenue_protection', 'access_verification']).optional().describe('Category filter'),
      limit: z.number().min(1).max(100).default(20).describe('Max results'),
      offset: z.number().min(0).default(0).describe('Pagination offset'),
    },
    async (params, extra) => {
      const orgId = (extra as any).orgId;
      if (!orgId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Not authenticated' }) }] };

      const categoryTypes = params.category ? CATEGORY_ISSUE_TYPES[params.category] : undefined;

      const whereCondition = and(
        eq(issues.orgId, orgId),
        eq(issues.status, params.status as any),
        params.severity ? eq(issues.severity, params.severity as any) : undefined,
        params.type ? eq(issues.issueType, params.type) : undefined,
        categoryTypes ? inArray(issues.issueType, categoryTypes) : undefined,
      );

      const [totalResult] = await db
        .select({ count: count() })
        .from(issues)
        .where(whereCondition);

      const results = await db
        .select()
        .from(issues)
        .where(whereCondition)
        .orderBy(desc(issues.createdAt))
        .limit(params.limit)
        .offset(params.offset);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            issues: results.map(enrichIssue),
            pagination: { limit: params.limit, offset: params.offset, count: totalResult.count },
          }, null, 2),
        }],
      };
    },
  );

  // ─── get_issue ────────────────────────────────────────────────────

  server.tool(
    'get_issue',
    'Get full details of a specific billing issue including evidence, category, and recommended action.',
    {
      issueId: z.string().uuid().describe('The issue ID'),
    },
    async (params, extra) => {
      const orgId = (extra as any).orgId;
      if (!orgId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Not authenticated' }) }] };

      const [issue] = await db
        .select()
        .from(issues)
        .where(and(eq(issues.orgId, orgId), eq(issues.id, params.issueId)))
        .limit(1);

      if (!issue) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Issue not found' }) }] };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ issue: enrichIssue(issue) }, null, 2),
        }],
      };
    },
  );

  // ─── get_issue_summary ────────────────────────────────────────────

  server.tool(
    'get_issue_summary',
    'Get aggregate stats: open issue count, critical count, revenue at risk, breakdown by type and category.',
    {},
    async (_params, extra) => {
      const orgId = (extra as any).orgId;
      if (!orgId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Not authenticated' }) }] };

      const [openCount] = await db
        .select({ count: count() })
        .from(issues)
        .where(and(eq(issues.orgId, orgId), eq(issues.status, 'open')));

      const [criticalCount] = await db
        .select({ count: count() })
        .from(issues)
        .where(and(eq(issues.orgId, orgId), eq(issues.status, 'open'), eq(issues.severity, 'critical')));

      const [revenueAtRisk] = await db
        .select({ total: sum(issues.estimatedRevenueCents) })
        .from(issues)
        .where(and(eq(issues.orgId, orgId), eq(issues.status, 'open')));

      const byType = await db
        .select({
          issueType: issues.issueType,
          count: count(),
          revenue: sum(issues.estimatedRevenueCents),
        })
        .from(issues)
        .where(and(eq(issues.orgId, orgId), eq(issues.status, 'open')))
        .groupBy(issues.issueType);

      const byCategory: Record<string, { count: number; revenue: number }> = {};
      for (const row of byType) {
        const meta = DETECTOR_META[row.issueType];
        const cat = meta?.category || 'unknown';
        if (!byCategory[cat]) byCategory[cat] = { count: 0, revenue: 0 };
        byCategory[cat].count += row.count;
        byCategory[cat].revenue += Number(row.revenue) || 0;
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            open: openCount.count,
            critical: criticalCount.count,
            revenueAtRiskCents: Number(revenueAtRisk.total) || 0,
            byType: byType.map(row => ({
              ...row,
              category: DETECTOR_META[row.issueType]?.category || 'unknown',
            })),
            byCategory,
          }, null, 2),
        }],
      };
    },
  );

  // ─── lookup_user ──────────────────────────────────────────────────

  server.tool(
    'lookup_user',
    'Look up a user by ID. Returns profile, identities across billing systems, entitlements, open issues, and recent events.',
    {
      userId: z.string().uuid().describe('The user ID'),
    },
    async (params, extra) => {
      const orgId = (extra as any).orgId;
      if (!orgId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Not authenticated' }) }] };

      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.orgId, orgId), eq(users.id, params.userId)))
        .limit(1);

      if (!user) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'User not found' }) }] };
      }

      const [identitiesResult, entsResult, userIssues, recentEvents] = await Promise.all([
        db.select().from(userIdentities).where(eq(userIdentities.userId, params.userId)),
        db.select().from(entitlements).where(and(eq(entitlements.orgId, orgId), eq(entitlements.userId, params.userId))),
        db.select().from(issues).where(and(eq(issues.orgId, orgId), eq(issues.userId, params.userId), eq(issues.status, 'open'))).orderBy(desc(issues.createdAt)).limit(10),
        db.select().from(canonicalEvents).where(and(eq(canonicalEvents.orgId, orgId), eq(canonicalEvents.userId, params.userId))).orderBy(desc(canonicalEvents.eventTime)).limit(20),
      ]);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            user,
            identities: identitiesResult,
            entitlements: entsResult,
            openIssues: userIssues.map(enrichIssue),
            recentEvents,
          }, null, 2),
        }],
      };
    },
  );

  // ─── get_entitlements ─────────────────────────────────────────────

  server.tool(
    'get_entitlements',
    'Get a user\'s subscription entitlements across all billing platforms.',
    {
      userId: z.string().uuid().describe('The user ID'),
    },
    async (params, extra) => {
      const orgId = (extra as any).orgId;
      if (!orgId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Not authenticated' }) }] };

      const ents = await db
        .select()
        .from(entitlements)
        .where(and(eq(entitlements.orgId, orgId), eq(entitlements.userId, params.userId)));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ entitlements: ents }, null, 2),
        }],
      };
    },
  );

  // ─── search_events ────────────────────────────────────────────────

  server.tool(
    'search_events',
    'Search billing events. Filter by source (stripe/apple/google), event type, user, and date range.',
    {
      source: z.enum(['stripe', 'apple', 'google', 'recurly', 'braintree']).optional().describe('Billing source filter'),
      type: z.string().optional().describe('Event type filter (e.g. purchase, renewal, refund)'),
      userId: z.string().uuid().optional().describe('Filter events for a specific user'),
      startDate: z.string().optional().describe('Start date (ISO 8601)'),
      endDate: z.string().optional().describe('End date (ISO 8601)'),
      limit: z.number().min(1).max(200).default(50).describe('Max results'),
    },
    async (params, extra) => {
      const orgId = (extra as any).orgId;
      if (!orgId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Not authenticated' }) }] };

      const events = await db
        .select({
          id: canonicalEvents.id,
          source: canonicalEvents.source,
          eventType: canonicalEvents.eventType,
          sourceEventType: canonicalEvents.sourceEventType,
          eventTime: canonicalEvents.eventTime,
          status: canonicalEvents.status,
          amountCents: canonicalEvents.amountCents,
          currency: canonicalEvents.currency,
          userId: canonicalEvents.userId,
          environment: canonicalEvents.environment,
          ingestedAt: canonicalEvents.ingestedAt,
        })
        .from(canonicalEvents)
        .where(
          and(
            eq(canonicalEvents.orgId, orgId),
            params.source ? eq(canonicalEvents.source, params.source as any) : undefined,
            params.type ? eq(canonicalEvents.eventType, params.type as any) : undefined,
            params.userId ? eq(canonicalEvents.userId, params.userId) : undefined,
            params.startDate ? gte(canonicalEvents.eventTime, new Date(params.startDate)) : undefined,
            params.endDate ? sql`${canonicalEvents.eventTime} <= ${new Date(params.endDate)}` : undefined,
          ),
        )
        .orderBy(desc(canonicalEvents.eventTime))
        .limit(params.limit);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ events }, null, 2),
        }],
      };
    },
  );

  // ─── get_integration_health ───────────────────────────────────────

  server.tool(
    'get_integration_health',
    'Check billing integration health: connection status, last webhook times, and data freshness.',
    {},
    async (_params, extra) => {
      const orgId = (extra as any).orgId;
      if (!orgId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Not authenticated' }) }] };

      const connections = await db
        .select()
        .from(billingConnections)
        .where(eq(billingConnections.orgId, orgId));

      const healthData = connections.map((conn) => {
        const lastWebhookAge = conn.lastWebhookAt
          ? Math.round((Date.now() - new Date(conn.lastWebhookAt).getTime()) / 1000 / 60)
          : null;

        return {
          source: conn.source,
          isActive: conn.isActive,
          syncStatus: conn.syncStatus,
          lastSyncAt: conn.lastSyncAt,
          lastWebhookAt: conn.lastWebhookAt,
          lastWebhookAgeMinutes: lastWebhookAge,
          status: !conn.isActive ? 'disconnected'
            : lastWebhookAge === null ? 'no_webhooks_received'
            : lastWebhookAge > 1440 ? 'stale'
            : 'healthy',
        };
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            connections: healthData,
            connectedSources: connections.filter(c => c.isActive).length,
            totalSources: connections.length,
          }, null, 2),
        }],
      };
    },
  );

  // ─── update_issue_status ──────────────────────────────────────────

  server.tool(
    'update_issue_status',
    'Change an issue\'s status: resolve, dismiss, or acknowledge. Fires webhook events to all configured endpoints.',
    {
      issueId: z.string().uuid().describe('The issue ID'),
      action: z.enum(['resolve', 'dismiss', 'acknowledge']).describe('The action to take'),
      resolution: z.string().optional().describe('Resolution note (for resolve/dismiss)'),
    },
    async (params, extra) => {
      const orgId = (extra as any).orgId;
      if (!orgId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Not authenticated' }) }] };

      const [existing] = await db
        .select()
        .from(issues)
        .where(and(eq(issues.orgId, orgId), eq(issues.id, params.issueId)))
        .limit(1);

      if (!existing) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Issue not found' }) }] };
      }

      let eventType: WebhookEventType;

      switch (params.action) {
        case 'resolve':
          await db.update(issues).set({
            status: 'resolved',
            resolvedAt: new Date(),
            resolution: params.resolution || null,
            updatedAt: new Date(),
          }).where(and(eq(issues.orgId, orgId), eq(issues.id, params.issueId)));
          eventType = 'issue.resolved';
          break;
        case 'dismiss':
          await db.update(issues).set({
            status: 'dismissed',
            resolution: params.resolution || 'Dismissed',
            updatedAt: new Date(),
          }).where(and(eq(issues.orgId, orgId), eq(issues.id, params.issueId)));
          eventType = 'issue.dismissed';
          break;
        case 'acknowledge':
          await db.update(issues).set({
            status: 'acknowledged',
            updatedAt: new Date(),
          }).where(and(eq(issues.orgId, orgId), eq(issues.id, params.issueId)));
          eventType = 'issue.acknowledged';
          break;
      }

      dispatchWebhookEvent(db, orgId, params.issueId, eventType).catch(() => {});

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: true,
            issueId: params.issueId,
            action: params.action,
            previousStatus: existing.status,
          }, null, 2),
        }],
      };
    },
  );
}
