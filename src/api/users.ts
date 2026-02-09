import { Hono } from 'hono';
import { eq, and, desc, count, sql } from 'drizzle-orm';
import type { Database } from '../config/database.js';
import { users, userIdentities, canonicalEvents, entitlements, issues } from '../models/schema.js';
import type { AuthContext } from '../middleware/auth.js';

/**
 * User API — the "user timeline" view.
 *
 * This is the second most important view after the issue feed.
 * It answers: "What happened with this specific user across all
 * billing systems?"
 */
export function createUserRoutes(db: Database) {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();

  // ─── List Users (paginated, with optional search) ──────────────────

  app.get('/', async (c) => {
    const { orgId } = c.get('auth');
    const limit = Math.min(parseInt(c.req.query('limit') || '25'), 100);
    const offset = parseInt(c.req.query('offset') || '0') || 0;
    const search = c.req.query('search');

    const conditions = [eq(users.orgId, orgId)];
    if (search && search.length >= 2) {
      conditions.push(
        sql`(${users.email} ILIKE ${'%' + search + '%'} OR ${users.externalUserId} ILIKE ${'%' + search + '%'})`,
      );
    }

    const [total] = await db
      .select({ count: count() })
      .from(users)
      .where(and(...conditions));

    const results = await db
      .select({
        id: users.id,
        email: users.email,
        externalUserId: users.externalUserId,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(and(...conditions))
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);

    return c.json({
      users: results,
      pagination: { limit, offset, count: total.count },
    });
  });

  // ─── Search Users ───────────────────────────────────────────────────

  app.get('/search', async (c) => {
    const { orgId } = c.get('auth');
    const query = c.req.query('q');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 50);

    if (!query || query.length < 2) {
      return c.json({ error: 'Search query must be at least 2 characters' }, 400);
    }

    // Search by email, external user ID, or any identity
    const byEmail = await db
      .select()
      .from(users)
      .where(and(eq(users.orgId, orgId), eq(users.email, query)))
      .limit(limit);

    if (byEmail.length > 0) {
      return c.json({ users: byEmail });
    }

    const byExternalId = await db
      .select()
      .from(users)
      .where(and(eq(users.orgId, orgId), eq(users.externalUserId, query)))
      .limit(limit);

    if (byExternalId.length > 0) {
      return c.json({ users: byExternalId });
    }

    // Search identities (Stripe customer_id, Apple original_transaction_id, etc.)
    const byIdentity = await db
      .select({ userId: userIdentities.userId })
      .from(userIdentities)
      .where(and(eq(userIdentities.orgId, orgId), eq(userIdentities.externalId, query)))
      .limit(limit);

    if (byIdentity.length > 0) {
      const userIds = byIdentity.map(i => i.userId);
      const foundUsers = await db
        .select()
        .from(users)
        .where(and(eq(users.orgId, orgId), eq(users.id, userIds[0])))
        .limit(limit);
      return c.json({ users: foundUsers });
    }

    return c.json({ users: [] });
  });

  // ─── User Timeline (all events, all systems) ───────────────────────

  app.get('/:userId/timeline', async (c) => {
    const { orgId } = c.get('auth');
    const userId = c.req.param('userId');
    const limit = Math.min(parseInt(c.req.query('limit') || '100'), 500);

    // Get all events for this user, newest first
    const events = await db
      .select()
      .from(canonicalEvents)
      .where(
        and(eq(canonicalEvents.orgId, orgId), eq(canonicalEvents.userId, userId)),
      )
      .orderBy(desc(canonicalEvents.eventTime))
      .limit(limit);

    return c.json({ events });
  });

  // ─── User Entitlements ──────────────────────────────────────────────

  app.get('/:userId/entitlements', async (c) => {
    const { orgId } = c.get('auth');
    const userId = c.req.param('userId');

    const ents = await db
      .select()
      .from(entitlements)
      .where(
        and(eq(entitlements.orgId, orgId), eq(entitlements.userId, userId)),
      );

    return c.json({ entitlements: ents });
  });

  // ─── User Identities ───────────────────────────────────────────────

  app.get('/:userId/identities', async (c) => {
    const { orgId } = c.get('auth');
    const userId = c.req.param('userId');

    const identities = await db
      .select()
      .from(userIdentities)
      .where(
        and(eq(userIdentities.orgId, orgId), eq(userIdentities.userId, userId)),
      );

    return c.json({ identities });
  });

  // ─── User Issues ────────────────────────────────────────────────────

  app.get('/:userId/issues', async (c) => {
    const { orgId } = c.get('auth');
    const userId = c.req.param('userId');

    const userIssues = await db
      .select()
      .from(issues)
      .where(
        and(eq(issues.orgId, orgId), eq(issues.userId, userId)),
      )
      .orderBy(desc(issues.createdAt));

    return c.json({ issues: userIssues });
  });

  // ─── Full User Profile (combined view for dashboard) ────────────────

  app.get('/:userId', async (c) => {
    const { orgId } = c.get('auth');
    const userId = c.req.param('userId');

    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.orgId, orgId), eq(users.id, userId)))
      .limit(1);

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    const [identities, ents, userIssues, recentEvents] = await Promise.all([
      db
        .select()
        .from(userIdentities)
        .where(eq(userIdentities.userId, userId)),
      db
        .select()
        .from(entitlements)
        .where(and(eq(entitlements.orgId, orgId), eq(entitlements.userId, userId))),
      db
        .select()
        .from(issues)
        .where(and(eq(issues.orgId, orgId), eq(issues.userId, userId), eq(issues.status, 'open')))
        .orderBy(desc(issues.createdAt))
        .limit(10),
      db
        .select()
        .from(canonicalEvents)
        .where(and(eq(canonicalEvents.orgId, orgId), eq(canonicalEvents.userId, userId)))
        .orderBy(desc(canonicalEvents.eventTime))
        .limit(20),
    ]);

    return c.json({
      user,
      identities,
      entitlements: ents,
      openIssues: userIssues,
      recentEvents,
    });
  });

  return app;
}
