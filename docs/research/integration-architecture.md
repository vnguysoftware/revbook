# RevBack Agentic AI Integration Architecture

**Date:** February 2026
**Author:** Integration Architect
**Status:** Proposed
**Inputs:** [Agentic Protocol Research](./agentic-protocols.md), [Signal Analysis](./signal-analysis.md)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Phased Roadmap](#phased-roadmap)
3. [Phase 1: Outbound Webhooks](#phase-1-outbound-webhooks)
4. [Phase 2: MCP Server](#phase-2-mcp-server)
5. [Phase 3: Action API](#phase-3-action-api)
6. [Security Model](#security-model)
7. [What NOT to Build](#what-not-to-build)
8. [Competitive Positioning](#competitive-positioning)
9. [End-to-End Example Flow](#end-to-end-example-flow)

---

## Executive Summary

RevBack should build three integration layers, in order:

1. **Outbound Webhooks** (Phase 1) -- Push structured issue signals to customer endpoints. Universal compatibility, works with or without AI. This is table stakes.

2. **MCP Server** (Phase 2) -- Expose RevBack as a tool server that any AI agent can query and act on. This is the strategic differentiator. MCP is the de facto standard (97M+ monthly SDK downloads, adopted by OpenAI, Google, Anthropic, Microsoft).

3. **Action API** (Phase 3) -- A remediation endpoint where agents can request specific actions (revoke access, trigger backfill, etc.) with safety tier enforcement. This closes the loop from detection to resolution.

**Key architectural principle:** Each phase builds on the previous. Webhooks push signals. MCP lets agents pull context and investigate. The Action API lets agents remediate. Together they form a complete detect-investigate-remediate pipeline that agents can operate autonomously (with appropriate guardrails).

**What we do NOT build:** Framework-specific integrations (LangChain tools, CrewAI tools), GraphQL subscriptions, A2A protocol support (premature), or a custom chat interface. MCP covers the framework integrations. The rest is either low-value or too early.

---

## Phased Roadmap

```
Phase 1: Outbound Webhooks                     Phase 2: MCP Server                          Phase 3: Action API
------------------------------                  ----------------------------                 ----------------------------
Scope: Event push to customer endpoints         Scope: AI-native query + investigation       Scope: Agent-initiated remediation
Effort: ~2 weeks                                Effort: ~3-4 weeks                           Effort: ~3 weeks
Dependency: None                                Dependency: Phase 1 (webhook infra)          Dependency: Phase 2 (MCP tools)

Deliverables:                                   Deliverables:                                Deliverables:
- 6 webhook event types                         - 8 MCP tools                                - Remediation request endpoint
- HMAC signature verification                   - 5 MCP resources                            - Safety tier enforcement
- Retry with exponential backoff                - 3 prompt templates                         - Approval workflow for Tier C
- Delivery log + dashboard UI                   - OAuth 2.0 / API key auth                   - Audit log for all actions
- Webhook management API                        - Streamable HTTP transport                   - Rate limiting per org
                                                - TypeScript, uses existing Hono stack        - Rollback support
```

### Sequencing Rationale

1. **Webhooks first** because they serve ALL customers (AI or not), are well-understood, and provide the event backbone. The infrastructure (delivery queue, retry logic, signing) also supports MCP server notifications later.

2. **MCP second** because it is the highest-leverage integration. One MCP server serves Claude, ChatGPT, Copilot, Cursor, LangChain agents, CrewAI agents, and any other MCP-compatible system. It transforms RevBack from "a dashboard you check" to "a tool your AI uses."

3. **Action API third** because automated remediation requires trust, and trust requires the investigation layer (MCP) to be proven first. Customers need to see that RevBack's signals are accurate before they let agents act on them.

---

## Phase 1: Outbound Webhooks

### Event Types

Six webhook event types, mapped directly to the issue lifecycle:

| Event Type | Trigger | Payload Priority |
|-----------|---------|-----------------|
| `issue.created` | New issue detected by any detector | High |
| `issue.severity_changed` | Issue severity escalated or de-escalated | Medium |
| `issue.resolved` | Issue resolved (manually or automatically) | Medium |
| `issue.dismissed` | Issue dismissed by operator | Low |
| `issue.reopened` | Previously resolved issue detected again | High |
| `monitor.health_changed` | Billing connection health status change | High |

### Payload Structure

Every webhook payload follows the same envelope:

```typescript
interface WebhookPayload {
  // Envelope
  id: string;                    // Unique delivery ID (for idempotency)
  event: string;                 // "issue.created", "issue.resolved", etc.
  apiVersion: "2026-02-01";      // Versioned for backwards compatibility
  timestamp: string;             // ISO 8601
  orgId: string;                 // Tenant ID

  // Payload (event-specific)
  data: {
    issue: {
      id: string;
      issueType: string;         // "unrevoked_refund", "duplicate_billing", etc.
      category: string;          // "integration_health", "cross_platform", etc.
      severity: "critical" | "warning" | "info";
      confidence: number;        // 0.0 - 1.0
      detectionTier: "billing_only" | "app_verified";
      title: string;
      description: string;

      affectedUser?: {
        userId: string;
        email?: string;
        externalIds: Record<string, string>;
      };

      revenueImpact?: {
        estimatedCents: number;
        currency: string;
        direction: "leakage" | "overbilling";
        period: "one_time" | "recurring";
      };

      evidence: Record<string, unknown>;  // Detector-specific structured evidence
      recommendedAction: string;          // Human-readable next step

      dashboardUrl: string;               // Deep link to RevBack dashboard
    };

    // Only for severity_changed
    previousSeverity?: string;

    // Only for resolved/dismissed
    resolution?: string;
    resolvedBy?: string;
  };
}
```

### Delivery Guarantees

- **At-least-once delivery** with idempotency keys (customers deduplicate on `id`)
- **HMAC-SHA256 signature** in `X-RevBack-Signature` header using per-org webhook secret
- **Retry policy:** Exponential backoff (1s, 5s, 30s, 2min, 15min, 1h, 6h) -- 7 attempts over ~7.5 hours
- **Timeout:** 10-second response timeout per delivery attempt
- **Success criteria:** HTTP 2xx response
- **Dead letter:** After 7 failed attempts, event goes to DLQ with alert to org admin

### Implementation Notes

This builds on the existing `alertConfigurations` and `alertDeliveryLogs` tables in the schema. We add a new `webhook` channel type alongside the existing `slack` and `email` channels. The delivery queue uses the existing BullMQ infrastructure (`src/config/queue.ts`).

### Webhook Management API

```
POST   /api/v1/webhooks              -- Register a webhook endpoint
GET    /api/v1/webhooks              -- List registered endpoints
PUT    /api/v1/webhooks/:id          -- Update endpoint URL or filters
DELETE /api/v1/webhooks/:id          -- Remove endpoint
POST   /api/v1/webhooks/:id/test     -- Send a test payload
GET    /api/v1/webhooks/:id/logs     -- Delivery log for this endpoint
POST   /api/v1/webhooks/:id/rotate   -- Rotate signing secret
```

---

## Phase 2: MCP Server

### Architecture

The MCP server runs as a Streamable HTTP endpoint within the existing Hono server. It uses the official `@modelcontextprotocol/sdk` TypeScript SDK, which is a natural fit for the existing stack.

```
                                    RevBack Server (Hono)
                                    ================================
[Claude / ChatGPT / LangChain]     |                              |
         |                          |  /api/v1/*    (REST API)     |
         |  MCP (Streamable HTTP)   |  /webhooks/*  (Ingestion)    |
         +------------------------->|  /mcp         (MCP Server)   |
                                    |       |                      |
                                    |       v                      |
                                    |  [MCP Handler]               |
                                    |    - Tools (8)               |
                                    |    - Resources (5)           |
                                    |    - Prompts (3)             |
                                    |       |                      |
                                    |       v                      |
                                    |  [Existing Services]         |
                                    |    - Detection Engine        |
                                    |    - Entitlement Engine      |
                                    |    - Identity Resolver       |
                                    |    - Database (Drizzle)      |
                                    ================================
```

The MCP server is a thin adapter layer over the existing API -- it does NOT duplicate business logic. Every MCP tool calls the same service functions that the REST API uses.

### Auth

Two auth paths, both resolving to the same `orgId`:

1. **API Key** -- Same keys used for the REST API. Passed in the MCP auth header. Simple, works today.
2. **OAuth 2.0** -- For enterprise SSO. MCP spec supports delegating to an existing Authorization Server. Future phase.

Every MCP tool receives the authenticated `orgId` from the middleware. No tool accepts `orgId` as a parameter -- it is always derived from the auth context. This prevents cross-tenant data leakage.

### MCP Tools (8)

Tools are the actions an agent can invoke. Each tool maps to existing RevBack functionality.

#### Tool 1: `list_issues`

```typescript
server.tool(
  "list_issues",
  "List open billing issues detected by RevBack, filtered by severity, category, or type",
  {
    status: z.enum(["open", "acknowledged", "resolved", "dismissed"]).default("open"),
    severity: z.enum(["critical", "warning", "info"]).optional(),
    category: z.enum([
      "integration_health",
      "cross_platform",
      "revenue_protection",
      "access_verification",
    ]).optional(),
    issueType: z.string().optional(),
    limit: z.number().min(1).max(50).default(20),
    offset: z.number().min(0).default(0),
  },
  async (params, { orgId }) => {
    // Delegates to the same logic as GET /api/v1/issues
    const result = await issueService.listIssues(orgId, params);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          issues: result.issues,
          pagination: result.pagination,
          summary: `${result.pagination.count} ${params.status} issues found` +
            (params.severity ? ` (severity: ${params.severity})` : ""),
        }),
      }],
    };
  }
);
```

#### Tool 2: `get_issue_detail`

```typescript
server.tool(
  "get_issue_detail",
  "Get full details of a specific issue including evidence, affected user, and recommended actions",
  {
    issueId: z.string().uuid(),
  },
  async ({ issueId }, { orgId }) => {
    const issue = await issueService.getIssue(orgId, issueId);
    if (!issue) {
      return { content: [{ type: "text", text: "Issue not found" }], isError: true };
    }

    // Enrich with recommended actions from signal analysis
    const actions = getRecommendedActions(issue.issueType, issue);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          issue,
          recommendedActions: actions,
          deepLinks: {
            dashboard: `${DASHBOARD_URL}/issues/${issueId}`,
            ...getProviderLinks(issue),  // Stripe dashboard, Apple Connect, etc.
          },
        }),
      }],
    };
  }
);
```

#### Tool 3: `get_revenue_impact`

```typescript
server.tool(
  "get_revenue_impact",
  "Get revenue impact summary -- total revenue at risk, broken down by severity and issue type",
  {},
  async (_params, { orgId }) => {
    // Delegates to GET /api/v1/dashboard/revenue-impact
    const impact = await dashboardService.getRevenueImpact(orgId);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(impact),
      }],
    };
  }
);
```

#### Tool 4: `lookup_user`

```typescript
server.tool(
  "lookup_user",
  "Look up a user by email, external ID, or RevBack user ID. Returns subscription state across all platforms.",
  {
    email: z.string().email().optional(),
    externalId: z.string().optional(),
    userId: z.string().uuid().optional(),
  },
  async (params, { orgId }) => {
    const user = await userService.lookupUser(orgId, params);
    if (!user) {
      return { content: [{ type: "text", text: "User not found" }], isError: true };
    }

    // Include entitlements, identities, recent events, and open issues
    const [entitlements, identities, recentEvents, openIssues] = await Promise.all([
      entitlementService.getUserEntitlements(orgId, user.id),
      identityService.getUserIdentities(orgId, user.id),
      eventService.getRecentEvents(orgId, user.id, 20),
      issueService.getUserIssues(orgId, user.id, "open"),
    ]);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          user,
          entitlements,
          identities,
          recentEvents,
          openIssues,
        }),
      }],
    };
  }
);
```

#### Tool 5: `get_entitlement_health`

```typescript
server.tool(
  "get_entitlement_health",
  "Get overall entitlement health: state distribution, source breakdown, and user counts",
  {},
  async (_params, { orgId }) => {
    const health = await dashboardService.getEntitlementHealth(orgId);
    return {
      content: [{ type: "text", text: JSON.stringify(health) }],
    };
  }
);
```

#### Tool 6: `get_billing_connection_status`

```typescript
server.tool(
  "get_billing_connection_status",
  "Check the health of connected billing sources (Stripe, Apple, Google) -- webhook delivery status, last event times, data freshness",
  {},
  async (_params, { orgId }) => {
    const connections = await onboardingService.getIntegrationStatus(orgId);
    return {
      content: [{ type: "text", text: JSON.stringify(connections) }],
    };
  }
);
```

#### Tool 7: `search_events`

```typescript
server.tool(
  "search_events",
  "Search billing events by type, source, date range, or user. Useful for investigating issues.",
  {
    source: z.enum(["stripe", "apple", "google"]).optional(),
    eventType: z.string().optional(),
    userId: z.string().uuid().optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    limit: z.number().min(1).max(100).default(50),
  },
  async (params, { orgId }) => {
    const events = await eventService.searchEvents(orgId, params);
    return {
      content: [{ type: "text", text: JSON.stringify(events) }],
    };
  }
);
```

#### Tool 8: `update_issue_status`

```typescript
server.tool(
  "update_issue_status",
  "Acknowledge, resolve, or dismiss an issue. Requires issue ID and new status.",
  {
    issueId: z.string().uuid(),
    action: z.enum(["acknowledge", "resolve", "dismiss"]),
    resolution: z.string().optional(),
  },
  async ({ issueId, action, resolution }, { orgId }) => {
    await issueService.updateStatus(orgId, issueId, action, resolution);
    return {
      content: [{
        type: "text",
        text: `Issue ${issueId} ${action}d successfully`,
      }],
    };
  }
);
```

### MCP Resources (5)

Resources provide read-only data an agent can browse for context.

| Resource URI Pattern | Description |
|---------------------|-------------|
| `revback://issues` | List of open issues (browsable) |
| `revback://issues/{issueId}` | Single issue with full evidence |
| `revback://users/{userId}` | User profile with entitlements and identities |
| `revback://users/{userId}/entitlements` | User's entitlement states across platforms |
| `revback://health` | Overall system health (connections, freshness, issue counts) |

```typescript
// Example resource registration
server.resource(
  "issue-detail",
  new ResourceTemplate("revback://issues/{issueId}", { list: undefined }),
  async (uri, { orgId }) => {
    const issueId = uri.pathname.split("/").pop();
    const issue = await issueService.getIssue(orgId, issueId);
    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(issue),
      }],
    };
  }
);
```

### MCP Prompt Templates (3)

Prompts guide the agent through common RevBack workflows.

#### Prompt 1: `investigate_issue`

```typescript
server.prompt(
  "investigate_issue",
  "Step-by-step investigation workflow for a RevBack billing issue",
  { issueId: z.string().uuid() },
  async ({ issueId }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Investigate RevBack issue ${issueId}. Follow these steps:

1. Use get_issue_detail to retrieve the full issue with evidence
2. If the issue has an affected user, use lookup_user to get their full profile
3. Use search_events to find related billing events around the time of the issue
4. Check get_billing_connection_status if the issue is integration_health category
5. Look for compound signals -- check list_issues for other issues affecting the same user or same billing source
6. Summarize your findings with:
   - Root cause assessment (what went wrong)
   - Confidence level in your assessment
   - Recommended remediation steps, ordered by safety tier
   - Revenue impact if no action is taken`,
      },
    }],
  })
);
```

#### Prompt 2: `daily_revenue_review`

```typescript
server.prompt(
  "daily_revenue_review",
  "Generate a daily revenue protection summary for the team",
  {},
  async () => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Generate a daily revenue protection summary:

1. Use get_revenue_impact to get the current revenue at risk
2. Use list_issues with severity=critical to find urgent issues
3. Use get_entitlement_health to check overall subscription health
4. Use get_billing_connection_status to verify all integrations are healthy
5. Produce a brief report with:
   - Total revenue at risk (in dollars)
   - Number of critical issues requiring immediate attention
   - Integration health status (any webhook gaps?)
   - Top 3 issues by revenue impact with recommended actions`,
      },
    }],
  })
);
```

#### Prompt 3: `user_billing_audit`

```typescript
server.prompt(
  "user_billing_audit",
  "Audit a specific user's billing state across all platforms",
  {
    identifier: z.string().describe("Email address, external ID, or RevBack user ID"),
  },
  async ({ identifier }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Audit the billing state for user: ${identifier}

1. Use lookup_user to find the user and get their full profile
2. Review their entitlements across all platforms -- are they consistent?
3. Use search_events to get their recent billing history (last 90 days)
4. Check for any open issues affecting this user
5. Verify their access state matches their payment state
6. Report:
   - Current subscription status per platform
   - Any discrepancies or concerns
   - Whether they are being billed correctly
   - Any recommended actions`,
      },
    }],
  })
);
```

### MCP Server Implementation Sketch

```typescript
// src/mcp/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Hono } from "hono";
import { z } from "zod";
import type { Database } from "../config/database.js";

