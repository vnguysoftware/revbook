import { eq, and, desc, count, sum } from 'drizzle-orm';
import type { Database } from '../../config/database.js';
import { issues, organizations } from '../../models/schema.js';
import type { SlackMessage } from '../types.js';
import { formatIssuesSummary, formatError } from '../formatters.js';
import { createChildLogger } from '../../config/logger.js';

const log = createChildLogger('slack-issues');

/**
 * /rb issues <org-slug>
 *
 * Show open issue summary and top 5 critical issues for an organization.
 */
export async function handleIssues(db: Database, args: string): Promise<SlackMessage> {
  const slug = args.trim();
  if (!slug) {
    return formatError('Usage: `/rb issues <org-slug>`\n\nProvide the organization slug.');
  }

  // Find org by slug
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);

  if (!org) {
    return formatError(`Organization "${slug}" not found. Check the slug and try again.`);
  }

  log.info({ orgId: org.id, slug }, 'CX issues summary');

  // Get stats
  const [openCount] = await db
    .select({ count: count() })
    .from(issues)
    .where(and(eq(issues.orgId, org.id), eq(issues.status, 'open')));

  const [criticalCount] = await db
    .select({ count: count() })
    .from(issues)
    .where(
      and(eq(issues.orgId, org.id), eq(issues.status, 'open'), eq(issues.severity, 'critical')),
    );

  const [revenueAtRisk] = await db
    .select({ total: sum(issues.estimatedRevenueCents) })
    .from(issues)
    .where(and(eq(issues.orgId, org.id), eq(issues.status, 'open')));

  const byType = await db
    .select({
      issueType: issues.issueType,
      count: count(),
      revenue: sum(issues.estimatedRevenueCents),
    })
    .from(issues)
    .where(and(eq(issues.orgId, org.id), eq(issues.status, 'open')))
    .groupBy(issues.issueType);

  // Top 5 most critical/impactful open issues
  const topIssues = await db
    .select()
    .from(issues)
    .where(and(eq(issues.orgId, org.id), eq(issues.status, 'open')))
    .orderBy(desc(issues.severity), desc(issues.estimatedRevenueCents))
    .limit(5);

  return formatIssuesSummary(org.name, org.id, {
    open: openCount.count,
    critical: criticalCount.count,
    revenueAtRiskCents: Number(revenueAtRisk.total) || 0,
    byType: byType.map((t) => ({
      issueType: t.issueType,
      count: t.count,
      revenue: t.revenue,
    })),
  }, topIssues);
}
