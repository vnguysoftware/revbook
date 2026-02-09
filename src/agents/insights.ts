import { eq, and, desc, gte, count, sum, sql } from 'drizzle-orm';
import type { Database } from '../config/database.js';
import { issues, canonicalEvents, entitlements } from '../models/schema.js';
import { callClaude, parseJsonFromResponse, isAiEnabled } from './client.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('ai-insights');

// ─── Types ──────────────────────────────────────────────────────────

export interface Insight {
  title: string;
  description: string;
  category: 'trend' | 'anomaly' | 'recommendation' | 'performance';
  severity: 'info' | 'warning' | 'critical';
  metric?: { name: string; current: number; previous: number; change: number };
}

interface InsightsReport {
  insights: Insight[];
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
}

interface AiInsightsResponse {
  insights: Insight[];
}

const INSIGHTS_SYSTEM_PROMPT = `You are a billing health analyst for RevBack, a platform that detects subscription and payment issues. You analyze trends in billing data and issue detection to produce actionable insights.

Your insights should be:
- Specific and data-driven (reference actual numbers)
- Actionable (tell the operator what to do)
- Prioritized by business impact

Categories:
- "trend": A notable change in a metric over time (e.g., issue frequency increasing)
- "anomaly": An unusual pattern that deviates from normal (e.g., sudden spike in refunds)
- "recommendation": A proactive suggestion based on patterns (e.g., "consider adding a webhook retry")
- "performance": How well the detection system is performing (e.g., detector accuracy)

Severity:
- "critical": Requires immediate attention, significant revenue impact
- "warning": Should be addressed soon
- "info": Good to know, no immediate action needed

Respond ONLY with valid JSON:
{
  "insights": [
    {
      "title": "short descriptive title",
      "description": "detailed explanation with numbers",
      "category": "trend|anomaly|recommendation|performance",
      "severity": "info|warning|critical",
      "metric": { "name": "metric name", "current": 123, "previous": 100, "change": 23 }
    }
  ]
}

The metric field is optional. Include it when there's a clear quantitative comparison.`;

/**
 * Generate AI insights for an organization's billing health.
 *
 * @param period - 'daily' (last 24h vs previous 24h) or 'weekly' (last 7d vs previous 7d)
 */
export async function generateInsights(
  db: Database,
  orgId: string,
  period: 'daily' | 'weekly' = 'daily',
): Promise<InsightsReport> {
  const now = new Date();
  const periodMs = period === 'daily' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  const currentStart = new Date(now.getTime() - periodMs);
  const previousStart = new Date(currentStart.getTime() - periodMs);

  // 1. Gather metrics for current and previous periods
  const metrics = await gatherMetrics(db, orgId, currentStart, previousStart, now);

  // 2. Generate rule-based insights (always available, no AI needed)
  const ruleBasedInsights = generateRuleBasedInsights(metrics, period);

  // 3. If AI is available, enhance with AI analysis
  let aiInsights: Insight[] = [];
  if (isAiEnabled()) {
    aiInsights = await generateAiInsights(metrics, period) || [];
  }

  // Merge and deduplicate (AI insights take priority for similar topics)
  const allInsights = deduplicateInsights([...aiInsights, ...ruleBasedInsights]);

  // Sort by severity
  const sevOrder = { critical: 0, warning: 1, info: 2 };
  allInsights.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);

  return {
    insights: allInsights,
    periodStart: currentStart.toISOString(),
    periodEnd: now.toISOString(),
    generatedAt: now.toISOString(),
  };
}

// ─── Metrics Collection ─────────────────────────────────────────────

interface PeriodMetrics {
  current: {
    totalIssues: number;
    criticalIssues: number;
    warningIssues: number;
    resolvedIssues: number;
    dismissedIssues: number;
    revenueAtRiskCents: number;
    issuesByType: Array<{ type: string; count: number; revenue: number }>;
    totalEvents: number;
    failedEvents: number;
    eventsBySource: Array<{ source: string; count: number }>;
  };
  previous: {
    totalIssues: number;
    criticalIssues: number;
    resolvedIssues: number;
    dismissedIssues: number;
    revenueAtRiskCents: number;
    totalEvents: number;
    failedEvents: number;
  };
  entitlementSnapshot: {
    total: number;
    byState: Array<{ state: string; count: number }>;
  };
}