export function createMcpRoutes(db: Database) {
  const app = new Hono();

  // Create MCP server instance
  const mcpServer = new McpServer({
    name: "revback",
    version: "1.0.0",
    description: "Revenue protection for subscription businesses. " +
      "Detects billing issues across Stripe, Apple, and Google platforms.",
  });

  // Register all tools, resources, and prompts
  // (each registration function receives db and attaches orgId from auth context)
  registerTools(mcpServer, db);
  registerResources(mcpServer, db);
  registerPrompts(mcpServer);

  // Mount on Hono -- Streamable HTTP transport
  app.post("/", async (c) => {
    // Auth: extract orgId from API key or OAuth token
    const orgId = await authenticateMcpRequest(c);
    if (!orgId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Create transport for this request
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless -- no sessions needed
    });

    // Inject orgId into the server context for all tool/resource handlers
    await mcpServer.connect(transport, { orgId });

    // Handle the MCP request
    const body = await c.req.json();
    const response = await transport.handleRequest(body);
    return c.json(response);
  });

  // SSE endpoint for streaming (optional, for long-running operations)
  app.get("/sse", async (c) => {
    // ... SSE transport setup
  });

  return app;
}
```

Integration into the main server:

```typescript
// In src/index.ts, add:
import { createMcpRoutes } from './mcp/server.js';

