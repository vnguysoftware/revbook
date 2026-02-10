import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../config/database.js';
import {
  users,
  userIdentities,
  canonicalEvents,
  entitlements,
  issues,
  accessChecks,
} from '../models/schema.js';
import type { AuthContext } from '../middleware/auth.js';
import { requireScope } from '../middleware/require-scope.js';
import { auditLog } from '../security/audit.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('data-management');

/**
 * Data Management API — GDPR right-to-delete and data portability.
 *
 * Routes (mounted under /api/v1/data-management):
 *   DELETE /users/:userId/data   - Delete all data for a user (right to erasure)
 *   GET    /users/:userId/data-export - Export all data for a user (right to portability)
 */
export function createDataManagementRoutes(db: Database) {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();

  // ─── DELETE /users/:userId/data — Right to erasure ─────────────────

  app.delete('/users/:userId/data', requireScope('admin:write'), async (c) => {
    const { orgId } = c.get('auth');
    const userId = c.req.param('userId');

    // Verify the user exists and belongs to this org
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.orgId, orgId)))
      .limit(1);

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Audit the deletion BEFORE deleting (so the audit record exists)
    auditLog(db, c.get('auth'), 'user.data_deleted', 'user', userId, {
      reason: 'GDPR right-to-delete request',
    });

    // Delete in dependency order within a transaction
    const result = await db.transaction(async (tx) => {
      // 1. Delete access checks
      const deletedAccessChecks = await tx
        .delete(accessChecks)
        .where(and(eq(accessChecks.userId, userId), eq(accessChecks.orgId, orgId)))
        .returning({ id: accessChecks.id });

      // 2. Delete issues linked to this user
      const deletedIssues = await tx
        .delete(issues)
        .where(and(eq(issues.userId, userId), eq(issues.orgId, orgId)))
        .returning({ id: issues.id });

      // 3. Delete entitlements
      const deletedEntitlements = await tx
        .delete(entitlements)
        .where(and(eq(entitlements.userId, userId), eq(entitlements.orgId, orgId)))
        .returning({ id: entitlements.id });

      // 4. Delete canonical events
      const deletedEvents = await tx
        .delete(canonicalEvents)
        .where(and(eq(canonicalEvents.userId, userId), eq(canonicalEvents.orgId, orgId)))
        .returning({ id: canonicalEvents.id });

      // 5. Delete user identities
      const deletedIdentities = await tx
        .delete(userIdentities)
        .where(and(eq(userIdentities.userId, userId), eq(userIdentities.orgId, orgId)))
        .returning({ id: userIdentities.id });

      // 6. Delete the user record itself
      await tx
        .delete(users)
        .where(and(eq(users.id, userId), eq(users.orgId, orgId)));

      return {
        accessChecksDeleted: deletedAccessChecks.length,
        issuesDeleted: deletedIssues.length,
        entitlementsDeleted: deletedEntitlements.length,
        eventsDeleted: deletedEvents.length,
        identitiesDeleted: deletedIdentities.length,
        userDeleted: true,
      };
    });

    log.info({ orgId, userId, ...result }, 'User data deleted (GDPR right-to-delete)');

    return c.json({
      ok: true,
      userId,
      deleted: result,
      message: 'All user data has been permanently deleted.',
    });
  });

  // ─── GET /users/:userId/data-export — Right to portability ─────────

  app.get('/users/:userId/data-export', requireScope('admin:read'), async (c) => {
    const { orgId } = c.get('auth');
    const userId = c.req.param('userId');

    // Verify the user exists and belongs to this org
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.orgId, orgId)))
      .limit(1);

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Gather all data in parallel
    const [identities, events, userEntitlements, userIssues, userAccessChecks] = await Promise.all([
      db
        .select()
        .from(userIdentities)
        .where(and(eq(userIdentities.userId, userId), eq(userIdentities.orgId, orgId))),
      db
        .select()
        .from(canonicalEvents)
        .where(and(eq(canonicalEvents.userId, userId), eq(canonicalEvents.orgId, orgId))),
      db
        .select()
        .from(entitlements)
        .where(and(eq(entitlements.userId, userId), eq(entitlements.orgId, orgId))),
      db
        .select()
        .from(issues)
        .where(and(eq(issues.userId, userId), eq(issues.orgId, orgId))),
      db
        .select()
        .from(accessChecks)
        .where(and(eq(accessChecks.userId, userId), eq(accessChecks.orgId, orgId))),
    ]);

    auditLog(db, c.get('auth'), 'user.data_exported', 'user', userId);

    return c.json({
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        externalUserId: user.externalUserId,
        email: user.email,
        metadata: user.metadata,
        createdAt: user.createdAt,
      },
      identities: identities.map((i) => ({
        source: i.source,
        externalId: i.externalId,
        idType: i.idType,
        createdAt: i.createdAt,
      })),
      events: events.map((e) => ({
        id: e.id,
        source: e.source,
        eventType: e.eventType,
        eventTime: e.eventTime,
        status: e.status,
        amountCents: e.amountCents,
        currency: e.currency,
        createdAt: e.createdAt,
      })),
      entitlements: userEntitlements.map((e) => ({
        id: e.id,
        productId: e.productId,
        source: e.source,
        state: e.state,
        currentPeriodStart: e.currentPeriodStart,
        currentPeriodEnd: e.currentPeriodEnd,
        createdAt: e.createdAt,
      })),
      issues: userIssues.map((i) => ({
        id: i.id,
        issueType: i.issueType,
        severity: i.severity,
        status: i.status,
        title: i.title,
        description: i.description,
        createdAt: i.createdAt,
        resolvedAt: i.resolvedAt,
      })),
      accessChecks: userAccessChecks.map((a) => ({
        id: a.id,
        externalUserId: a.externalUserId,
        hasAccess: a.hasAccess,
        reportedAt: a.reportedAt,
      })),
    });
  });

  return app;
}
