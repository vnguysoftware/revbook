import { eq, and, desc, gte, inArray, count, sql, sum } from 'drizzle-orm';
import type { Database } from '../config/database.js';
import { issues } from '../models/schema.js';
import { callClaude, parseJsonFromResponse, isAiEnabled } from './client.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('ai-grouper');

// ─── Types ──────────────────────────────────────────────────────────

export interface IncidentCluster {
  id: string;
  title: string;
  summary: string;
  issueType: string;
  severity: 'critical' | 'warning' | 'info';
  issueCount: number;
  affectedUsers: number;
  totalRevenueCents: number;
  timeWindowStart: string;
  timeWindowEnd: string;
  source: string | null;
  issueIds: string[];
  generatedAt: string;
}

interface AiGroupingSuggestion {
  title: string;
  summary: string;
  severity: 'critical' | 'warning' | 'info';
  source: string | null;
}

const GROUPER_SYSTEM_PROMPT = `You are a billing incident analyst. Your job is to look at clusters of similar billing issues and determine if they represent a single incident (e.g., a platform outage, webhook delivery failure, or billing system misconfiguration).

When you see a cluster of issues, provide:
1. A concise incident title (like "Apple Webhook Outage" or "Stripe Billing Retry Failures")
2. A summary explaining the likely root cause and scope
3. The overall severity (critical if revenue loss > $100 or > 10 users, warning if smaller, info if cosmetic)
4. The billing source if identifiable (stripe, apple, google, or null)

Respond ONLY with valid JSON:
{
  "title": "short incident title",
  "summary": "explanation of what happened and likely root cause",
  "severity": "critical|warning|info",
  "source": "stripe|apple|google|null"
}`;

/**
 * Scan open issues and group them into incident clusters.
 *
 * Grouping strategy:
 * 1. Group by issue type
 * 2. Within each type, identify temporal clusters (issues within 2-hour windows)
 * 3. If a cluster has 3+ issues, treat it as an incident
 * 4. Optionally use AI to generate incident title/summary for large clusters
 */
export async function findIncidentClusters(
  db: Database,
  orgId: string,
  options?: { windowHours?: number; minClusterSize?: number },
): Promise<IncidentCluster[]> {
  const windowHours = options?.windowHours ?? 4;
  const minClusterSize = options?.minClusterSize ?? 3;

  // Fetch all open issues from the last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const openIssues = await db
    .select({
      id: issues.id,
      userId: issues.userId,
      issueType: issues.issueType,
      severity: issues.severity,
      title: issues.title,
      estimatedRevenueCents: issues.estimatedRevenueCents,
      evidence: issues.evidence,
      createdAt: issues.createdAt,
    })
    .from(issues)
    .where(
      and(
        eq(issues.orgId, orgId),
        inArray(issues.status, ['open', 'acknowledged']),
        gte(issues.createdAt, sevenDaysAgo),
      ),
    )
    .orderBy(desc(issues.createdAt));

  if (openIssues.length === 0) {
    return [];
  }

  // Group by issue type
  const byType = new Map<string, typeof openIssues>();
  for (const issue of openIssues) {
    const key = issue.issueType;
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key)!.push(issue);
  }

  const clusters: IncidentCluster[] = [];

  for (const [issueType, typeIssues] of byType) {
    // Sort by time
    const sorted = typeIssues.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    // Find temporal clusters using sliding window
    const temporalClusters = findTemporalClusters(sorted, windowHours);

    for (const cluster of temporalClusters) {
      if (cluster.length < minClusterSize) continue;

      const issueIds = cluster.map((i) => i.id);
      const uniqueUsers = new Set(cluster.map((i) => i.userId).filter(Boolean));
      const totalRevenue = cluster.reduce(
        (sum, i) => sum + (i.estimatedRevenueCents || 0),
        0,
      );
      const timeStart = cluster[0].createdAt;
      const timeEnd = cluster[cluster.length - 1].createdAt;

      // Determine severity based on impact
      let severity: 'critical' | 'warning' | 'info' = 'info';
      if (totalRevenue > 10000 || uniqueUsers.size > 10) {
        severity = 'critical';
      } else if (totalRevenue > 1000 || uniqueUsers.size > 3) {
        severity = 'warning';
      }

      // Try to get AI-generated title/summary for significant clusters
      let title = `${issueType} cluster: ${cluster.length} issues in ${windowHours}h window`;
      let summary = `${cluster.length} "${issueType}" issues detected between ${new Date(timeStart).toISOString()} and ${new Date(timeEnd).toISOString()}, affecting ${uniqueUsers.size} users with $${(totalRevenue / 100).toFixed(2)} total revenue impact.`;
      let source: string | null = null;

      if (isAiEnabled() && cluster.length >= 5) {
        const aiSuggestion = await getAiGroupingSuggestion(
          issueType,
          cluster,
          uniqueUsers.size,
          totalRevenue,
        );
        if (aiSuggestion) {
          title = aiSuggestion.title;
          summary = aiSuggestion.summary;
          severity = aiSuggestion.severity;
          source = aiSuggestion.source;
        }
      } else {
        // Infer source from evidence
        const sources = cluster
          .map((i) => (i.evidence as any)?.source)
          .filter(Boolean);
        if (sources.length > 0) {
          const mostCommon = mode(sources);
          if (mostCommon) source = mostCommon;
        }
      }

      clusters.push({
        id: `incident-${issueType}-${new Date(timeStart).getTime()}`,
        title,
        summary,
        issueType,
        severity,
        issueCount: cluster.length,
        affectedUsers: uniqueUsers.size,
        totalRevenueCents: totalRevenue,
        timeWindowStart: new Date(timeStart).toISOString(),
        timeWindowEnd: new Date(timeEnd).toISOString(),
        source,
        issueIds,
        generatedAt: new Date().toISOString(),
      });
    }
  }

  // Sort by severity then by issue count
  clusters.sort((a, b) => {
    const sevOrder = { critical: 0, warning: 1, info: 2 };
    const sevDiff = sevOrder[a.severity] - sevOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.issueCount - a.issueCount;
  });

  log.info(
    { orgId, totalClusters: clusters.length, totalIssuesGrouped: clusters.reduce((s, c) => s + c.issueCount, 0) },
    'Incident clustering completed',
  );

  return clusters;
}