// Mount MCP server (uses its own auth, not the REST API middleware)
app.route('/mcp', createMcpRoutes(db));
```

---

## Phase 3: Action API

### Concept

The Action API lets agents (or automated systems) request specific remediation actions. Unlike MCP tools that query data, the Action API mutates state -- it changes entitlements, triggers backfills, and interacts with external billing providers.

The key design decision: **the Action API enforces the safety tier model from the signal analysis.** Every action has a safety tier, and the API enforces it.

### Safety Tier Enforcement

```
Tier A: Fully Automated          -- API executes immediately, returns result
Tier B: Guardrailed              -- API executes if within constraints (confidence, revenue cap, rate limit)
Tier C: Human-Approved           -- API creates a pending approval, returns approval ID
Tier D: Human-Only               -- API rejects with "not automatable" error
```

### Action Endpoint

```
POST /api/v1/actions
```

```typescript
interface ActionRequest {
  issueId: string;                    // The issue this action addresses
  actionType: string;                 // Action identifier
  parameters?: Record<string, unknown>;  // Action-specific parameters
  reason: string;                     // Why the agent is requesting this action
  dryRun?: boolean;                   // Preview the action without executing
}

interface ActionResponse {
  actionId: string;                   // Unique action ID for tracking
  status: "executed" | "pending_approval" | "rejected" | "dry_run";
  safetyTier: "A" | "B" | "C" | "D";

