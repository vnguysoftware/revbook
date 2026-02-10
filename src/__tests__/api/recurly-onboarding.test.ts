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

// Mock hashApiKey
vi.mock('../../middleware/auth.js', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    hashApiKey: vi.fn().mockReturnValue('test_hash_value'),
  };
});

// Mock Stripe (required by the module even though we're testing Recurly)
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({
    customers: { list: vi.fn().mockResolvedValue({ data: [], has_more: false }) },
    subscriptions: { list: vi.fn().mockResolvedValue({ data: [], has_more: false }) },
  })),
}));

// Mock backfill classes — use hoisted mocks to survive mockReset
const {
  mockStripeGetProgress,
  mockRecurlyRun,
  mockRecurlyGetProgress,
  mockGoogleGetProgress,
} = vi.hoisted(() => ({
  mockStripeGetProgress: vi.fn(),
  mockRecurlyRun: vi.fn(),
  mockRecurlyGetProgress: vi.fn(),
  mockGoogleGetProgress: vi.fn(),
}));

vi.mock('../../ingestion/backfill/stripe-backfill.js', () => {
  class MockStripeBackfill {
    static getProgress = mockStripeGetProgress;
    run = vi.fn().mockResolvedValue(undefined);
    constructor(_db: any) {}
  }
  return { StripeBackfill: MockStripeBackfill };
});

vi.mock('../../ingestion/backfill/recurly-backfill.js', () => {
  class MockRecurlyBackfill {
    static getProgress = mockRecurlyGetProgress;
    run = mockRecurlyRun;
    constructor(_db: any) {}
  }
  return { RecurlyBackfill: MockRecurlyBackfill };
});

vi.mock('../../ingestion/backfill/google-backfill.js', () => {
  class MockGoogleBackfill {
    static getProgress = mockGoogleGetProgress;
    run = vi.fn().mockResolvedValue(undefined);
    constructor(_db: any) {}
  }
  return { GoogleBackfill: MockGoogleBackfill };
});

// Mock security modules
const { mockReadCredentials, mockWriteCredentials, mockAuditLog } = vi.hoisted(() => ({
  mockReadCredentials: vi.fn(),
  mockWriteCredentials: vi.fn(),
  mockAuditLog: vi.fn(),
}));
vi.mock('../../security/credentials.js', () => ({
  readCredentials: mockReadCredentials,
  writeCredentials: mockWriteCredentials,
}));

vi.mock('../../security/audit.js', () => ({
  auditLog: mockAuditLog,
}));

// Mock global fetch for Recurly API validation
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const AUTH_HEADER = { Authorization: 'Bearer rev_test_key_for_onboarding' };