// ─── Temporal Clustering ────────────────────────────────────────────

function findTemporalClusters<T extends { createdAt: Date | string }>(
  sorted: T[],
  windowHours: number,
): T[][] {
  if (sorted.length === 0) return [];

  const windowMs = windowHours * 60 * 60 * 1000;
  const clusters: T[][] = [];
  let currentCluster: T[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prevTime = new Date(sorted[i - 1].createdAt).getTime();
    const currTime = new Date(sorted[i].createdAt).getTime();

    if (currTime - prevTime <= windowMs) {
      currentCluster.push(sorted[i]);
    } else {
      clusters.push(currentCluster);
      currentCluster = [sorted[i]];
    }
  }

  clusters.push(currentCluster);
  return clusters;
}

// ─── AI Grouping ────────────────────────────────────────────────────

async function getAiGroupingSuggestion(
  issueType: string,
  cluster: Array<{ title: string; evidence: unknown; createdAt: Date | string }>,
  affectedUsers: number,
  totalRevenueCents: number,
): Promise<AiGroupingSuggestion | null> {
  const sampleIssues = cluster.slice(0, 10).map((i) => ({
    title: i.title,
    evidence: i.evidence,
    createdAt: i.createdAt,
  }));

  const prompt = `I found a cluster of ${cluster.length} "${issueType}" issues occurring within a short time window, affecting ${affectedUsers} users with $${(totalRevenueCents / 100).toFixed(2)} total revenue impact.

Here are sample issues from this cluster:
${JSON.stringify(sampleIssues, null, 2)}

Based on these patterns, generate an incident title and summary.`;

  const response = await callClaude({
    systemPrompt: GROUPER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 512,
    temperature: 0.2,
  });

  if (!response) return null;

  return parseJsonFromResponse<AiGroupingSuggestion>(response.content);
}

// ─── Helpers ────────────────────────────────────────────────────────

function mode(arr: string[]): string | null {
  const counts = new Map<string, number>();
  for (const val of arr) {
    counts.set(val, (counts.get(val) || 0) + 1);
  }
  let maxCount = 0;
  let maxVal: string | null = null;
  for (const [val, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      maxVal = val;
    }
  }
  return maxVal;
}