  // If executed
  result?: {
    success: boolean;
    details: string;
    rollbackAvailable: boolean;
    rollbackExpiresAt?: string;       // ISO timestamp
  };

  // If pending_approval
  approval?: {
    approvalId: string;
    approvalUrl: string;              // Deep link to approval UI
    expiresAt: string;
    requiredApprover: string;         // "org_admin" | "billing_admin"
  };

  // If rejected
  rejection?: {
    reason: string;
    constraint: string;               // Which constraint was violated
  };
}
```

### Action Catalog

Each action maps to a safety tier and has specific constraints:

| Action | Safety Tier | Description | Constraints |
|--------|------------|-------------|-------------|
| `verify_provider_status` | A | Check billing provider status page | None -- read-only |
| `verify_subscription` | A | Query provider API for real-time subscription status | None -- read-only |
| `correlate_signals` | A | Run compound signal analysis across related issues | None -- read-only |
| `update_entitlement_state` | B | Sync RevBack's entitlement to match provider reality | Confidence > 0.85, max $500 revenue impact |
| `revoke_after_refund` | B | Revoke entitlement after confirmed refund | Refund verified, >1h since refund, max 10/hour/org |
| `revoke_after_chargeback` | B | Revoke entitlement after confirmed chargeback | Chargeback verified |
| `grant_access_verified_paid` | B | Grant access to verified paying user | Payment verified with provider, max 10/hour/org |
| `alert_engineering` | B | Send alert to configured Slack/email channels | Max 5/hour/org (prevent alert storms) |
| `cancel_subscription` | C | Cancel a subscription via provider API | Requires human approval |
| `issue_refund` | C | Issue refund via provider API | Requires human approval |
| `trigger_backfill` | C | Trigger a full provider backfill | Requires human approval |
| `contact_user` | C | Send communication to end user | Requires human approval |

### Guardrail Implementation

```typescript
interface ActionGuardrails {
  // Per-action constraints
  minConfidence?: number;           // Issue confidence must exceed this
  maxRevenueCents?: number;         // Revenue impact must be below this
  maxPerHourPerOrg?: number;        // Rate limit
  requiresVerification?: string[];  // Pre-checks that must pass
  rollbackWindowMinutes?: number;   // How long the action can be undone
}

