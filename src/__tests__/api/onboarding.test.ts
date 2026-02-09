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

describe('Onboarding API', () => {
  const orgId = 'org_onboarding_test';
  const orgSlug = 'test-org';
  let app: Hono;
  let mockDb: any;

  beforeEach(() => {
    resetUuidCounter();
    mockDb = createOnboardingMockDb();

    app = new Hono();
    app.use('*', async (c, next) => {
      c.set('auth' as any, { orgId, orgSlug, apiKeyId: 'key_test' });
      await next();
    });
    app.route('/setup', createOnboardingRoutes(mockDb));
  });

  describe('POST /setup/org', () => {
    it('should create organization and return API key', async () => {
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
      const res = await app.request('/setup/org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Company' }),
      });
      expect(res.status).toBe(400);
    });

    it('should return 409 when slug is already taken', async () => {
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('stripeSecretKey');
    });

    it('should connect Stripe with valid key', async () => {
      // First limit call: org lookup for slug
      mockDb._configureSelectResult([{ slug: 'test-org' }]);
      mockDb._configureInsertResult([]);

      const res = await app.request('/setup/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyId: 'key123' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('required');
    });

    it('should connect Apple with valid credentials', async () => {
      mockDb._configureSelectResult([{ slug: 'test-org' }]);
      mockDb._configureInsertResult([]);

      const res = await app.request('/setup/apple', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      // The status endpoint now uses Promise.all for parallel queries.
      // Each query resolves via the mock's .then()
      // We need to handle multiple parallel calls by making each resolve to appropriate data.
      let callCount = 0;
      mockDb.then = vi.fn().mockImplementation((resolve: any) => {
        callCount++;
        switch (callCount) {
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

      const res = await app.request('/setup/status');
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.integrations).toBeDefined();
      expect(body.stats).toBeDefined();
      expect(body.readiness).toBeDefined();
      expect(body.readiness.hasConnection).toBe(true);
    });

    it('should report not ready when no connections', async () => {
      let callCount = 0;
      mockDb.then = vi.fn().mockImplementation((resolve: any) => {
        callCount++;
        switch (callCount) {
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

      const res = await app.request('/setup/status');
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.readiness.hasConnection).toBe(false);
      expect(body.readiness.isReady).toBe(false);
    });
  });

  describe('POST /setup/backfill/stripe', () => {
    it('should return 400 when Stripe not connected', async () => {
      mockDb._configureSelectResult([]);

      const res = await app.request('/setup/backfill/stripe', {
        method: 'POST',
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Stripe not connected');
    });

    it('should start backfill when Stripe is connected', async () => {
      mockDb._configureSelectResult([{
        id: 'conn-1',
        orgId,
        source: 'stripe',
        credentials: { apiKey: 'sk_test_xxx' },
      }]);

      const res = await app.request('/setup/backfill/stripe', {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.jobId).toBeDefined();
      expect(body.status).toBe('started');
    });
  });
});

function createOnboardingMockDb() {
  let selectResult: any[] = [];
  let insertResult: any[] = [];

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
    limit: vi.fn().mockImplementation(() => Promise.resolve(selectResult)),
    returning: vi.fn().mockImplementation(() => Promise.resolve(insertResult)),
    onConflictDoUpdate: vi.fn().mockImplementation(() => Promise.resolve([])),
    catch: vi.fn().mockReturnThis(),
    then: vi.fn().mockImplementation((resolve: any) => resolve([])),

    _configureSelectResult(data: any[]) {
      selectResult = data;
    },
    _configureInsertResult(data: any[]) {
      insertResult = data;
    },
  };

  return chainable;
}
