import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Database } from '../config/database.js';
import type { AuthContext } from '../middleware/auth.js';
import { createMcpServer } from './server.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('mcp-transport');

/**
 * Create Hono routes that bridge HTTP to the MCP protocol.
 *
 * Uses the Streamable HTTP transport from the MCP SDK, which
 * handles JSON-RPC over HTTP with SSE streaming.
 *
 * Auth: Uses the same API key auth as the REST API.
 * The orgId is injected into the MCP session context.
 */
export function createMcpRoutes(db: Database) {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();

  // Map of sessionId -> { transport, server }
  const sessions = new Map<string, {
    transport: WebStandardStreamableHTTPServerTransport;
  }>();

  /**
   * Handle all MCP requests (POST, GET, DELETE).
   *
   * POST /mcp — JSON-RPC requests (tool calls, resource reads, etc.)
   * GET /mcp — SSE stream for server-initiated messages
   * DELETE /mcp — Close session
   */
  app.all('/', async (c) => {
    const { orgId } = c.get('auth');
    const sessionId = c.req.header('mcp-session-id');

    // For existing sessions, route to the existing transport
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      const response = await session.transport.handleRequest(c.req.raw, {
        authInfo: { orgId } as any,
      });
      return response;
    }

    // For new sessions (initialization), create a new transport + server
    if (c.req.method === 'POST') {
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          sessions.set(sid, { transport });
          log.info({ sessionId: sid, orgId }, 'MCP session initialized');
        },
        onsessionclosed: (sid) => {
          sessions.delete(sid);
          log.info({ sessionId: sid }, 'MCP session closed');
        },
        enableJsonResponse: true,
      });

      // Create MCP server and inject orgId into the extra context
      const mcpServer = createMcpServer(db);

      // Wrap the transport's onmessage to inject orgId into the session
      const originalOnMessage = transport.onmessage;
      transport.onmessage = (message, extra) => {
        // Inject orgId into the extra context for tool/resource handlers
        const enrichedExtra = { ...extra, orgId };
        if (originalOnMessage) {
          originalOnMessage(message, enrichedExtra);
        }
      };

      await mcpServer.connect(transport);

      // Now the transport's onmessage has been replaced by the server.
      // We need to wrap the server's handler to inject orgId.
      const serverOnMessage = transport.onmessage;
      transport.onmessage = (message, extra) => {
        const enrichedExtra = { ...extra, orgId };
        if (serverOnMessage) {
          serverOnMessage(message, enrichedExtra);
        }
      };

      const response = await transport.handleRequest(c.req.raw, {
        authInfo: { orgId } as any,
      });
      return response;
    }

    // If no session found for GET/DELETE, return 400
    return c.json({ error: 'No active MCP session. Send an initialize request first.' }, 400);
  });

  return app;
}
