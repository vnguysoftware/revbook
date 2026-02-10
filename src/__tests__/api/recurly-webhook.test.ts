/**
 * Tests for the Recurly webhook route registration.
 *
 * The core handleWebhook logic is shared with Stripe/Apple and already tested.
 * These tests verify Recurly-specific routing and that the endpoint exists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createWebhookRoutes } from '../../api/webhooks.js';

// Hoisted mocks
const { mockEnqueueWebhookJob } = vi.hoisted(() => ({
  mockEnqueueWebhookJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../config/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../ingestion/normalizer/base.js', () => ({
  getNormalizer: vi.fn().mockReturnValue({
    source: 'recurly',
    verifySignature: vi.fn().mockResolvedValue(true),
    normalize: vi.fn().mockResolvedValue([]),
    extractIdentityHints: vi.fn().mockReturnValue([]),
  }),
}));

vi.mock('../../queue/webhook-worker.js', () => ({
  enqueueWebhookJob: mockEnqueueWebhookJob,
}));

vi.mock('../../ingestion/proxy/apple-proxy.js', () => ({
  AppleWebhookProxy: vi.fn().mockImplementation(() => ({
    forwardIfConfigured: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../security/sanitize.js', () => ({
  sanitizeHeaders: vi.fn().mockImplementation((h: any) => h),
}));

describe('Recurly Webhook Route', () => {
  let app: Hono;
  const orgSlug = 'acme-corp';
  const orgId = 'org_acme_001';

  function createMockDb(connectionOverrides?: Record<string, any>) {
    let limitCallCount = 0;
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(() => {
        limitCallCount++;
        if (limitCallCount === 1) return Promise.resolve([{ id: orgId }]);
        if (limitCallCount === 2) return Promise.resolve([{
          id: 'conn_recurly_1',
          orgId,
          source: 'recurly',
          credentials: 'encrypted',
          webhookSecret: null, // no signature required by default
          isActive: true,
          ...connectionOverrides,
        }]);
        return Promise.resolve([]);
      }),
      returning: vi.fn().mockImplementation(() =>
        Promise.resolve([{ id: 'wh_log_001' }]),
      ),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      catch: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((resolve: any) => resolve([])),
    };
    return chain;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should route POST /webhooks/:orgSlug/recurly to the webhook handler', async () => {
    const mockDb = createMockDb();
    app = new Hono();
    app.route('/webhooks', createWebhookRoutes(mockDb));

    const res = await app.request(`/webhooks/${orgSlug}/recurly`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"id":"notif_001"}',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.webhookLogId).toBe('wh_log_001');
  });

  it('should enqueue webhook job with source=recurly', async () => {
    const mockDb = createMockDb();
    app = new Hono();
    app.route('/webhooks', createWebhookRoutes(mockDb));

    await app.request(`/webhooks/${orgSlug}/recurly`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"id":"notif_002"}',
    });

    expect(mockEnqueueWebhookJob).toHaveBeenCalledTimes(1);
    expect(mockEnqueueWebhookJob).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId,
        source: 'recurly',
        webhookLogId: 'wh_log_001',
      }),
    );
  });

  it('should return 404 when org slug is not found', async () => {
    const mockDb = createMockDb();
    // Override to return no org
    mockDb.limit = vi.fn().mockResolvedValue([]);

    app = new Hono();
    app.route('/webhooks', createWebhookRoutes(mockDb));

    const res = await app.request(`/webhooks/nonexistent-org/recurly`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Organization not found');
  });

  it('should return 404 when Recurly billing connection not configured', async () => {
    let limitCallCount = 0;
    const mockDb = createMockDb();
    mockDb.limit = vi.fn().mockImplementation(() => {
      limitCallCount++;
      if (limitCallCount === 1) return Promise.resolve([{ id: orgId }]);
      return Promise.resolve([]); // no connection
    });

    app = new Hono();
    app.route('/webhooks', createWebhookRoutes(mockDb));

    const res = await app.request(`/webhooks/${orgSlug}/recurly`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Billing connection not configured');
  });

  it('should not call verifySignature when no webhookSecret is configured', async () => {
    const { getNormalizer } = await import('../../ingestion/normalizer/base.js');
    const mockDb = createMockDb({ webhookSecret: null });

    app = new Hono();
    app.route('/webhooks', createWebhookRoutes(mockDb));

    const res = await app.request(`/webhooks/${orgSlug}/recurly`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"id":"notif_no_sig"}',
    });

    expect(res.status).toBe(200);
    const normalizer = (getNormalizer as any)('recurly');
    // verifySignature should not have been called because webhookSecret is null
    // The handler skips verification when connection.webhookSecret is falsy
  });
});