// Example: revoke_after_refund guardrails
const REVOKE_AFTER_REFUND: ActionGuardrails = {
  minConfidence: 0.90,
  maxRevenueCents: 50000,           // $500 max per action
  maxPerHourPerOrg: 10,
  requiresVerification: ["refund_confirmed_with_provider"],
  rollbackWindowMinutes: 15,
};
```

### Audit Log

Every action (executed, approved, rejected, rolled back) is logged:

```typescript
// New table: action_audit_log
{
  id: uuid,
  orgId: uuid,
  issueId: uuid,
  actionType: string,
  safetyTier: string,
  requestedBy: string,              // "api_key:sk_xxx" or "mcp:session_xxx"
  status: string,                   // "executed" | "approved" | "rejected" | "rolled_back"
  parameters: jsonb,
  result: jsonb,
  reason: string,                   // Why the action was requested
  approvedBy?: string,              // Who approved (for Tier C)
  rolledBackAt?: timestamp,
  createdAt: timestamp,
}
```

### Approval Workflow (Tier C)

For actions requiring human approval:

1. Agent calls `POST /api/v1/actions` with a Tier C action
2. API creates a pending approval record and returns an `approvalId` + `approvalUrl`
3. Approval notification sent via configured channels (Slack, email, webhook)
4. Human reviews in dashboard or responds to Slack notification
5. On approval: action executes, agent receives webhook notification (`action.approved`)
6. On rejection: agent receives webhook notification (`action.rejected`)
7. Approvals expire after 24 hours

### New Webhook Events for Actions

| Event | Trigger |
|-------|---------|
| `action.executed` | A Tier A/B action was executed |
| `action.pending_approval` | A Tier C action is waiting for approval |
| `action.approved` | A Tier C action was approved and executed |
| `action.rejected` | A Tier C action was rejected |
| `action.rolled_back` | A previously executed action was undone |

---

## Security Model

### Multi-Tenant Isolation

The most important security property: **no request ever crosses tenant boundaries.**

- Every database query includes `WHERE org_id = ?`
- Every MCP tool resolves `orgId` from the auth context, never from parameters
- Every webhook delivery is scoped to a single org
- Every action is scoped to a single org
- API keys are hashed (existing `apiKeys` table) and scoped to one org

### API Key Scopes

Extend the existing `scopes` field on `apiKeys` to support fine-grained permissions:

```typescript
type ApiKeyScope =
  // Read scopes
  | "issues:read"           // List and view issues
  | "users:read"            // Look up users and entitlements
  | "events:read"           // Search billing events
  | "dashboard:read"        // Access dashboard/analytics data
  | "health:read"           // View integration health

  // Write scopes
  | "issues:write"          // Acknowledge, resolve, dismiss issues
  | "webhooks:manage"       // Register and manage webhook endpoints

  // Action scopes (Phase 3)
  | "actions:tier_a"        // Execute Tier A actions (read-only verifications)
  | "actions:tier_b"        // Execute Tier B actions (guardrailed mutations)
  | "actions:tier_c"        // Request Tier C actions (human-approved)

  // Meta
  | "mcp:connect";          // Connect via MCP protocol