async function gatherMetrics(
  db: Database,
  orgId: string,
  currentStart: Date,
  previousStart: Date,
  now: Date,
): Promise<PeriodMetrics> {
  // Current period issue counts
  const [currentIssueCount] = await db
    .select({ count: count() })
    .from(issues)
    .where(and(eq(issues.orgId, orgId), gte(issues.createdAt, currentStart)));

  const [currentCritical] = await db
    .select({ count: count() })
    .from(issues)
    .where(
      and(
        eq(issues.orgId, orgId),
        eq(issues.severity, 'critical'),
        gte(issues.createdAt, currentStart),
      ),
    );

  const [currentWarning] = await db
    .select({ count: count() })
    .from(issues)
    .where(
      and(
        eq(issues.orgId, orgId),
        eq(issues.severity, 'warning'),
        gte(issues.createdAt, currentStart),
      ),
    );

  const [currentResolved] = await db
    .select({ count: count() })
    .from(issues)
    .where(
      and(
        eq(issues.orgId, orgId),
        eq(issues.status, 'resolved'),
        gte(issues.updatedAt, currentStart),
      ),
    );

  const [currentDismissed] = await db
    .select({ count: count() })
    .from(issues)
    .where(
      and(
        eq(issues.orgId, orgId),
        eq(issues.status, 'dismissed'),
        gte(issues.updatedAt, currentStart),
      ),
    );

  const [currentRevenue] = await db
    .select({ total: sum(issues.estimatedRevenueCents) })
    .from(issues)
    .where(
      and(
        eq(issues.orgId, orgId),
        eq(issues.status, 'open'),
        gte(issues.createdAt, currentStart),
      ),
    );

  const currentByType = await db
    .select({
      type: issues.issueType,
      count: count(),
      revenue: sum(issues.estimatedRevenueCents),
    })
    .from(issues)
    .where(and(eq(issues.orgId, orgId), gte(issues.createdAt, currentStart)))
    .groupBy(issues.issueType);

  // Current period events
  const [currentEventCount] = await db
    .select({ count: count() })
    .from(canonicalEvents)
    .where(and(eq(canonicalEvents.orgId, orgId), gte(canonicalEvents.eventTime, currentStart)));

  const [currentFailedEvents] = await db
    .select({ count: count() })
    .from(canonicalEvents)
    .where(
      and(
        eq(canonicalEvents.orgId, orgId),
        eq(canonicalEvents.status, 'failed'),
        gte(canonicalEvents.eventTime, currentStart),
      ),
    );

  const currentBySource = await db
    .select({
      source: canonicalEvents.source,
      count: count(),
    })
    .from(canonicalEvents)
    .where(and(eq(canonicalEvents.orgId, orgId), gte(canonicalEvents.eventTime, currentStart)))
    .groupBy(canonicalEvents.source);

  // Previous period (simpler — just counts for comparison)
  const [prevIssueCount] = await db
    .select({ count: count() })
    .from(issues)
    .where(
      and(
        eq(issues.orgId, orgId),
        gte(issues.createdAt, previousStart),
        sql`${issues.createdAt} < ${currentStart}`,
      ),
    );

  const [prevCritical] = await db
    .select({ count: count() })
    .from(issues)
    .where(
      and(
        eq(issues.orgId, orgId),
        eq(issues.severity, 'critical'),
        gte(issues.createdAt, previousStart),
        sql`${issues.createdAt} < ${currentStart}`,
      ),
    );

  const [prevResolved] = await db
    .select({ count: count() })
    .from(issues)
    .where(
      and(
        eq(issues.orgId, orgId),
        eq(issues.status, 'resolved'),
        gte(issues.updatedAt, previousStart),
        sql`${issues.updatedAt} < ${currentStart}`,
      ),
    );

  const [prevDismissed] = await db
    .select({ count: count() })
    .from(issues)
    .where(
      and(
        eq(issues.orgId, orgId),
        eq(issues.status, 'dismissed'),
        gte(issues.updatedAt, previousStart),
        sql`${issues.updatedAt} < ${currentStart}`,
      ),
    );

  const [prevRevenue] = await db
    .select({ total: sum(issues.estimatedRevenueCents) })
    .from(issues)
    .where(
      and(
        eq(issues.orgId, orgId),
        eq(issues.status, 'open'),
        gte(issues.createdAt, previousStart),
        sql`${issues.createdAt} < ${currentStart}`,
      ),
    );

  const [prevEventCount] = await db
    .select({ count: count() })
    .from(canonicalEvents)
    .where(
      and(
        eq(canonicalEvents.orgId, orgId),
        gte(canonicalEvents.eventTime, previousStart),
        sql`${canonicalEvents.eventTime} < ${currentStart}`,
      ),
    );

  const [prevFailedEvents] = await db
    .select({ count: count() })
    .from(canonicalEvents)
    .where(
      and(
        eq(canonicalEvents.orgId, orgId),
        eq(canonicalEvents.status, 'failed'),
        gte(canonicalEvents.eventTime, previousStart),
        sql`${canonicalEvents.eventTime} < ${currentStart}`,
      ),
    );

  // Entitlement snapshot
  const [entTotal] = await db
    .select({ count: count() })
    .from(entitlements)
    .where(eq(entitlements.orgId, orgId));

  const entByState = await db
    .select({ state: entitlements.state, count: count() })
    .from(entitlements)
    .where(eq(entitlements.orgId, orgId))
    .groupBy(entitlements.state);

  return {
    current: {
      totalIssues: currentIssueCount.count,
      criticalIssues: currentCritical.count,
      warningIssues: currentWarning.count,
      resolvedIssues: currentResolved.count,
      dismissedIssues: currentDismissed.count,
      revenueAtRiskCents: Number(currentRevenue.total) || 0,
      issuesByType: currentByType.map((r) => ({
        type: r.type,
        count: r.count,
        revenue: Number(r.revenue) || 0,
      })),
      totalEvents: currentEventCount.count,
      failedEvents: currentFailedEvents.count,
      eventsBySource: currentBySource.map((r) => ({
        source: r.source,
        count: r.count,
      })),
    },
    previous: {
      totalIssues: prevIssueCount.count,
      criticalIssues: prevCritical.count,
      resolvedIssues: prevResolved.count,
      dismissedIssues: prevDismissed.count,
      revenueAtRiskCents: Number(prevRevenue.total) || 0,
      totalEvents: prevEventCount.count,
      failedEvents: prevFailedEvents.count,
    },
    entitlementSnapshot: {
      total: entTotal.count,
      byState: entByState.map((r) => ({ state: r.state, count: r.count })),
    },
  };
}

