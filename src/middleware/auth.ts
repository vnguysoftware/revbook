import { createMiddleware } from 'hono/factory';
import { eq } from 'drizzle-orm';
import { createHash } from 'crypto';
import type { Database } from '../config/database.js';
import { apiKeys, organizations } from '../models/schema.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('auth');

export type AuthContext = {
  orgId: string;
  orgSlug: string;
  apiKeyId: string;
  scopes: string[];
};

/**
 * API Key authentication middleware.
 *
 * API keys are passed via the Authorization header:
 *   Authorization: Bearer rev_xxxx...
 *
 * Keys are stored as SHA-256 hashes. The first 8 chars are stored
 * as a prefix for lookup performance.
 */
export function createAuthMiddleware(db: Database) {
  return createMiddleware<{ Variables: { auth: AuthContext } }>(async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid Authorization header' }, 401);
    }

    const apiKey = authHeader.slice(7);
    if (!apiKey.startsWith('rev_')) {
      return c.json({ error: 'Invalid API key format' }, 401);
    }

    const keyHash = hashApiKey(apiKey);
    const keyPrefix = apiKey.slice(0, 8);

    const [found] = await db
      .select({
        keyId: apiKeys.id,
        orgId: apiKeys.orgId,
        expiresAt: apiKeys.expiresAt,
        scopes: apiKeys.scopes,
      })
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, keyHash))
      .limit(1);

    if (!found) {
      return c.json({ error: 'Invalid API key' }, 401);
    }

    if (found.expiresAt && found.expiresAt < new Date()) {
      return c.json({ error: 'API key expired' }, 401);
    }

    // Get org details
    const [org] = await db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, found.orgId))
      .limit(1);

    if (!org) {
      return c.json({ error: 'Organization not found' }, 401);
    }

    // Update last used timestamp (fire and forget)
    db.update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, found.keyId))
      .catch(() => {}); // don't block request

    c.set('auth', {
      orgId: found.orgId,
      orgSlug: org.slug,
      apiKeyId: found.keyId,
      scopes: (found.scopes as string[]) || [],
    });

    await next();
  });
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
