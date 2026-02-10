import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc, sql, gt } from 'drizzle-orm';
import type { Database } from '../config/database.js';
import type { AuthContext } from '../middleware/auth.js';
import { accessChecks, products } from '../models/schema.js';
import { IdentityResolver } from '../identity/resolver.js';
import { createChildLogger } from '../config/logger.js';
import { requireScope } from '../middleware/require-scope.js';

const log = createChildLogger('access-checks');

const accessCheckSchema = z.object({
  user: z.string().min(1, 'user is required'),
  productId: z.string().optional(),
  hasAccess: z.boolean(),
  checkedAt: z.string().datetime().optional(),
});

const batchSchema = z.array(accessCheckSchema).max(100, 'Maximum 100 checks per batch');

export function createAccessCheckRoutes(db: Database) {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();
  const resolver = new IdentityResolver(db);

  // POST / — Report a single access check
  app.post('/', requireScope('access-checks:write'), async (c) => {
    const { orgId } = c.get('auth');
    const body = await c.req.json();
    const parsed = accessCheckSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const { user, productId, hasAccess, checkedAt } = parsed.data;

    // Resolve user identity
    const userId = await resolver.resolveByExternalId(orgId, user);

    // Resolve product if not provided
    let resolvedProductId: string | null = productId || null;
    if (!resolvedProductId) {
      const orgProducts = await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.orgId, orgId), eq(products.isActive, true)))
        .limit(2);

      if (orgProducts.length === 1) {
        resolvedProductId = orgProducts[0].id;
      } else if (orgProducts.length > 1) {
        return c.json({ error: 'productId is required when org has multiple products' }, 400);
      }
    }

    const [check] = await db.insert(accessChecks).values({
      orgId,
      userId,
      productId: resolvedProductId,
      externalUserId: user,
      hasAccess,
      reportedAt: checkedAt ? new Date(checkedAt) : new Date(),
    }).returning({ id: accessChecks.id });

    log.info({ orgId, externalUserId: user, hasAccess, resolved: !!userId }, 'Access check recorded');

    return c.json({ ok: true, accessCheckId: check.id });
  });

  // POST /test — Validate payload without storing
  app.post('/test', requireScope('access-checks:write'), async (c) => {
    const { orgId } = c.get('auth');
    const body = await c.req.json();
    const parsed = accessCheckSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ ok: false, error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const { user } = parsed.data;
    const userId = await resolver.resolveByExternalId(orgId, user);

    return c.json({
      ok: true,
      parsed: parsed.data,
      userResolved: !!userId,
      resolvedUserId: userId,
    });
  });

  // POST /batch — Array of up to 100 checks
  app.post('/batch', requireScope('access-checks:write'), async (c) => {
    const { orgId } = c.get('auth');
    const body = await c.req.json();
    const parsed = batchSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const results: Array<{ ok: boolean; accessCheckId?: string; error?: string }> = [];

    for (const item of parsed.data) {
      try {
        const userId = await resolver.resolveByExternalId(orgId, item.user);

        let resolvedProductId: string | null = item.productId || null;
        if (!resolvedProductId) {
          const orgProducts = await db
            .select({ id: products.id })
            .from(products)
            .where(and(eq(products.orgId, orgId), eq(products.isActive, true)))
            .limit(2);

          if (orgProducts.length === 1) {
            resolvedProductId = orgProducts[0].id;
          }
        }

        const [check] = await db.insert(accessChecks).values({
          orgId,
          userId,
          productId: resolvedProductId,
          externalUserId: item.user,
          hasAccess: item.hasAccess,
          reportedAt: item.checkedAt ? new Date(item.checkedAt) : new Date(),
        }).returning({ id: accessChecks.id });

        results.push({ ok: true, accessCheckId: check.id });
      } catch (err: any) {
        results.push({ ok: false, error: err.message });
      }
    }

    log.info({ orgId, total: parsed.data.length, succeeded: results.filter(r => r.ok).length }, 'Batch access checks recorded');

    return c.json({ ok: true, results });
  });

  // GET / — List recent access checks
  app.get('/', requireScope('access-checks:read'), async (c) => {
    const { orgId } = c.get('auth');
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);

    const checks = await db
      .select()
      .from(accessChecks)
      .where(eq(accessChecks.orgId, orgId))
      .orderBy(desc(accessChecks.reportedAt))
      .limit(limit);

    return c.json({ accessChecks: checks });
  });

  // GET /stats — Access check statistics for the org
  app.get('/stats', requireScope('access-checks:read'), async (c) => {
    const { orgId } = c.get('auth');
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [totalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(accessChecks)
      .where(eq(accessChecks.orgId, orgId));

    const [todayResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(accessChecks)
      .where(and(eq(accessChecks.orgId, orgId), gt(accessChecks.reportedAt, oneDayAgo)));

    return c.json({
      accessChecksReceived: Number(totalResult?.count || 0),
      accessChecksToday: Number(todayResult?.count || 0),
    });
  });

  return app;
}
