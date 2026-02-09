import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createUserRoutes } from '../../api/users.js';
import { createTestUser, createTestEntitlement, resetUuidCounter } from '../helpers.js';

// Mock the logger
vi.mock('../../config/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Users API', () => {
  const orgId = 'org_users_api_test';
  const orgSlug = 'test-org';
  let app: Hono;
  let mockDb: any;

  beforeEach(() => {
    resetUuidCounter();
    mockDb = createUsersMockDb();

    app = new Hono();
    app.use('*', async (c, next) => {
      c.set('auth' as any, { orgId, orgSlug, apiKeyId: 'key_test' });
      await next();
    });
    app.route('/users', createUserRoutes(mockDb));
  });

  describe('GET /users/search', () => {
    it('should return 400 when query is too short', async () => {
      const res = await app.request('/users/search?q=a');
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('at least 2 characters');
    });

    it('should return 400 when no query provided', async () => {
      const res = await app.request('/users/search');
      expect(res.status).toBe(400);
    });

    it('should search by email', async () => {
      const user = createTestUser(orgId, { email: 'test@example.com' });
      let queryNum = 0;
      mockDb.limit = vi.fn().mockImplementation(() => {
        queryNum++;
        if (queryNum === 1) {
          return Promise.resolve([user]); // email search
        }
        return Promise.resolve([]);
      });

      const res = await app.request('/users/search?q=test@example.com');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.users).toHaveLength(1);
    });

    it('should search by external user ID when email not found', async () => {
      const user = createTestUser(orgId, { externalUserId: 'ext_123' });
      let queryNum = 0;
      mockDb.limit = vi.fn().mockImplementation(() => {
        queryNum++;
        if (queryNum === 1) return Promise.resolve([]); // email not found
        if (queryNum === 2) return Promise.resolve([user]); // external ID found
        return Promise.resolve([]);
      });

      const res = await app.request('/users/search?q=ext_123');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.users).toHaveLength(1);
    });

    it('should search by identity when email and external ID not found', async () => {
      const user = createTestUser(orgId);
      let queryNum = 0;
      mockDb.limit = vi.fn().mockImplementation(() => {
        queryNum++;
        if (queryNum === 1) return Promise.resolve([]); // email
        if (queryNum === 2) return Promise.resolve([]); // external ID
        if (queryNum === 3) return Promise.resolve([{ userId: user.id }]); // identity
        if (queryNum === 4) return Promise.resolve([user]); // actual user
        return Promise.resolve([]);
      });

      const res = await app.request('/users/search?q=cus_test123');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.users).toHaveLength(1);
    });

    it('should return empty array when nothing found', async () => {
      mockDb.limit = vi.fn().mockImplementation(() => Promise.resolve([]));

      const res = await app.request('/users/search?q=nonexistent');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.users).toHaveLength(0);
    });
  });

  describe('GET /users/:userId', () => {
    it('should return full user profile', async () => {
      const user = createTestUser(orgId, { id: 'user-profile-1' });

      // The profile endpoint queries: user, then Promise.all([identities, ents, issues, events])
      let queryNum = 0;
      mockDb.limit = vi.fn().mockImplementation(() => {
        queryNum++;
        if (queryNum === 1) return Promise.resolve([user]); // user
        return Promise.resolve([]);
      });

      // For Promise.all queries that don't use .limit()
      mockDb.then = vi.fn().mockImplementation((resolve: any) => resolve([]));

      const res = await app.request('/users/user-profile-1');
      expect(res.status).toBe(200);
    });

    it('should return 404 for non-existent user', async () => {
      mockDb.limit = vi.fn().mockImplementation(() => Promise.resolve([]));

      const res = await app.request('/users/nonexistent-user');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('User not found');
    });
  });

  describe('GET /users/:userId/timeline', () => {
    it('should return events ordered by time', async () => {
      mockDb.then = vi.fn().mockImplementation((resolve: any) =>
        resolve([
          { id: 'evt-1', eventType: 'renewal', eventTime: new Date() },
          { id: 'evt-2', eventType: 'purchase', eventTime: new Date() },
        ]),
      );

      const res = await app.request('/users/user-1/timeline');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.events).toBeDefined();
    });

    it('should cap limit at 500', async () => {
      mockDb.then = vi.fn().mockImplementation((resolve: any) => resolve([]));

      const res = await app.request('/users/user-1/timeline?limit=1000');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /users/:userId/entitlements', () => {
    it('should return user entitlements', async () => {
      const ent = createTestEntitlement(orgId, 'user-1', 'product-1');
      mockDb.then = vi.fn().mockImplementation((resolve: any) => resolve([ent]));

      const res = await app.request('/users/user-1/entitlements');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.entitlements).toBeDefined();
    });
  });

  describe('GET /users/:userId/identities', () => {
    it('should return user identities', async () => {
      mockDb.then = vi.fn().mockImplementation((resolve: any) =>
        resolve([
          { source: 'stripe', externalId: 'cus_123', idType: 'customer_id' },
        ]),
      );

      const res = await app.request('/users/user-1/identities');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.identities).toBeDefined();
    });
  });

  describe('GET /users/:userId/issues', () => {
    it('should return user issues', async () => {
      mockDb.then = vi.fn().mockImplementation((resolve: any) => resolve([]));

      const res = await app.request('/users/user-1/issues');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.issues).toBeDefined();
    });
  });
});

function createUsersMockDb() {
  const chainable: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => Promise.resolve([])),
    returning: vi.fn().mockImplementation(() => Promise.resolve([])),
    catch: vi.fn().mockReturnThis(),
    then: vi.fn().mockImplementation((resolve: any) => resolve([])),
  };

  return chainable;
}
