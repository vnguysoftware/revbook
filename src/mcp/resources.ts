import { eq, and, desc } from 'drizzle-orm';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
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
import { enrichIssue } from '../detection/detector-meta.js';

/**
 * Register MCP resources that AI agents can read.
 */
export function registerResources(server: McpServer, db: Database): void {

  // ─── revback://issues ─────────────────────────────────────────────

  server.resource(
    'issues',
    'revback://issues',
    { description: 'List of open billing issues with severity, type, and revenue impact' },
    async (uri, extra) => {
      const orgId = (extra as any).orgId;
      if (!orgId) {
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: 'Not authenticated' }) }] };
      }

      const openIssues = await db
        .select()
        .from(issues)
        .where(and(eq(issues.orgId, orgId), eq(issues.status, 'open')))
        .orderBy(desc(issues.createdAt))
        .limit(50);

      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ issues: openIssues.map(enrichIssue) }, null, 2),
        }],
      };
    },
  );

  // ─── revback://issues/{issueId} ───────────────────────────────────

  const issueTemplate = new ResourceTemplate('revback://issues/{issueId}', { list: undefined });

  server.resource(
    'issue_detail',
    issueTemplate,
    { description: 'Detailed view of a single billing issue with evidence and recommended action' },
    async (uri, variables, extra) => {
      const orgId = (extra as any).orgId;
      if (!orgId) {
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: 'Not authenticated' }) }] };
      }

      const issueId = variables.issueId as string;
      const [issue] = await db
        .select()
        .from(issues)
        .where(and(eq(issues.orgId, orgId), eq(issues.id, issueId)))
        .limit(1);

      if (!issue) {
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: 'Issue not found' }) }] };
      }

      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ issue: enrichIssue(issue) }, null, 2),
        }],
      };
    },
  );

  // ─── revback://users/{userId} ─────────────────────────────────────

  const userTemplate = new ResourceTemplate('revback://users/{userId}', { list: undefined });

  server.resource(
    'user_profile',
    userTemplate,
    { description: 'User profile with identities, entitlements, and open issues' },
    async (uri, variables, extra) => {
      const orgId = (extra as any).orgId;
      if (!orgId) {
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: 'Not authenticated' }) }] };
      }

      const userId = variables.userId as string;
      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.orgId, orgId), eq(users.id, userId)))
        .limit(1);

      if (!user) {
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: 'User not found' }) }] };
      }

      const [identitiesResult, entsResult, userIssues, recentEvents] = await Promise.all([
        db.select().from(userIdentities).where(eq(userIdentities.userId, userId)),
        db.select().from(entitlements).where(and(eq(entitlements.orgId, orgId), eq(entitlements.userId, userId))),
        db.select().from(issues).where(and(eq(issues.orgId, orgId), eq(issues.userId, userId), eq(issues.status, 'open'))).orderBy(desc(issues.createdAt)).limit(10),
        db.select().from(canonicalEvents).where(and(eq(canonicalEvents.orgId, orgId), eq(canonicalEvents.userId, userId))).orderBy(desc(canonicalEvents.eventTime)).limit(20),
      ]);

      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
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

  // ─── revback://health ─────────────────────────────────────────────

  server.resource(
    'health',
    'revback://health',
    { description: 'Integration health overview: connection status and webhook freshness' },
    async (uri, extra) => {
      const orgId = (extra as any).orgId;
      if (!orgId) {
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: 'Not authenticated' }) }] };
      }

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
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({
            connections: healthData,
            connectedSources: connections.filter(c => c.isActive).length,
            totalSources: connections.length,
          }, null, 2),
        }],
      };
    },
  );
}
