import { eq, and, desc, gte } from 'drizzle-orm';
import type { Database } from '../config/database.js';
import {
  issues,
  canonicalEvents,
  entitlements,
  users,
  userIdentities,
} from '../models/schema.js';
import type { Issue } from '../models/types.js';
import { callClaude, parseJsonFromResponse, isAiEnabled } from './client.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('ai-investigator');

// ─── Types ──────────────────────────────────────────────────────────

export interface Investigation {
  rootCause: string;
  impact: string;
  recommendation: string;
  confidence: number;
  reasoning: string;
  relatedIssueIds: string[];
  generatedAt: string;
}

const SYSTEM_PROMPT = `You are an expert billing and subscription systems analyst working for RevBack, a platform that detects payment and subscription issues across billing systems (Stripe, Apple App Store, Google Play).

Your job is to investigate detected billing issues and provide root cause analysis. You understand:
- Subscription lifecycle: purchase → renewal → cancellation → expiration
- Entitlement states: inactive, trial, active, grace_period, billing_retry, past_due, paused, expired, revoked, refunded
- Common billing failure modes: webhook delays, race conditions, platform outages, clock skew
- Cross-platform issues: state mismatches between Stripe and Apple for the same user
- Revenue impact: how billing issues translate to lost revenue or unauthorized access

When investigating an issue, analyze the evidence systematically:
1. Look at the event timeline to understand what happened chronologically
2. Identify the root cause (not just symptoms)
3. Assess who else might be affected
4. Provide actionable recommendations

Respond ONLY with valid JSON matching this schema:
{
  "rootCause": "string - concise explanation of why this happened",
  "impact": "string - who else is affected and how widespread",
  "recommendation": "string - specific actionable steps to fix this",
  "confidence": number between 0.0 and 1.0,
  "reasoning": "string - full chain of thought explaining your analysis",
  "relatedIssueIds": ["array of issue IDs that appear related"]
}`;

/**
 * Investigate a single issue by gathering context and calling Claude.
 * Returns cached investigation if available and still fresh.
 */
export async function investigateIssue(
  db: Database,
  orgId: string,
  issueId: string,
): Promise<Investigation | null> {
  // 1. Fetch the issue
  const [issue] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.orgId, orgId), eq(issues.id, issueId)))
    .limit(1);

  if (!issue) {
    log.warn({ issueId }, 'Issue not found for investigation');
    return null;
  }

  // 2. Check for cached investigation
  const evidence = (issue.evidence || {}) as Record<string, unknown>;
  const cached = evidence.aiInvestigation as Investigation | undefined;
  if (cached?.generatedAt) {
    const generatedAt = new Date(cached.generatedAt);
    const hoursSinceGenerated = (Date.now() - generatedAt.getTime()) / (1000 * 60 * 60);
    // Cache for 24 hours unless issue was updated since generation
    const issueUpdatedAfter = issue.updatedAt > generatedAt;
    if (hoursSinceGenerated < 24 && !issueUpdatedAfter) {
      log.debug({ issueId }, 'Returning cached AI investigation');
      return cached;
    }
  }

  // 3. Check if AI is enabled
  if (!isAiEnabled()) {
    return null;
  }

  // 4. Gather context
  const context = await gatherInvestigationContext(db, orgId, issue as Issue);

  // 5. Build prompt and call Claude
  const userPrompt = buildInvestigationPrompt(issue as Issue, context);

  const response = await callClaude({
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: 2048,
    temperature: 0.2,
  });

  if (!response) {
    log.warn({ issueId }, 'AI call returned no response');
    return null;
  }

  // 6. Parse the response
  const investigation = parseJsonFromResponse<Investigation>(response.content);
  if (!investigation) {
    log.warn({ issueId }, 'Failed to parse AI investigation response');
    return null;
  }

  // Ensure generatedAt is set
  investigation.generatedAt = new Date().toISOString();

  // 7. Cache the investigation in the issue's evidence JSON
  const updatedEvidence = {
    ...evidence,
    aiInvestigation: investigation,
  };

  await db
    .update(issues)
    .set({ evidence: updatedEvidence, updatedAt: new Date() })
    .where(and(eq(issues.orgId, orgId), eq(issues.id, issueId)));

  log.info(
    { issueId, confidence: investigation.confidence },
    'AI investigation completed and cached',
  );

  return investigation;
}

// ─── Context Gathering ──────────────────────────────────────────────

interface InvestigationContext {
  userEvents: Array<Record<string, unknown>>;
  userEntitlements: Array<Record<string, unknown>>;
  userIdentitiesList: Array<Record<string, unknown>>;
  relatedIssues: Array<Record<string, unknown>>;
  similarIssues: Array<Record<string, unknown>>;
}