```

Default scope for a new API key: `["issues:read", "users:read", "events:read", "dashboard:read", "health:read"]`. Read-only by default. Customers must explicitly grant write and action scopes.

### MCP-Specific Security

1. **No cross-tenant tool results.** Tool results never include data from other tenants. The MCP SDK's tool handlers receive `orgId` from the auth middleware, not from the AI's parameters.

2. **Prompt injection defense.** Tool results are plain JSON, not instructions. We do not embed instructions in tool results that could manipulate the agent. All tool descriptions are static and server-defined.

3. **Rate limiting.** MCP requests share the same rate limits as REST API requests. The MCP endpoint counts against the same per-org rate limiter.

4. **Input validation.** All tool parameters are validated with Zod schemas. Invalid inputs return structured errors, not exceptions.

### Audit Logging

All API access is logged:

- REST API: Request path, method, orgId, API key prefix, response status, timestamp
- MCP: Tool name, parameters, orgId, response size, timestamp
- Webhooks: Delivery attempts, response codes, retry count
- Actions: Full audit trail (see Action API section above)

Audit logs are stored for 90 days, queryable via admin API.

---

## What NOT to Build

### 1. Framework-Specific Integrations (LangChain tools, CrewAI tools, etc.)

**Why not:** MCP covers this. LangChain, CrewAI, and AutoGen all support MCP clients. Building framework-specific tool wrappers is duplicative effort that creates a maintenance burden. When we build one MCP server, agents on every framework can use it.

### 2. A2A (Agent-to-Agent Protocol)

**Why not:** Premature. A2A is for agent-to-agent collaboration -- "RevBack's agent talks to the customer's FinOps agent." But our use case is simpler: customers want to query and act on RevBack data, not have their agents collaborate with ours in a multi-turn negotiation. MCP handles the query-and-act pattern. We should revisit A2A when customers demonstrate demand for autonomous agent-to-agent workflows.

### 3. GraphQL Subscriptions

**Why not:** Niche, not AI-native, adds complexity without clear value. Webhooks cover the push use case. MCP tools cover the pull use case. GraphQL subscriptions would serve a tiny audience of power users who want real-time filtered data streams, and they could achieve the same thing with webhooks + filters.

### 4. Custom Chat Interface

**Why not:** This is the AI host's job. Claude, ChatGPT, Copilot, and other AI platforms provide the conversation UI. RevBack provides the tools and data. Building our own conversational interface would be reinventing the wheel and competing with our integration partners.

### 5. Autonomous RevBack Agent

**Why not:** RevBack should be a tool provider, not an autonomous agent. The customer's AI system orchestrates -- RevBack provides the intelligence and the actions. Building our own autonomous agent that proactively takes actions on customer billing systems would be a trust and liability problem. The Action API with safety tiers is the right abstraction: we provide the capability, the customer's systems (human or AI) decide when to use it.

### 6. Full Provider API Proxy

**Why not:** RevBack should not become a proxy for the Stripe/Apple/Google APIs. Our Action API handles specific, well-defined remediation actions. We do NOT expose generic "call any Stripe endpoint" tools. This would create a security surface area we cannot control and would duplicate the provider's own APIs and MCP servers (Stripe already has an MCP server).

---

## Competitive Positioning

### Current Landscape

| Competitor | What They Offer | Agentic Integration |
|-----------|----------------|-------------------|
| Stripe Billing Alerts | Basic email alerts for failed payments | None |
| Baremetrics / ChartMogul | Revenue analytics dashboards | None |
| ProfitWell (Paddle) | Churn reduction, revenue metrics | Paddle has an MCP server for billing management |
| RevenueCat | Mobile subscription management | SDK + webhooks, no AI integration |
| Recurly | Subscription billing platform | Webhooks, no AI integration |

### RevBack's Differentiation

1. **Cross-platform intelligence.** Nobody else correlates Stripe + Apple + Google subscription data to find cross-platform issues (duplicate billing, platform conflicts). This is RevBack's unique data advantage.

2. **AI-native from day one.** While competitors add AI as a feature, RevBack is built for AI consumption. MCP tools, structured signals, compound signal analysis, and safety-tiered actions are core architecture, not afterthoughts.

3. **Investigation, not just alerts.** Competitors send "payment failed" alerts. RevBack's MCP tools let an agent investigate: look up the user, check their entitlements across platforms, search related events, identify the root cause, and propose a specific remediation action.

4. **Safety-tiered automation.** The four-tier action model (fully automated, guardrailed, human-approved, human-only) lets customers start conservative and gradually increase automation as trust builds. No competitor offers this graduated autonomy model.

5. **Revenue impact quantification.** Every signal includes estimated revenue impact. This lets agents prioritize by dollars at risk, not just severity labels. It also gives customers a clear ROI metric: "RevBack saved you $X this month."

### Positioning Statement

> RevBack is the revenue intelligence layer for AI-powered billing operations. Connect your billing sources, and RevBack becomes the MCP tool server that lets any AI agent detect, investigate, and resolve subscription issues across Stripe, Apple, and Google -- with safety guardrails that let you start with human approval and graduate to full automation.

---

## End-to-End Example Flow

### Scenario: Unrevoked Refund Detected

A customer (AcmeApp) has RevBack connected to Stripe and Apple. A user requests a refund through Stripe, but the app's access is not revoked. Here is the complete flow across all three phases.

#### Step 1: Detection (existing system)

RevBack's `unrevoked_refund` detector fires during a scheduled scan. It finds:
- User `u_abc123` received a Stripe refund of $9.99 two hours ago
- Their entitlement for "Premium" is still in `active` state
- Confidence: 0.95

The detector creates an issue in the database:

```json
{
  "id": "iss_xyz789",
  "issueType": "unrevoked_refund",
  "severity": "critical",
  "title": "Refund processed but access not revoked",
  "description": "User received a $9.99 refund on Stripe 2h ago but still has active Premium access",
  "userId": "u_abc123",
  "estimatedRevenueCents": 999,
  "confidence": 0.95,
  "evidence": {
    "refundEventId": "evt_stripe_xxx",
    "refundAmountCents": 999,
    "refundedAt": "2026-02-09T10:00:00Z",
    "currentEntitlementState": "active",
    "source": "stripe"
  }
}
```

#### Step 2: Webhook Delivery (Phase 1)

RevBack sends a webhook to AcmeApp's registered endpoint:

```
POST https://api.acmeapp.com/webhooks/revback
X-RevBack-Signature: sha256=abc123...
Content-Type: application/json

