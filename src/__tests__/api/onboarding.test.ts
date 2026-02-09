import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createOnboardingRoutes } from '../../api/onboarding.js';
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

// Mock hashApiKey to return a predictable hash
vi.mock('../../middleware/auth.js', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    hashApiKey: vi.fn().mockReturnValue('test_hash_value'),
  };
});

// Mock Stripe for the onboarding route
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({
    customers: {
      list: vi.fn().mockResolvedValue({ data: [], has_more: false }),
    },
    subscriptions: {
      list: vi.fn().mockResolvedValue({ data: [], has_more: false }),
    },
  })),
}));

// Mock the StripeBackfill
vi.mock('../../ingestion/backfill/stripe-backfill.js', () => {
  class MockStripeBackfill {
    static getProgress = vi.fn().mockResolvedValue(null);
    run = vi.fn().mockResolvedValue(undefined);
    constructor(_db: any) {}
  }
  return { StripeBackfill: MockStripeBackfill };
});

const AUTH_HEADER = { Authorization: 'Bearer rev_test_key_for_onboarding' };

describe('Onboarding API', () => {
  const orgId = 'org_onboarding_test';
  const orgSlug = 'test-org';
  let app: Hono;
  let mockDb: any;

  beforeEach(() => {
    resetUuidCounter();
    mockDb = createOnboardingMockDb(orgId, orgSlug);

    app = new Hono();
    app.route('/setup', createOnboardingRoutes(mockDb));
  });

  describe('POST /setup/org', () => {
    it('should create organization and return API key', async () => {
      // /org skips auth middleware
      mockDb._skipAuth();
      // No existing slug
      mockDb._configureSelectResult([]);
      // Org creation
      mockDb._configureInsertResult([{
        id: 'new-org-id',
        name: 'Test Company',
        slug: 'test-company',
      }]);

      const res = await app.request('/setup/org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Company', slug: 'test-company' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.organization).toBeDefined();
      expect(body.apiKey).toBeDefined();
      expect(body.apiKey).toMatch(/^rev_/);
      expect(body.webhookBaseUrl).toContain('test-company');
      expect(body.nextSteps).toBeDefined();
    });

    it('should return 400 when name is missing', async () => {
      mockDb._skipAuth();
      const res = await app.request('/setup/org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'test-company' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('required');
    });

    it('should return 400 when slug is missing', async () => {
      mockDb._skipAuth();
      const res = await app.request('/setup/org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Company' }),
      });
      expect(res.status).toBe(400);
    });

    it('should return 409 when slug is already taken', async () => {
      mockDb._skipAuth();
      // Existing org with same slug
      mockDb._configureSelectResult([{ id: 'existing-org' }]);

      const res = await app.request('/setup/org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Duplicate', slug: 'existing-slug' }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toContain('Slug already taken');
    });
  });

  describe('POST /setup/stripe', () => {
    it('should return 400 when stripeSecretKey is missing', async () => {
      const res = await app.request('/setup/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADER },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('stripeSecretKey');
    });

    it('should connect Stripe with valid key', async () => {
      const res = await app.request('/setup/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADER },
        body: JSON.stringify({
          stripeSecretKey: 'sk_test_valid_key',
          webhookSecret: 'whsec_test',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.connected).toBe(true);
      expect(body.source).toBe('stripe');
      expect(body.webhookUrl).toBeDefined();
      expect(body.instructions).toBeDefined();
    });
  });

  describe('POST /setup/apple', () => {
    it('should return 400 when required fields are missing', async () => {
      const res = await app.request('/setup/apple', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADER },
        body: JSON.stringify({ keyId: 'key123' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('required');
    });

    it('should connect Apple with valid credentials', async () => {
      const res = await app.request('/setup/apple', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADER },
        body: JSON.stringify({
          keyId: 'key123',
          issuerId: 'issuer456',
          bundleId: 'com.app.test',
          privateKey: 'private_key_content',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.connected).toBe(true);
      expect(body.source).toBe('apple');
      expect(body.instructions).toBeDefined();
    });
  });

  describe('GET /setup/status', () => {
    it('should return integration health status', async () => {
      // Override then for the status endpoint's many parallel queries
      // Auth middleware uses limit() (2 calls), then status endpoint uses then() (6 calls)
      let thenCallCount = 0;
      mockDb.then = vi.fn().mockImplementation((resolve: any) => {
        thenCallCount++;
        switch (thenCallCount) {
          case 1:
            // connections
            return resolve([{
              source: 'stripe',
              isActive: true,
              lastWebhookAt: new Date(),
              webhookSecret: 'whsec_test',
              syncStatus: 'active',
              lastSyncAt: null,
            }]);
          case 2:
            // event count
            return resolve([{ count: 50 }]);
          case 3:
            // user count
            return resolve([{ count: 10 }]);
          case 4:
            // issue count
            return resolve([{ count: 2 }]);
          case 5:
            // recent webhooks
            return resolve([{ source: 'stripe', count: 5 }]);
          case 6:
            // today events
            return resolve([{ count: 15 }]);
          default:
            return resolve([]);
        }
      });

      const res = await app.request('/setup/status', {
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.integrations).toBeDefined();
      expect(body.stats).toBeDefined();
      expect(body.readiness).toBeDefined();
      expect(body.readiness.hasConnection).toBe(true);
    });

    it('should report not ready when no connections', async () => {
      let thenCallCount = 0;
      mockDb.then = vi.fn().mockImplementation((resolve: any) => {
        thenCallCount++;
        switch (thenCallCount) {
          case 1:
            return resolve([]); // no connections
          case 2:
            return resolve([{ count: 0 }]); // events
          case 3:
            return resolve([{ count: 0 }]); // users
          case 4:
            return resolve([{ count: 0 }]); // issues
          case 5:
            return resolve([]); // recent webhooks
          case 6:
            return resolve([{ count: 0 }]); // today events
          default:
            return resolve([]);
        }
      });

      const res = await app.request('/setup/status', {
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.readiness.hasConnection).toBe(false);
      expect(body.readiness.isReady).toBe(false);
    });
  });

  describe('POST /setup/backfill/stripe', () => {
    it('should return 400 when Stripe not connected', async () => {
      // Auth middleware uses limit() twice, then the route uses limit() once
      // After auth (which returns default auth data), the route queries for stripe connection
      let limitCallCount = 0;
      mockDb.limit = vi.fn().mockImplementation(() => {
        limitCallCount++;
        // First 2 calls: auth middleware (apiKey lookup, org lookup)
        if (limitCallCount === 1) return Promise.resolve([{ keyId: 'key_test', orgId, expiresAt: null }]);
        if (limitCallCount === 2) return Promise.resolve([{ slug: orgSlug }]);
        // 3rd call: billingConnections lookup - return empty (not connected)
        return Promise.resolve([]);
      });

      const res = await app.request('/setup/backfill/stripe', {
        method: 'POST',
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Stripe not connected');
    });

    it('should start backfill when Stripe is connected', async () => {
      let limitCallCount = 0;
      mockDb.limit = vi.fn().mockImplementation(() => {
        limitCallCount++;
        if (limitCallCount === 1) return Promise.resolve([{ keyId: 'key_test', orgId, expiresAt: null }]);
        if (limitCallCount === 2) return Promise.resolve([{ slug: orgSlug }]);
        // 3rd call: billingConnections lookup - return connection
        return Promise.resolve([{
          id: 'conn-1',
          orgId,
          source: 'stripe',
          credentials: { apiKey: 'sk_test_xxx' },
        }]);
      });

      const res = await app.request('/setup/backfill/stripe', {
        method: 'POST',
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.jobId).toBeDefined();
      expect(body.status).toBe('started');
    });
  });
});

function createOnboardingMockDb(orgId: string, orgSlug: string) {
  let selectResult: any[] = [];
  let insertResult: any[] = [];
  // Track limit calls so auth middleware gets proper data
  // Auth middleware makes 2 limit calls: apiKey lookup, then org lookup
  let limitCallCount = 0;
  let authEnabled = true;

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
    limit: vi.fn().mockImplementation(() => {
      limitCallCount++;
      if (authEnabled) {
        // First two limit calls per request are from the auth middleware
        if (limitCallCount === 1) return Promise.resolve([{ keyId: 'key_test', orgId, expiresAt: null }]);
        if (limitCallCount === 2) return Promise.resolve([{ slug: orgSlug }]);
      }
      // Subsequent calls (or all calls when auth is disabled) are from the route handler
      return Promise.resolve(selectResult);
    }),
    returning: vi.fn().mockImplementation(() => Promise.resolve(insertResult)),
    onConflictDoUpdate: vi.fn().mockImplementation(() => Promise.resolve([])),
    catch: vi.fn().mockReturnThis(),
    then: vi.fn().mockImplementation((resolve: any) => resolve([])),

    _configureSelectResult(data: any[]) {
      selectResult = data;
      limitCallCount = 0; // reset for fresh request
    },
    _configureInsertResult(data: any[]) {
      insertResult = data;
    },
    _skipAuth() {
      authEnabled = false;
      limitCallCount = 0;
    },
    _enableAuth() {
      authEnabled = true;
      limitCallCount = 0;
    },
  };

  return chainable;
}
