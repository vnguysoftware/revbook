import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RecurlyBackfill } from '../../ingestion/backfill/recurly-backfill.js';

// Mock the logger
vi.mock('../../config/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock Redis (no real Redis in unit tests)
vi.mock('ioredis', () => {
  class MockRedis {
    connect = vi.fn().mockResolvedValue(undefined);
    get = vi.fn().mockResolvedValue(null);
    set = vi.fn().mockResolvedValue('OK');
    del = vi.fn().mockResolvedValue(1);
    quit = vi.fn().mockResolvedValue(undefined);
    constructor(..._args: any[]) {}
  }
  return { default: MockRedis };
});

// Mock the circuit breaker to pass through
vi.mock('../../security/circuit-breaker.js', () => ({
  CircuitBreaker: vi.fn().mockImplementation(() => ({
    execute: (fn: () => any) => fn(),
  })),
}));

// Mock credentials reader
vi.mock('../../security/credentials.js', () => ({
  readCredentials: () => ({ apiKey: 'test_recurly_api_key', subdomain: 'testco' }),
  writeCredentials: () => 'encrypted',
}));

// Mock the ingestion pipeline
const { mockProcessTrustedWebhook } = vi.hoisted(() => ({
  mockProcessTrustedWebhook: vi.fn(),
}));
vi.mock('../../ingestion/pipeline.js', () => ({
  IngestionPipeline: function() {
    return { processTrustedWebhook: mockProcessTrustedWebhook };
  },
}));

// Mock global fetch for Recurly API calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('RecurlyBackfill', () => {
  let backfill: RecurlyBackfill;
  let mockDb: any;

  function createMockDb() {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{
        id: 'conn_1',
        orgId: 'org_test',
        source: 'recurly',
        credentials: 'encrypted',
        webhookSecret: null,
        isActive: true,
      }]),
      returning: vi.fn().mockResolvedValue([]),
      then: vi.fn().mockImplementation((resolve: any) => resolve([])),
    };
    return chain;
  }

  function createRecurlySubscription(overrides?: Partial<any>) {
    return {
      uuid: `sub_${Math.random().toString(36).slice(2, 10)}`,
      state: 'active',
      plan: { code: 'premium', name: 'Premium Plan' },
      account: { code: 'acct_123', email: 'user@test.com' },
      unit_amount: 1999,
      currency: 'USD',
      current_period_started_at: '2025-01-15T00:00:00Z',
      current_period_ends_at: '2025-02-15T00:00:00Z',
      trial_started_at: null,
      trial_ends_at: null,
      ...overrides,
    };
  }

  function mockRecurlyApiResponse(data: any[], hasMore = false, next: string | null = null) {
    return {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ data, has_more: hasMore, next }),
      text: vi.fn().mockResolvedValue(JSON.stringify({ data, has_more: hasMore, next })),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore hoisted mock implementations after mockReset
    mockProcessTrustedWebhook.mockResolvedValue(undefined);
    mockDb = createMockDb();
    backfill = new RecurlyBackfill(mockDb);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('run', () => {
    it('should process subscriptions from Recurly API', async () => {
      const sub1 = createRecurlySubscription({ uuid: 'sub_001' });
      const sub2 = createRecurlySubscription({ uuid: 'sub_002' });

      // First fetch: count query (limit=1)
      mockFetch.mockResolvedValueOnce(mockRecurlyApiResponse([sub1], true));
      // Second fetch: actual subscription list
      mockFetch.mockResolvedValueOnce(mockRecurlyApiResponse([sub1, sub2], false));

      const result = await backfill.run('org_test');

      expect(result.subscriptionsProcessed).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(mockProcessTrustedWebhook).toHaveBeenCalledTimes(2);
    });

    it('should synthesize webhook-like payloads for each subscription', async () => {
      const sub = createRecurlySubscription({
        uuid: 'sub_synth_001',
        state: 'active',
        plan: { code: 'pro', name: 'Pro Plan' },
        account: { code: 'acct_synth', email: 'synth@test.com' },
        unit_amount: 4999,
        currency: 'EUR',
      });

      // Count query
      mockFetch.mockResolvedValueOnce(mockRecurlyApiResponse([sub], false));
      // Subscription list
      mockFetch.mockResolvedValueOnce(mockRecurlyApiResponse([sub], false));

      await backfill.run('org_test');

      expect(mockProcessTrustedWebhook).toHaveBeenCalledTimes(1);

      const [orgId, source, rawEvent] = mockProcessTrustedWebhook.mock.calls[0];
      expect(orgId).toBe('org_test');
      expect(source).toBe('recurly');

      const payload = JSON.parse(rawEvent.body);
      expect(payload.object_type).toBe('subscription');
      expect(payload.event_type).toBe('created'); // active → created
      expect(payload.account.code).toBe('acct_synth');
      expect(payload.account.email).toBe('synth@test.com');
      expect(payload.subscription.uuid).toBe('sub_synth_001');
      expect(payload.subscription.plan.code).toBe('pro');
      expect(payload.subscription.unit_amount_in_cents).toBe(4999);
      expect(payload.subscription.currency).toBe('EUR');
    });

    it('should set event_type to expired for non-active subscriptions', async () => {
      const sub = createRecurlySubscription({ uuid: 'sub_expired', state: 'expired' });

      mockFetch.mockResolvedValueOnce(mockRecurlyApiResponse([sub], false));
      mockFetch.mockResolvedValueOnce(mockRecurlyApiResponse([sub], false));

      await backfill.run('org_test');

      const [, , rawEvent] = mockProcessTrustedWebhook.mock.calls[0];
      const payload = JSON.parse(rawEvent.body);
      expect(payload.event_type).toBe('expired');
    });

    it('should handle pagination with cursor-based next links', async () => {
      const page1Subs = Array.from({ length: 3 }, (_, i) =>
        createRecurlySubscription({ uuid: `sub_page1_${i}` }),
      );
      const page2Subs = Array.from({ length: 2 }, (_, i) =>
        createRecurlySubscription({ uuid: `sub_page2_${i}` }),
      );

      // Count query
      mockFetch.mockResolvedValueOnce(mockRecurlyApiResponse([page1Subs[0]], true));
      // Page 1
      mockFetch.mockResolvedValueOnce(
        mockRecurlyApiResponse(page1Subs, true, 'https://v3.recurly.com/subscriptions?cursor=abc123'),
      );
      // Page 2
      mockFetch.mockResolvedValueOnce(mockRecurlyApiResponse(page2Subs, false));

      const result = await backfill.run('org_test');

      expect(result.subscriptionsProcessed).toBe(5);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should throw when Recurly connection is not found', async () => {
      // Override limit to return empty (no connection)
      mockDb.limit = vi.fn().mockResolvedValue([]);

      mockFetch.mockResolvedValue(mockRecurlyApiResponse([], false));

      await expect(backfill.run('org_test')).rejects.toThrow('Recurly not connected');
    });

    it('should continue processing when individual subscriptions fail', async () => {
      const sub1 = createRecurlySubscription({ uuid: 'sub_ok' });
      const sub2 = createRecurlySubscription({ uuid: 'sub_fail' });
      const sub3 = createRecurlySubscription({ uuid: 'sub_ok2' });

      mockFetch.mockResolvedValueOnce(mockRecurlyApiResponse([sub1], true));
      mockFetch.mockResolvedValueOnce(mockRecurlyApiResponse([sub1, sub2, sub3], false));

      // Fail on the second subscription
      mockProcessTrustedWebhook
        .mockResolvedValueOnce(undefined) // sub1 ok
        .mockRejectedValueOnce(new Error('Pipeline error')) // sub2 fails
        .mockResolvedValueOnce(undefined); // sub3 ok

      const result = await backfill.run('org_test');

      expect(result.subscriptionsProcessed).toBe(2); // 2 succeeded
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('sub_fail');
    });

    it('should track duration in result', async () => {
      mockFetch.mockResolvedValueOnce(mockRecurlyApiResponse([], false));
      mockFetch.mockResolvedValueOnce(mockRecurlyApiResponse([], false));

      const result = await backfill.run('org_test');

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle Recurly API errors gracefully', async () => {
      // Count query succeeds
      mockFetch.mockResolvedValueOnce(mockRecurlyApiResponse([], false));
      // Subscription list fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: vi.fn().mockResolvedValue({ error: 'Unauthorized' }),
        text: vi.fn().mockResolvedValue('Unauthorized'),
      });

      const result = await backfill.run('org_test');

      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('getProgress', () => {
    it('should return null when no progress exists', async () => {
      const progress = await RecurlyBackfill.getProgress('org_nonexistent');
      // Redis mock returns null by default
      expect(progress).toBeNull();
    });
  });
});