describe('Recurly Onboarding API', () => {
  const orgId = 'org_recurly_test';
  const orgSlug = 'recurly-org';
  let app: Hono;
  let mockDb: any;

  beforeEach(() => {
    resetUuidCounter();
    vi.clearAllMocks();
    // Restore all hoisted mock implementations after mockReset
    mockReadCredentials.mockReturnValue({ apiKey: 'test_key', subdomain: 'testco' });
    mockWriteCredentials.mockReturnValue('encrypted');
    mockStripeGetProgress.mockResolvedValue(null);
    mockRecurlyRun.mockResolvedValue(undefined);
    mockRecurlyGetProgress.mockResolvedValue(null);
    mockGoogleGetProgress.mockResolvedValue(null);
    mockDb = createRecurlyMockDb(orgId, orgSlug);
    app = new Hono();
    app.route('/setup', createOnboardingRoutes(mockDb));
  });

  // ─── POST /setup/recurly ──────────────────────────────────────────

  describe('POST /setup/recurly', () => {
    it('should return 400 when apiKey is missing', async () => {
      const res = await app.request('/setup/recurly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADER },
        body: JSON.stringify({ subdomain: 'mycompany' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Invalid request body');
      expect(body.details.apiKey).toBeDefined();
    });

    it('should return 400 when subdomain is missing', async () => {
      const res = await app.request('/setup/recurly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADER },
        body: JSON.stringify({ apiKey: 'abc123' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Invalid request body');
      expect(body.details.subdomain).toBeDefined();
    });

    it('should return 400 when Recurly API key is invalid', async () => {
      // Mock Recurly API returning 401
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: vi.fn().mockResolvedValue('Unauthorized'),
      });

      const res = await app.request('/setup/recurly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADER },
        body: JSON.stringify({ apiKey: 'invalid_key', subdomain: 'mycompany' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Invalid Recurly API key');
    });

    it('should return 400 when Recurly API is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const res = await app.request('/setup/recurly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADER },
        body: JSON.stringify({ apiKey: 'some_key', subdomain: 'mycompany' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Failed to connect to Recurly');
    });

    it('should connect Recurly with valid credentials', async () => {
      // Mock Recurly API returning 200
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ data: [{ code: 'acct_1' }], has_more: false }),
      });

      const res = await app.request('/setup/recurly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADER },
        body: JSON.stringify({
          apiKey: 'valid_recurly_key',
          subdomain: 'mycompany',
          webhookKey: 'whk_test123',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.connected).toBe(true);
      expect(body.source).toBe('recurly');
      expect(body.webhookUrl).toContain(orgSlug);
      expect(body.webhookUrl).toContain('recurly');
      expect(body.instructions).toBeInstanceOf(Array);
      expect(body.instructions.length).toBeGreaterThan(0);
    });

    it('should connect Recurly without optional webhookKey', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ data: [], has_more: false }),
      });

      const res = await app.request('/setup/recurly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADER },
        body: JSON.stringify({ apiKey: 'valid_key', subdomain: 'mycompany' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.connected).toBe(true);
    });
  });

  // ─── POST /setup/verify/recurly ───────────────────────────────────

  describe('POST /setup/verify/recurly', () => {
    it('should return 400 when Recurly not connected', async () => {
      // Override limit to return no connection for the verify route
      let limitCallCount = 0;
      mockDb.limit = vi.fn().mockImplementation(() => {
        limitCallCount++;
        if (limitCallCount === 1) return Promise.resolve([{ keyId: 'key_test', orgId, expiresAt: null }]);
        if (limitCallCount === 2) return Promise.resolve([{ slug: orgSlug }]);
        return Promise.resolve([]); // no recurly connection
      });

      const res = await app.request('/setup/verify/recurly', {
        method: 'POST',
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Recurly not connected');
    });

    it('should verify Recurly connectivity successfully', async () => {
      // Override limit so the 3rd call (verify route) returns a connection
      let limitCallCount = 0;
      mockDb.limit = vi.fn().mockImplementation(() => {
        limitCallCount++;
        if (limitCallCount === 1) return Promise.resolve([{ keyId: 'key_test', orgId, expiresAt: null }]);
        if (limitCallCount === 2) return Promise.resolve([{ slug: orgSlug }]);
        return Promise.resolve([{
          id: 'conn_1',
          orgId,
          source: 'recurly',
          credentials: 'encrypted_creds',
          webhookSecret: 'whk_test',
          isActive: true,
        }]);
      });

      // Mock Recurly API: accounts list and subscriptions list
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ data: [{ code: 'a1' }], has_more: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ data: [{ uuid: 's1' }], has_more: false }),
        });

      const res = await app.request('/setup/verify/recurly', {
        method: 'POST',
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.source).toBe('recurly');
      expect(body.verified).toBe(true);
      expect(body.checks.apiKeyValid).toBe(true);
      expect(body.checks.canListAccounts).toBe(true);
      expect(body.checks.canListSubscriptions).toBe(true);
      expect(body.checks.webhookKeyConfigured).toBe(true);
    });

    it('should report failure when Recurly API key is invalid', async () => {
      let limitCallCount = 0;
      mockDb.limit = vi.fn().mockImplementation(() => {
        limitCallCount++;
        if (limitCallCount === 1) return Promise.resolve([{ keyId: 'key_test', orgId, expiresAt: null }]);
        if (limitCallCount === 2) return Promise.resolve([{ slug: orgSlug }]);
        return Promise.resolve([{
          id: 'conn_1',
          orgId,
          source: 'recurly',
          credentials: 'encrypted_creds',
          webhookSecret: null,
          isActive: true,
        }]);
      });

      // Mock Recurly API returning 401
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: vi.fn().mockResolvedValue('Unauthorized'),
      });

      const res = await app.request('/setup/verify/recurly', {
        method: 'POST',
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.verified).toBe(false);
      expect(body.checks.apiKeyValid).toBe(false);
      expect(body.checks.error).toBeDefined();
    });
  });

  // ─── POST /setup/backfill/recurly ─────────────────────────────────

  describe('POST /setup/backfill/recurly', () => {
    it('should return 400 when Recurly not connected', async () => {
      let limitCallCount = 0;
      mockDb.limit = vi.fn().mockImplementation(() => {
        limitCallCount++;
        if (limitCallCount === 1) return Promise.resolve([{ keyId: 'key_test', orgId, expiresAt: null }]);
        if (limitCallCount === 2) return Promise.resolve([{ slug: orgSlug }]);
        return Promise.resolve([]); // no connection
      });

      const res = await app.request('/setup/backfill/recurly', {
        method: 'POST',
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Recurly not connected');
    });

    it('should return 409 when backfill already in progress', async () => {
      let limitCallCount = 0;
      mockDb.limit = vi.fn().mockImplementation(() => {
        limitCallCount++;
        if (limitCallCount === 1) return Promise.resolve([{ keyId: 'key_test', orgId, expiresAt: null }]);
        if (limitCallCount === 2) return Promise.resolve([{ slug: orgSlug }]);
        return Promise.resolve([{
          id: 'conn_1', orgId, source: 'recurly', credentials: 'enc', isActive: true,
        }]);
      });

      // Simulate backfill already running
      mockRecurlyGetProgress.mockResolvedValueOnce({
        status: 'importing_subscriptions',
        phase: 'Importing...',
      });

      const res = await app.request('/setup/backfill/recurly', {
        method: 'POST',
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toContain('Backfill already in progress');
    });

    it('should start backfill when Recurly is connected', async () => {
      let limitCallCount = 0;
      mockDb.limit = vi.fn().mockImplementation(() => {
        limitCallCount++;
        if (limitCallCount === 1) return Promise.resolve([{ keyId: 'key_test', orgId, expiresAt: null }]);
        if (limitCallCount === 2) return Promise.resolve([{ slug: orgSlug }]);
        return Promise.resolve([{
          id: 'conn_1', orgId, source: 'recurly', credentials: 'enc', isActive: true,
        }]);
      });

      const res = await app.request('/setup/backfill/recurly', {
        method: 'POST',
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('started');
      expect(body.jobId).toContain('recurly');
      expect(body.progressUrl).toBe('/setup/backfill/progress');
    });
  });

  // ─── GET /setup/backfill/progress ─────────────────────────────────

  describe('GET /setup/backfill/progress', () => {
    it('should return not_started when no backfill exists', async () => {
      // Override then for the progress endpoint's parallel queries
      let thenCallCount = 0;
      mockDb.then = vi.fn().mockImplementation((resolve: any) => {
        thenCallCount++;
        return resolve([]);
      });

      const res = await app.request('/setup/backfill/progress', {
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('not_started');
    });

    it('should return Recurly progress when available', async () => {
      mockRecurlyGetProgress.mockResolvedValueOnce({
        status: 'importing_subscriptions',
        phase: 'Importing subscriptions from Recurly...',
        totalCustomers: 500,
        importedCustomers: 200,
      });

      const res = await app.request('/setup/backfill/progress', {
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.recurly).toBeDefined();
      expect(body.recurly.status).toBe('importing_subscriptions');
      expect(body.recurly.importedCustomers).toBe(200);
    });
  });
});

function createRecurlyMockDb(orgId: string, orgSlug: string) {
  let limitCallCount = 0;

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
      // Auth middleware: apiKey lookup then org lookup
      if (limitCallCount === 1) return Promise.resolve([{ keyId: 'key_test', orgId, expiresAt: null }]);
      if (limitCallCount === 2) return Promise.resolve([{ slug: orgSlug }]);
      // Route handler queries
      return Promise.resolve([{ slug: orgSlug }]);
    }),
    returning: vi.fn().mockImplementation(() => Promise.resolve([])),
    onConflictDoUpdate: vi.fn().mockImplementation(() => Promise.resolve([])),
    catch: vi.fn().mockReturnThis(),
    then: vi.fn().mockImplementation((resolve: any) => resolve([])),
  };

  return chainable;
}
