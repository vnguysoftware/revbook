import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Database } from '../config/database.js';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';

/**
 * Create and configure an MCP server instance.
 *
 * The server exposes RevBack's issue detection, user lookup,
 * and integration health data to AI agents via the Model Context Protocol.
 */
export function createMcpServer(db: Database): McpServer {
  const server = new McpServer(
    {
      name: 'revback',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  registerTools(server, db);
  registerResources(server, db);
  registerPrompts(server, db);

  return server;
}