// ─── Rule-Based Insights (no AI needed) ─────────────────────────────

function generateRuleBasedInsights(metrics: PeriodMetrics, period: string): Insight[] {
  const insights: Insight[] = [];
  const c = metrics.current;
  const p = metrics.previous;
  const periodLabel = period === 'daily' ? '24 hours' : '7 days';

  // Issue volume change
  if (p.totalIssues > 0) {
    const changePercent = ((c.totalIssues - p.totalIssues) / p.totalIssues) * 100;
    if (Math.abs(changePercent) >= 20) {
      const direction = changePercent > 0 ? 'increased' : 'decreased';
      insights.push({
        title: `Issue volume ${direction} ${Math.abs(Math.round(changePercent))}%`,
        description: `${c.totalIssues} issues detected in the last ${periodLabel} compared to ${p.totalIssues} in the previous period. ${
          changePercent > 50
            ? 'This significant increase may indicate a systemic problem.'
            : changePercent < -30
            ? 'Great improvement! Your billing health is getting better.'
            : ''
        }`,
        category: changePercent > 50 ? 'anomaly' : 'trend',
        severity: changePercent > 100 ? 'critical' : changePercent > 50 ? 'warning' : 'info',
        metric: {
          name: 'issues_detected',
          current: c.totalIssues,
          previous: p.totalIssues,
          change: changePercent,
        },
      });
    }
  }

  // Critical issues spike
  if (c.criticalIssues > 0 && c.criticalIssues > p.criticalIssues * 2) {
    insights.push({
      title: 'Critical issue spike detected',
      description: `${c.criticalIssues} critical issues in the last ${periodLabel} (up from ${p.criticalIssues}). Critical issues directly impact revenue and user experience. Investigate immediately.`,
      category: 'anomaly',
      severity: 'critical',
      metric: {
        name: 'critical_issues',
        current: c.criticalIssues,
        previous: p.criticalIssues,
        change: p.criticalIssues > 0 ? ((c.criticalIssues - p.criticalIssues) / p.criticalIssues) * 100 : 100,
      },
    });
  }

  // Revenue at risk
  if (c.revenueAtRiskCents > 10000) {
    insights.push({
      title: `$${(c.revenueAtRiskCents / 100).toFixed(0)} revenue at risk`,
      description: `Open issues in the last ${periodLabel} represent $${(c.revenueAtRiskCents / 100).toFixed(2)} in potential revenue impact. ${
        p.revenueAtRiskCents > 0
          ? `This is ${c.revenueAtRiskCents > p.revenueAtRiskCents ? 'up' : 'down'} from $${(p.revenueAtRiskCents / 100).toFixed(2)} in the previous period.`
          : ''
      }`,
      category: 'trend',
      severity: c.revenueAtRiskCents > 100000 ? 'critical' : 'warning',
      metric: {
        name: 'revenue_at_risk_cents',
        current: c.revenueAtRiskCents,
        previous: p.revenueAtRiskCents,
        change: p.revenueAtRiskCents > 0 ? ((c.revenueAtRiskCents - p.revenueAtRiskCents) / p.revenueAtRiskCents) * 100 : 100,
      },
    });
  }

  // Resolution rate
  const totalResolvable = c.resolvedIssues + c.dismissedIssues + c.totalIssues;
  if (totalResolvable > 0) {
    const resolutionRate = (c.resolvedIssues / Math.max(c.totalIssues, 1)) * 100;
    if (resolutionRate < 30 && c.totalIssues > 5) {
      insights.push({
        title: 'Low issue resolution rate',
        description: `Only ${Math.round(resolutionRate)}% of issues are being resolved. ${c.totalIssues} issues were detected but only ${c.resolvedIssues} were resolved in the last ${periodLabel}. Consider reviewing your issue triage workflow.`,
        category: 'recommendation',
        severity: 'warning',
      });
    }
  }

  // Failed events
  if (c.failedEvents > 0 && c.totalEvents > 0) {
    const failRate = (c.failedEvents / c.totalEvents) * 100;
    if (failRate > 5) {
      insights.push({
        title: `${failRate.toFixed(1)}% event failure rate`,
        description: `${c.failedEvents} out of ${c.totalEvents} billing events failed in the last ${periodLabel}. This is above the 5% threshold and may indicate integration problems.`,
        category: 'anomaly',
        severity: failRate > 20 ? 'critical' : 'warning',
        metric: {
          name: 'event_failure_rate',
          current: c.failedEvents,
          previous: p.failedEvents,
          change: p.failedEvents > 0 ? ((c.failedEvents - p.failedEvents) / p.failedEvents) * 100 : 100,
        },
      });
    }
  }

  // Dominant issue type
  if (c.issuesByType.length > 0) {
    const sorted = [...c.issuesByType].sort((a, b) => b.count - a.count);
    const dominant = sorted[0];
    if (dominant.count >= 5 && dominant.count > c.totalIssues * 0.5) {
      insights.push({
        title: `"${dominant.type}" is the dominant issue type`,
        description: `${dominant.type} accounts for ${dominant.count} of ${c.totalIssues} total issues (${Math.round((dominant.count / c.totalIssues) * 100)}%). ${
          dominant.revenue > 0
            ? `These issues represent $${(dominant.revenue / 100).toFixed(2)} in revenue impact.`
            : ''
        } Focus investigation efforts here for the biggest impact.`,
        category: 'recommendation',
        severity: dominant.count > 20 ? 'warning' : 'info',
      });
    }
  }

  return insights;
}

