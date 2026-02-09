import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import type { Database } from '../config/database.js';
import { issues } from '../models/schema.js';
import type { AuthContext } from '../middleware/auth.js';
import { isAiEnabled, getTokenUsage } from '../agents/client.js';
import { investigateIssue, type Investigation } from '../agents/investigator.js';
import { findIncidentClusters } from '../agents/grouper.js';
import { generateInsights } from '../agents/insights.js';
import { recordFeedback, getDetectorHealthMetrics } from '../agents/learner.js';
import { enqueueInvestigation } from '../agents/worker.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('api-ai');

const AI_UNAVAILABLE_MSG =
  'AI investigation not available — configure ANTHROPIC_API_KEY to enable';

/**
 * AI-powered API routes.
 *
 * All routes gracefully degrade when ANTHROPIC_API_KEY is not set:
 * investigation/insights endpoints return a clear message telling
 * the operator to configure the key. Feedback and detector health
 * endpoints work without AI since they're data-driven.
 */
export function createAiRoutes(db: Database) {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();

  // ─── GET /issues/:id/investigation ──────────────────────────────────
  // Trigger or return cached AI investigation for a specific issue.
  // If the investigation hasn't been generated yet, enqueues it via BullMQ
  // and returns a 202 with a polling hint.

  app.get('/issues/:id/investigation', async (c) => {
    const { orgId } = c.get('auth');
    const issueId = c.req.param('id');

    if (!isAiEnabled()) {
      return c.json({ available: false, message: AI_UNAVAILABLE_MSG }, 200);
    }

    // Check if the issue exists
    const [issue] = await db
      .select()
      .from(issues)
      .where(and(eq(issues.orgId, orgId), eq(issues.id, issueId)))
      .limit(1);

    if (!issue) {
      return c.json({ error: 'Issue not found' }, 404);
    }

    // Check for cached investigation
    const evidence = (issue.evidence || {}) as Record<string, unknown>;
    const cached = evidence.aiInvestigation as Investigation | undefined;

    if (cached?.generatedAt) {
      const generatedAt = new Date(cached.generatedAt);
      const hoursSinceGenerated = (Date.now() - generatedAt.getTime()) / (1000 * 60 * 60);
      const issueUpdatedAfter = issue.updatedAt > generatedAt;

      if (hoursSinceGenerated < 24 && !issueUpdatedAfter) {
        return c.json({
          available: true,
          investigation: cached,
          cached: true,
        });
      }
    }

    // No cached result — try synchronous first (for fast responses on simple issues)
    // If the issue is simple and we get a quick response, return it directly.
    // Otherwise, enqueue and return 202.
    const forceAsync = c.req.query('async') === 'true';

    if (!forceAsync) {
      try {
        const investigation = await investigateIssue(db, orgId, issueId);
        if (investigation) {
          return c.json({
            available: true,
            investigation,
            cached: false,
          });
        }
      } catch (err) {
        log.error({ err, issueId }, 'Synchronous investigation failed, falling back to async');
      }
    }

    // Fall back to async processing
    const jobId = await enqueueInvestigation(orgId, issueId);
    return c.json(
      {
        available: true,
        status: 'processing',
        message: 'AI investigation is being generated. Poll this endpoint to get results.',
        jobId,
      },
      202,
    );
  });

  // ─── GET /insights ─────────────────────────────────────────────────
  // Returns AI-generated insights for billing health.

  app.get('/insights', async (c) => {
    const { orgId } = c.get('auth');
    const period = (c.req.query('period') as 'daily' | 'weekly') || 'daily';

    if (!['daily', 'weekly'].includes(period)) {
      return c.json({ error: 'Invalid period. Use "daily" or "weekly".' }, 400);
    }

    try {
      const report = await generateInsights(db, orgId, period);
      return c.json({
        ...report,
        aiEnabled: isAiEnabled(),
      });
    } catch (err) {
      log.error({ err }, 'Failed to generate insights');
      return c.json({ error: 'Failed to generate insights' }, 500);
    }
  });

  // ─── GET /issues/incidents ─────────────────────────────────────────
  // Returns grouped incident clusters from open issues.

  app.get('/issues/incidents', async (c) => {
    const { orgId } = c.get('auth');
    const windowHours = parseInt(c.req.query('window') || '4');
    const minSize = parseInt(c.req.query('min_size') || '3');

    try {
      const clusters = await findIncidentClusters(db, orgId, {
        windowHours: Math.min(windowHours, 48),
        minClusterSize: Math.max(minSize, 2),
      });

      return c.json({
        incidents: clusters,
        count: clusters.length,
        aiEnabled: isAiEnabled(),
      });
    } catch (err) {
      log.error({ err }, 'Failed to find incident clusters');
      return c.json({ error: 'Failed to generate incident clusters' }, 500);
    }
  });

  // ─── POST /issues/:id/feedback ─────────────────────────────────────
  // Submit resolution feedback (was this a real issue? what was the actual cause?)

  app.post('/issues/:id/feedback', async (c) => {
    const { orgId } = c.get('auth');
    const issueId = c.req.param('id');

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    if (typeof body.wasRealIssue !== 'boolean') {
      return c.json({ error: 'wasRealIssue (boolean) is required' }, 400);
    }

    try {
      await recordFeedback(db, orgId, issueId, {
        wasRealIssue: body.wasRealIssue,
        actualCause: body.actualCause,
        notes: body.notes,
      });

      return c.json({ ok: true, status: body.wasRealIssue ? 'resolved' : 'dismissed' });
    } catch (err: any) {
      if (err.message === 'Issue not found') {
        return c.json({ error: 'Issue not found' }, 404);
      }
      log.error({ err, issueId }, 'Failed to record feedback');
      return c.json({ error: 'Failed to record feedback' }, 500);
    }
  });

  // ─── GET /detectors/health ─────────────────────────────────────────
  // Detector accuracy metrics from the learning system.

  app.get('/detectors/health', async (c) => {
    const { orgId } = c.get('auth');

    try {
      const metrics = await getDetectorHealthMetrics(db, orgId);
      return c.json(metrics);
    } catch (err) {
      log.error({ err }, 'Failed to get detector health metrics');
      return c.json({ error: 'Failed to get detector health metrics' }, 500);
    }
  });

  // ─── GET /ai/status ────────────────────────────────────────────────
  // Returns the current AI system status and token usage.

  app.get('/ai/status', async (c) => {
    const usage = getTokenUsage();
    return c.json({
      enabled: isAiEnabled(),
      tokenUsage: usage,
      model: isAiEnabled() ? process.env.AI_MODEL || 'claude-sonnet-4-5-20250929' : null,
    });
  });

  return app;
}
