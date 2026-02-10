import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Database } from '../config/database.js';

/**
 * Register MCP prompt templates for common agent workflows.
 */
export function registerPrompts(server: McpServer, _db: Database): void {

  // ─── triage_issues ────────────────────────────────────────────────

  server.prompt(
    'triage_issues',
    'Guide through prioritized issue triage: review critical issues first, then warnings, suggest actions.',
    {},
    async () => {
      return {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `You are a billing operations analyst triaging RevBack issues. Follow this workflow:

1. **Get the summary** — Call get_issue_summary to understand the current state.
2. **Review critical issues first** — Call list_issues with severity=critical. For each:
   - Read the title, description, and evidence
   - Note the recommended action
   - Estimate urgency based on revenue impact
3. **Review warnings** — Call list_issues with severity=warning.
4. **Check integration health** — Call get_integration_health to see if any connections are stale.
5. **Summarize findings** — Provide a prioritized list:
   - Issues requiring immediate action (revenue loss, access issues)
   - Issues to investigate (anomalies, data quality)
   - Issues to monitor (low severity, informational)

For each issue, explain:
- What happened (in plain language)
- How much revenue is at risk
- What action to take
- How urgent it is

Be concise but thorough. Focus on actionable insights.`,
          },
        }],
      };
    },
  );

  // ─── investigate_user ─────────────────────────────────────────────

  server.prompt(
    'investigate_user',
    'Deep investigation of a specific user\'s billing state across all platforms.',
    {
      userId: z.string().uuid().describe('The user ID to investigate'),
    },
    async (params) => {
      return {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `Investigate the billing state of user ${params.userId}. Follow this workflow:

1. **Look up the user** — Call lookup_user with userId="${params.userId}".
2. **Review identities** — List all billing platform identities (Stripe, Apple, Google).
3. **Check entitlements** — Call get_entitlements. For each entitlement:
   - Current state (active, expired, etc.)
   - Platform source
   - Current period dates
   - Any mismatches between platforms
4. **Review open issues** — Are there any detected problems for this user?
5. **Check recent events** — Look at the event timeline for anomalies:
   - Multiple purchases close together (duplicate billing?)
   - Refund without access revocation
   - Subscription on multiple platforms simultaneously
   - Missing renewal events (webhook gap?)
6. **Cross-reference** — Compare what each platform says about this user's state.

Provide a comprehensive report:
- User profile summary
- Subscription state per platform
- Any discrepancies or issues found
- Recommended actions
- Risk assessment (is this user likely experiencing a billing problem?)`,
          },
        }],
      };
    },
  );

  // ─── daily_review ─────────────────────────────────────────────────

  server.prompt(
    'daily_review',
    'Generate a daily billing health summary with key metrics, new issues, and trends.',
    {},
    async () => {
      return {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `Generate a daily billing health review. Follow this workflow:

1. **Get the issue summary** — Call get_issue_summary for current metrics.
2. **List new critical/warning issues** — Call list_issues for open issues.
3. **Check integration health** — Call get_integration_health.
4. **Review recent events** — Call search_events for the last 24 hours to spot anomalies.

Produce a structured daily report:

## Daily Billing Health Report

### Key Metrics
- Total open issues (and change from yesterday if known)
- Critical issues count
- Revenue at risk

### New Issues Today
- List each new issue with severity, type, and impact

### Integration Health
- Status of each connected billing source
- Any webhook delivery gaps or stale connections

### Recommendations
- Top 3 actions to take today
- Issues that should be escalated
- Trends to watch

Keep the report concise and actionable. A busy engineering lead should be able to scan it in 2 minutes.`,
          },
        }],
      };
    },
  );
}