// ─── AI-Enhanced Insights ───────────────────────────────────────────

async function generateAiInsights(
  metrics: PeriodMetrics,
  period: string,
): Promise<Insight[] | null> {
  const prompt = `Analyze the following billing health metrics and generate insights.

## Current Period (last ${period === 'daily' ? '24 hours' : '7 days'})
- Total issues detected: ${metrics.current.totalIssues}
- Critical issues: ${metrics.current.criticalIssues}
- Warning issues: ${metrics.current.warningIssues}
- Resolved: ${metrics.current.resolvedIssues}
- Dismissed: ${metrics.current.dismissedIssues}
- Revenue at risk: $${(metrics.current.revenueAtRiskCents / 100).toFixed(2)}
- Total billing events: ${metrics.current.totalEvents}
- Failed events: ${metrics.current.failedEvents}
- Issues by type: ${JSON.stringify(metrics.current.issuesByType)}
- Events by source: ${JSON.stringify(metrics.current.eventsBySource)}

## Previous Period
- Total issues: ${metrics.previous.totalIssues}
- Critical: ${metrics.previous.criticalIssues}
- Resolved: ${metrics.previous.resolvedIssues}
- Dismissed: ${metrics.previous.dismissedIssues}
- Revenue at risk: $${(metrics.previous.revenueAtRiskCents / 100).toFixed(2)}
- Events: ${metrics.previous.totalEvents}
- Failed events: ${metrics.previous.failedEvents}

## Entitlement Snapshot
- Total entitlements: ${metrics.entitlementSnapshot.total}
- By state: ${JSON.stringify(metrics.entitlementSnapshot.byState)}

Generate 2-4 insights that would be most valuable to a billing operations team. Focus on patterns that a human might miss. Do NOT generate insights about things that look normal.`;

  const response = await callClaude({
    systemPrompt: INSIGHTS_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 1500,
    temperature: 0.3,
  });

  if (!response) return null;

  const parsed = parseJsonFromResponse<AiInsightsResponse>(response.content);
  if (!parsed?.insights) return null;

  return parsed.insights;
}

// ─── Deduplication ──────────────────────────────────────────────────

function deduplicateInsights(insights: Insight[]): Insight[] {
  const seen = new Set<string>();
  const result: Insight[] = [];

  for (const insight of insights) {
    // Create a rough key based on category + the first few words of title
    const key = `${insight.category}-${insight.title.split(' ').slice(0, 4).join(' ').toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(insight);
    }
  }

  return result;
}