async function gatherInvestigationContext(
  db: Database,
  orgId: string,
  issue: Issue,
): Promise<InvestigationContext> {
  const result: InvestigationContext = {
    userEvents: [],
    userEntitlements: [],
    userIdentitiesList: [],
    relatedIssues: [],
    similarIssues: [],
  };

  // Gather user-specific context if we have a userId
  if (issue.userId) {
    // User's recent event timeline (last 50 events)
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
        externalSubscriptionId: canonicalEvents.externalSubscriptionId,
        periodType: canonicalEvents.periodType,
        expirationTime: canonicalEvents.expirationTime,
        cancellationReason: canonicalEvents.cancellationReason,
        environment: canonicalEvents.environment,
      })
      .from(canonicalEvents)
      .where(
        and(
          eq(canonicalEvents.orgId, orgId),
          eq(canonicalEvents.userId, issue.userId),
        ),
      )
      .orderBy(desc(canonicalEvents.eventTime))
      .limit(50);

    result.userEvents = events as any[];

    // User's entitlements
    const ents = await db
      .select({
        id: entitlements.id,
        productId: entitlements.productId,
        source: entitlements.source,
        state: entitlements.state,
        currentPeriodStart: entitlements.currentPeriodStart,
        currentPeriodEnd: entitlements.currentPeriodEnd,
        cancelAt: entitlements.cancelAt,
        trialEnd: entitlements.trialEnd,
        stateHistory: entitlements.stateHistory,
      })
      .from(entitlements)
      .where(
        and(
          eq(entitlements.orgId, orgId),
          eq(entitlements.userId, issue.userId),
        ),
      );

    result.userEntitlements = ents as any[];

    // User's identities (cross-platform mapping)
    const identities = await db
      .select({
        source: userIdentities.source,
        externalId: userIdentities.externalId,
        idType: userIdentities.idType,
      })
      .from(userIdentities)
      .where(
        and(
          eq(userIdentities.orgId, orgId),
          eq(userIdentities.userId, issue.userId),
        ),
      );

    result.userIdentitiesList = identities as any[];

    // Other open issues for the same user
    const relatedUserIssues = await db
      .select({
        id: issues.id,
        issueType: issues.issueType,
        severity: issues.severity,
        status: issues.status,
        title: issues.title,
        confidence: issues.confidence,
        createdAt: issues.createdAt,
      })
      .from(issues)
      .where(
        and(
          eq(issues.orgId, orgId),
          eq(issues.userId, issue.userId),
        ),
      )
      .orderBy(desc(issues.createdAt))
      .limit(20);

    result.relatedIssues = relatedUserIssues.filter((i) => i.id !== issue.id) as any[];
  }

  // Similar issues across other users (same type, recent)
  const recentWindow = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours
  const similar = await db
    .select({
      id: issues.id,
      userId: issues.userId,
      issueType: issues.issueType,
      severity: issues.severity,
      status: issues.status,
      title: issues.title,
      confidence: issues.confidence,
      createdAt: issues.createdAt,
    })
    .from(issues)
    .where(
      and(
        eq(issues.orgId, orgId),
        eq(issues.issueType, issue.issueType),
        gte(issues.createdAt, recentWindow),
      ),
    )
    .orderBy(desc(issues.createdAt))
    .limit(50);

  result.similarIssues = similar.filter((i) => i.id !== issue.id) as any[];

  return result;
}

// ─── Prompt Construction ────────────────────────────────────────────

function buildInvestigationPrompt(issue: Issue, context: InvestigationContext): string {
  const sections: string[] = [];

  sections.push(`## Issue Under Investigation

- **ID:** ${issue.id}
- **Type:** ${issue.issueType}
- **Severity:** ${issue.severity}
- **Status:** ${issue.status}
- **Title:** ${issue.title}
- **Description:** ${issue.description}
- **Confidence:** ${issue.confidence ?? 'N/A'}
- **Estimated Revenue Impact:** ${issue.estimatedRevenueCents ? `$${(issue.estimatedRevenueCents / 100).toFixed(2)}` : 'Unknown'}
- **Detector:** ${issue.detectorId}
- **Detected At:** ${issue.createdAt}
- **Evidence:** ${JSON.stringify(issue.evidence, null, 2)}`);

  if (context.userEvents.length > 0) {
    sections.push(`## User Event Timeline (most recent first)

${JSON.stringify(context.userEvents, null, 2)}`);
  }

  if (context.userEntitlements.length > 0) {
    sections.push(`## User Entitlements

${JSON.stringify(context.userEntitlements, null, 2)}`);
  }

  if (context.userIdentitiesList.length > 0) {
    sections.push(`## User Cross-Platform Identities

${JSON.stringify(context.userIdentitiesList, null, 2)}`);
  }

  if (context.relatedIssues.length > 0) {
    sections.push(`## Other Issues for This User

${JSON.stringify(context.relatedIssues, null, 2)}`);
  }

  if (context.similarIssues.length > 0) {
    sections.push(`## Similar Issues Across Other Users (last 24h)

Found ${context.similarIssues.length} similar "${issue.issueType}" issues in the last 24 hours.

${JSON.stringify(context.similarIssues.slice(0, 20), null, 2)}`);
  } else {
    sections.push(`## Similar Issues Across Other Users

No similar "${issue.issueType}" issues found in the last 24 hours. This appears to be an isolated incident.`);
  }

  sections.push(`## Instructions

Analyze the evidence above and provide your investigation as a JSON object. Consider:
1. What is the root cause? (webhook delay? platform outage? race condition? configuration error?)
2. Is this an isolated incident or part of a pattern? (look at similar issues count)
3. What specific action should the operator take?
4. How confident are you in this analysis?
5. List any related issue IDs from the evidence above.`);

  return sections.join('\n\n');
}