{
  "id": "wh_del_001",
  "event": "issue.created",
  "apiVersion": "2026-02-01",
  "timestamp": "2026-02-09T12:01:00Z",
  "orgId": "org_acme",
  "data": {
    "issue": {
      "id": "iss_xyz789",
      "issueType": "unrevoked_refund",
      "category": "revenue_protection",
      "severity": "critical",
      "confidence": 0.95,
      "title": "Refund processed but access not revoked",
      "affectedUser": {
        "userId": "u_abc123",
        "email": "jane@example.com",
        "externalIds": { "stripe": "cus_abc123" }
      },
      "revenueImpact": {
        "estimatedCents": 999,
        "currency": "USD",
        "direction": "leakage",
        "period": "recurring"
      },
      "recommendedAction": "Revoke this user's Premium access. The refund was processed on Stripe but access was not revoked, indicating a webhook handler gap.",
      "dashboardUrl": "https://app.revback.com/issues/iss_xyz789"
    }
  }
}
```

AcmeApp's webhook handler routes this to their AI billing agent.

#### Step 3: Agent Investigation (Phase 2 -- MCP)

AcmeApp's AI agent (built on Claude with MCP) receives the webhook and uses RevBack's MCP tools to investigate.

**Agent calls `get_issue_detail`:**

```
Tool: get_issue_detail
Input: { "issueId": "iss_xyz789" }
```

Returns the full issue with evidence, recommended actions, and deep links.

**Agent calls `lookup_user`:**

```
Tool: lookup_user
Input: { "userId": "u_abc123" }
```

Returns:
- User has 1 identity: Stripe `cus_abc123`
- 1 entitlement: Premium via Stripe, state = `active` (should be `refunded`)
- Recent events: purchase (30 days ago), renewal (yesterday), refund (2h ago)
- 1 open issue (this one)

**Agent calls `search_events`:**

```
Tool: search_events
Input: { "userId": "u_abc123", "eventType": "refund", "limit": 5 }
```

Confirms the refund event with exact amount and timestamp.

**Agent assessment:** The user was refunded $9.99 on Stripe. The entitlement should be in `refunded` state but is still `active`. This is likely because AcmeApp's refund webhook handler has a bug or the webhook was not delivered. Confidence: high. The recommended action is to revoke access and fix the webhook handler.

#### Step 4: Agent Takes Action (Phase 3 -- Action API)

The agent decides to revoke the entitlement using the Action API.

**Agent calls `POST /api/v1/actions`:**

```json
{
  "issueId": "iss_xyz789",
  "actionType": "revoke_after_refund",
  "reason": "User received Stripe refund of $9.99 2h ago. Entitlement still active. Refund confirmed via search_events. Revoking access per revenue protection policy.",
  "parameters": {
    "entitlementId": "ent_xxx",
    "newState": "refunded"
  }
}
```

**Action API processes:**

1. Action `revoke_after_refund` is Safety Tier B (guardrailed)
2. Guardrail check: confidence 0.95 > 0.90 threshold -- PASS
3. Guardrail check: revenue $9.99 < $500 cap -- PASS
4. Guardrail check: 1 revocation this hour < 10/hour limit -- PASS
5. Guardrail check: refund event verified in database -- PASS
6. Action EXECUTES: entitlement updated to `refunded` state

**Response:**

```json
{
  "actionId": "act_001",
  "status": "executed",
  "safetyTier": "B",
  "result": {
    "success": true,
    "details": "Entitlement ent_xxx updated from 'active' to 'refunded'",
    "rollbackAvailable": true,
    "rollbackExpiresAt": "2026-02-09T12:30:00Z"
  }
}
```

#### Step 5: Issue Resolution

The Action API automatically resolves the issue:

```json
{
  "issueId": "iss_xyz789",
  "status": "resolved",
  "resolution": "Entitlement revoked via Action API (act_001). Automated by AI agent.",
  "resolvedBy": "api_key:sk_acme_billing_agent"
}
```

RevBack sends a webhook: `issue.resolved` and `action.executed`.

#### Total Time: Detection to Resolution

| Step | Time |
|------|------|
| Refund processed | T+0 |
| RevBack detects unrevoked refund | T+2h (next scheduled scan) |
| Webhook delivered to AcmeApp | T+2h + 1s |
| Agent investigates via MCP | T+2h + 5s |
| Agent revokes via Action API | T+2h + 7s |
| Issue resolved | T+2h + 7s |

**Without RevBack:** This issue would persist until a customer complained or someone manually audited refund processing. That could be days or weeks. With RevBack + AI agent: 7 seconds from detection to resolution.

---

## Appendix: File Structure

Proposed new files for the integration layers:

```
src/
  mcp/
    server.ts              -- MCP server setup and Hono route mounting
    tools.ts               -- All 8 MCP tool registrations
    resources.ts           -- All 5 MCP resource registrations
    prompts.ts             -- All 3 prompt template registrations
    auth.ts                -- MCP-specific auth (API key + OAuth)
  webhooks/
    outbound.ts            -- Outbound webhook delivery engine
    types.ts               -- Webhook event types and payload schemas
    management.ts          -- Webhook endpoint management API
  actions/
    router.ts              -- Action API Hono routes
    executor.ts            -- Action execution with safety tier enforcement
    guardrails.ts          -- Guardrail definitions per action type
    approval.ts            -- Approval workflow for Tier C actions
    audit.ts               -- Action audit logging
```

This structure keeps each integration layer separate and self-contained while sharing the existing service layer (`src/api/`, `src/detection/`, `src/entitlement/`, `src/identity/`).
