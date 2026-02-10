import { createMiddleware } from 'hono/factory';
import type { AuthContext } from './auth.js';
import { hasScope, type Scope } from '../security/scopes.js';

/**
 * Middleware factory that checks if the authenticated API key
 * has the required scope.
 *
 * Must be used AFTER auth middleware (requires auth context).
 *
 * Usage:
 *   app.get('/issues', requireScope('issues:read'), handler)
 *   app.post('/issues/:id/resolve', requireScope('issues:write'), handler)
 */
export function requireScope(required: Scope) {
  return createMiddleware<{ Variables: { auth: AuthContext } }>(async (c, next) => {
    const auth = c.get('auth');
    if (!auth) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const granted = auth.scopes || [];
    if (!hasScope(granted, required)) {
      return c.json({
        error: 'Insufficient permissions',
        requiredScope: required,
      }, 403);
    }

    await next();
  });
}
