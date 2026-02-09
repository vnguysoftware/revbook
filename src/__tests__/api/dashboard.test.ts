import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createDashboardRoutes } from '../../api/dashboard.js';
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

describe('Dashboard API', () => {
  const orgId = 'org_dashboard_api_test';
  const orgSlug = 'test-org';
  let app: Hono;
  let mockDb: any;

  beforeEach(() => {
    resetUuidCounter();
    mockDb = createDashboardMockDb();

    app = new Hono();
    app.use('*', async (c, next) => {
      c.set('auth' as any, { orgId, orgSlug, apiKeyId: 'key_test' });
      await next();
    });
    app.route('/dashboard', createDashboardRoutes(mockDb));
  });

  describe('GET /dashboard/revenue-impact', () => {
    it('should return revenue impact summary', async () => {
      let queryNum = 0;
      mockDb.then = vi.fn().mockImplementation((resolve: any) => {
        queryNum++;
        if (queryNum === 1) {
          // Open issues aggregate
          return resolve([{ totalRevenueCents: '5000', issueCount: 3 }]);
        }
        if (queryNum === 2) {
          // By severity
          return resolve([
            { severity: 'critical', totalRevenueCents: '3000', issueCount: 1 },
            { severity: 'warning', totalRevenueCents: '2000', issueCount: 2 },
          ]);
        }
        if (queryNum === 3) {
          // By type
          return resolve([
            { issueType: 'paid_no_access', totalRevenueCents: '3000', issueCount: 1 },
          ]);
        }
        if (queryNum === 4) {
          // Resolved
          return resolve([{ totalRevenueCents: '10000', issueCount: 5 }]);
        }
        return resolve([]);
      });

      const res = await app.request('/dashboard/revenue-impact');
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.atRisk).toBeDefined();
      expect(body.atRisk.totalCents).toBe(5000);
      expect(body.bySeverity).toBeDefined();
      expect(body.byType).toBeDefined();
      expect(body.saved).toBeDefined();
      expect(body.saved.totalCents).toBe(10000);
    });

    it('should handle zero revenue gracefully', async () => {
      mockDb.then = vi.fn().mockImplementation((resolve: any) =>
        resolve([{ totalRevenueCents: null, issueCount: 0 }]),
      );

      const res = await app.request('/dashboard/revenue-impact');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.atRisk.totalCents).toBe(0);
    });
  });

  describe('GET /dashboard/events', () => {
    it('should return event feed', async () => {
      mockDb.then = vi.fn().mockImplementation((resolve: any) =>
        resolve([
          {
            id: 'evt-1',
            source: 'stripe',
            eventType: 'renewal',
            eventTime: new Date(),
            status: 'success',
            amountCents: 1999,
          },
        ]),
      );

      const res = await app.request('/dashboard/events');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.events).toBeDefined();
    });

    it('should respect limit parameter', async () => {
      mockDb.then = vi.fn().mockImplementation((resolve: any) => resolve([]));

      const res = await app.request('/dashboard/events?limit=10');
      expect(res.status).toBe(200);
    });

    it('should cap limit at 200', async () => {
      mockDb.then = vi.fn().mockImplementation((resolve: any) => resolve([]));

      const res = await app.request('/dashboard/events?limit=500');
      expect(res.status).toBe(200);
    });

    it('should filter by source', async () => {
      mockDb.then = vi.fn().mockImplementation((resolve: any) => resolve([]));

      const res = await app.request('/dashboard/events?source=stripe');
      expect(res.status).toBe(200);
    });

    it('should filter by event type', async () => {
      mockDb.then = vi.fn().mockImplementation((resolve: any) => resolve([]));

      const res = await app.request('/dashboard/events?type=renewal');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /dashboard/entitlement-health', () => {
    it('should return entitlement health overview', async () => {
      let queryNum = 0;
      mockDb.then = vi.fn().mockImplementation((resolve: any) => {
        queryNum++;
        if (queryNum === 1) {
          // By state
          return resolve([
            { state: 'active', count: 100 },
            { state: 'expired', count: 50 },
            { state: 'trial', count: 20 },
          ]);
        }
        if (queryNum === 2) {
          // By source+state
          return resolve([
            { source: 'stripe', state: 'active', count: 60 },
            { source: 'apple', state: 'active', count: 40 },
          ]);
        }
        if (queryNum === 3) {
          // Total users
          return resolve([{ count: 150 }]);
        }
        return resolve([]);
      });

      const res = await app.request('/dashboard/entitlement-health');
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.totalUsers).toBeDefined();
      expect(body.byState).toBeDefined();
      expect(body.bySource).toBeDefined();
    });
  });

  describe('GET /dashboard/trends/issues', () => {
    it('should return issue trends', async () => {
      mockDb.then = vi.fn().mockImplementation((resolve: any) =>
        resolve([
          { date: '2025-01-01', severity: 'critical', count: 2, revenue: 1000 },
          { date: '2025-01-02', severity: 'warning', count: 5, revenue: 500 },
        ]),
      );

      const res = await app.request('/dashboard/trends/issues');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.trend).toBeDefined();
      expect(body.days).toBeDefined();
    });

    it('should accept days parameter', async () => {
      mockDb.then = vi.fn().mockImplementation((resolve: any) => resolve([]));

      const res = await app.request('/dashboard/trends/issues?days=7');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.days).toBe(7);
    });

    it('should cap days at 90', async () => {
      mockDb.then = vi.fn().mockImplementation((resolve: any) => resolve([]));

      const res = await app.request('/dashboard/trends/issues?days=365');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.days).toBe(90);
    });
  });

  describe('GET /dashboard/trends/events', () => {
    it('should return event trends', async () => {
      mockDb.then = vi.fn().mockImplementation((resolve: any) =>
        resolve([
          { date: '2025-01-01', source: 'stripe', count: 50 },
          { date: '2025-01-01', source: 'apple', count: 30 },
        ]),
      );

      const res = await app.request('/dashboard/trends/events');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.trend).toBeDefined();
      expect(body.days).toBeDefined();
    });
  });
});

function createDashboardMockDb() {
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
    limit: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    catch: vi.fn().mockReturnThis(),
    then: vi.fn().mockImplementation((resolve: any) => resolve([])),
  };

  return chainable;
}
