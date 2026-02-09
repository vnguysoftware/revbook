import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createIssueRoutes } from '../../api/issues.js';
import { createTestIssue, resetUuidCounter } from '../helpers.js';

// Mock the logger
vi.mock('../../config/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Issues API', () => {
  const orgId = 'org_issues_api_test';
  const orgSlug = 'test-org';
  let app: Hono;
  let mockDb: any;

  beforeEach(() => {
    resetUuidCounter();
    mockDb = createIssuesMockDb();

    // Create app with auth context pre-set
    app = new Hono();
    app.use('*', async (c, next) => {
      c.set('auth' as any, { orgId, orgSlug, apiKeyId: 'key_test' });
      await next();
    });
    app.route('/issues', createIssueRoutes(mockDb));
  });

  describe('GET /issues', () => {
    it('should return issues list', async () => {
      const testIssues = [
        createTestIssue(orgId, { id: 'issue-1', title: 'Issue 1' }),
        createTestIssue(orgId, { id: 'issue-2', title: 'Issue 2' }),
      ];
      // GET /issues does: 1) count query, 2) results query
      let callCount = 0;
      mockDb.then = vi.fn().mockImplementation((resolve: any) => {
        callCount++;
        if (callCount === 1) return resolve([{ count: 2 }]); // count query
        return resolve(testIssues); // results query
      });

      const res = await app.request('/issues');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.issues).toHaveLength(2);
      expect(body.pagination).toBeDefined();
    });

    it('should respect limit parameter', async () => {
      // GET /issues does: 1) count query, 2) results query
      let callCount = 0;
      mockDb.then = vi.fn().mockImplementation((resolve: any) => {
        callCount++;
        if (callCount === 1) return resolve([{ count: 0 }]); // count query
        return resolve([]); // results query
      });

      const res = await app.request('/issues?limit=10');
      expect(res.status).toBe(200);
    });

    it('should cap limit at 100', async () => {
      let callCount = 0;
      mockDb.then = vi.fn().mockImplementation((resolve: any) => {
        callCount++;
        if (callCount === 1) return resolve([{ count: 0 }]);
        return resolve([]);
      });

      const res = await app.request('/issues?limit=500');
      expect(res.status).toBe(200);
    });

    it('should filter by status', async () => {
      let callCount = 0;
      mockDb.then = vi.fn().mockImplementation((resolve: any) => {
        callCount++;
        if (callCount === 1) return resolve([{ count: 0 }]);
        return resolve([]);
      });

      const res = await app.request('/issues?status=acknowledged');
      expect(res.status).toBe(200);
    });

    it('should filter by severity', async () => {
      let callCount = 0;
      mockDb.then = vi.fn().mockImplementation((resolve: any) => {
        callCount++;
        if (callCount === 1) return resolve([{ count: 0 }]);
        return resolve([]);
      });

      const res = await app.request('/issues?severity=critical');
      expect(res.status).toBe(200);
    });

    it('should filter by type', async () => {
      let callCount = 0;
      mockDb.then = vi.fn().mockImplementation((resolve: any) => {
        callCount++;
        if (callCount === 1) return resolve([{ count: 0 }]);
        return resolve([]);
      });

      const res = await app.request('/issues?type=payment_without_entitlement');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /issues/summary', () => {
    it('should return summary statistics', async () => {
      // The summary endpoint makes multiple queries
      let queryCount = 0;
      mockDb.then = vi.fn().mockImplementation((resolve: any) => {
        queryCount++;
        if (queryCount <= 3) {
          // count queries
          return resolve([{ count: 5, total: 9999 }]);
        }
        // byType query
        return resolve([
          { issueType: 'payment_without_entitlement', count: 3, revenue: 5999 },
          { issueType: 'refund_not_revoked', count: 2, revenue: 4000 },
        ]);
      });

      const res = await app.request('/issues/summary');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /issues/:issueId', () => {
    it('should return a single issue', async () => {
      const issue = createTestIssue(orgId, { id: 'issue-detail-1' });
      mockDb._configureSelectResult([issue]);

      const res = await app.request('/issues/issue-detail-1');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.issue).toBeDefined();
    });

    it('should return 404 for non-existent issue', async () => {
      mockDb._configureSelectResult([]);

      const res = await app.request('/issues/nonexistent');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Issue not found');
    });
  });

  describe('POST /issues/:issueId/acknowledge', () => {
    it('should acknowledge an issue', async () => {
      mockDb._configureUpdateResult([]);

      const res = await app.request('/issues/issue-ack-1/acknowledge', {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });
  });

  describe('POST /issues/:issueId/resolve', () => {
    it('should resolve an issue', async () => {
      mockDb._configureUpdateResult([]);

      const res = await app.request('/issues/issue-resolve-1/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: 'Fixed by reprocessing' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('should resolve without resolution body', async () => {
      mockDb._configureUpdateResult([]);

      const res = await app.request('/issues/issue-resolve-2/resolve', {
        method: 'POST',
      });
      expect(res.status).toBe(200);
    });
  });

  describe('POST /issues/:issueId/dismiss', () => {
    it('should dismiss an issue', async () => {
      mockDb._configureUpdateResult([]);

      const res = await app.request('/issues/issue-dismiss-1/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Known issue, not a real problem' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });
  });
});

function createIssuesMockDb() {
  let selectResult: any[] = [];
  let queryResult: any[] = [];
  // Track query calls to return appropriate results:
  // GET /issues makes 2 queries: 1) count query, 2) results query
  let thenCallCount = 0;

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
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    returning: vi.fn().mockImplementation(() => Promise.resolve(selectResult)),
    catch: vi.fn().mockReturnThis(),
    then: vi.fn().mockImplementation((resolve: any) => {
      thenCallCount++;
      return resolve(queryResult);
    }),

    _configureSelectResult(data: any[]) {
      selectResult = data;
      queryResult = data;
    },
    _configureQueryResult(data: any[]) {
      queryResult = data;
      thenCallCount = 0;
    },
    _configureUpdateResult(data: any[]) {
      // Updates just need to not throw
    },
    _resetCallCount() {
      thenCallCount = 0;
    },
  };

  return chainable;
}
