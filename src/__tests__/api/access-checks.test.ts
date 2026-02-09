import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createAccessCheckRoutes } from '../../api/access-checks.js';
import { resetUuidCounter } from '../helpers.js';

// Mock the logger
vi.mock('../../config/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock the identity resolver
const mockResolveByExternalId = vi.fn().mockResolvedValue('resolved-user-id');
vi.mock('../../identity/resolver.js', () => ({
  IdentityResolver: class {
    resolveByExternalId = mockResolveByExternalId;
  },
}));

describe('Access Checks API', () => {
  const orgId = 'org_ac_api_test';
  let app: Hono;
  let mockDb: any;

  beforeEach(() => {
    resetUuidCounter();
    mockResolveByExternalId.mockResolvedValue('resolved-user-id');
    mockDb = createAccessCheckMockDb();

    app = new Hono();
    app.use('*', async (c, next) => {
      c.set('orgId' as any, orgId);
      c.set('auth' as any, { orgId, orgSlug: 'test-org', apiKeyId: 'key_test' });
      await next();
    });
    app.route('/access-checks', createAccessCheckRoutes(mockDb));
  });

  describe('POST /access-checks', () => {
    it('should accept a valid access check', async () => {
      mockDb._configureInsertResult([{ id: 'check-123' }]);
      // Product query returns single product
      mockDb._configureSelectResult([{ id: 'prod-1' }]);

      const res = await app.request('/access-checks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: 'cus_abc123',
          hasAccess: true,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.accessCheckId).toBeTruthy();
    });

    it('should reject missing user field', async () => {
      const res = await app.request('/access-checks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hasAccess: true,
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject missing hasAccess field', async () => {
      const res = await app.request('/access-checks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: 'cus_abc123',
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /access-checks/test', () => {
    it('should validate payload without storing', async () => {
      const res = await app.request('/access-checks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: 'test-user-123',
          hasAccess: true,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.parsed).toBeDefined();
      expect(body.userResolved).toBe(true);
    });

    it('should return validation errors for invalid payload', async () => {
      const res = await app.request('/access-checks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hasAccess: 'not-a-boolean',
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.ok).toBe(false);
    });
  });

  describe('POST /access-checks/batch', () => {
    it('should accept a batch of access checks', async () => {
      mockDb._configureInsertResult([{ id: 'check-1' }]);
      mockDb._configureSelectResult([{ id: 'prod-1' }]);

      const res = await app.request('/access-checks/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { user: 'user-1', hasAccess: true },
          { user: 'user-2', hasAccess: false },
        ]),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.results).toHaveLength(2);
    });

    it('should reject batch larger than 100', async () => {
      const batch = Array.from({ length: 101 }, (_, i) => ({
        user: `user-${i}`,
        hasAccess: true,
      }));

      const res = await app.request('/access-checks/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /access-checks', () => {
    it('should return recent access checks', async () => {
      const checks = [
        { id: 'check-1', orgId, hasAccess: true, reportedAt: new Date().toISOString() },
      ];
      mockDb._configureSelectResult(checks);

      const res = await app.request('/access-checks');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.accessChecks).toBeDefined();
    });
  });
});

function createAccessCheckMockDb() {
  let selectResult: any[] = [];
  let insertResult: any[] = [{ id: 'mock-check-id' }];

  const chainable: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => Promise.resolve(selectResult)),
    returning: vi.fn().mockImplementation(() => Promise.resolve(insertResult)),
    orderBy: vi.fn().mockReturnThis(),

    _configureSelectResult(data: any[]) {
      selectResult = data;
    },
    _configureInsertResult(data: any[]) {
      insertResult = data;
    },
  };

  return chainable;
}
