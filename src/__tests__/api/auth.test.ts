import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createAuthMiddleware, hashApiKey } from '../../middleware/auth.js';
import { createHash } from 'crypto';

// Mock the logger
vi.mock('../../config/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Auth Middleware', () => {
  let app: Hono;
  let mockDb: any;

  const testApiKey = 'rev_test1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab';
  const testKeyHash = hashApiKey(testApiKey);
  const testOrgId = 'org_auth_test_001';
  const testKeyId = 'key_auth_test_001';

  beforeEach(() => {
    mockDb = createAuthMockDb();
    app = new Hono();
    const auth = createAuthMiddleware(mockDb);
    app.use('*', auth);
    app.get('/test', (c) => {
      const auth = c.get('auth' as any);
      return c.json({ orgId: auth.orgId, orgSlug: auth.orgSlug });
    });
  });

  describe('missing Authorization header', () => {
    it('should return 401 when no Authorization header', async () => {
      const res = await app.request('/test');
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain('Missing');
    });
  });

  describe('invalid Authorization format', () => {
    it('should return 401 for non-Bearer authorization', async () => {
      const res = await app.request('/test', {
        headers: { Authorization: 'Basic abc123' },
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain('Missing');
    });

    it('should return 401 for Bearer without rev_ prefix', async () => {
      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer sk_test_12345' },
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain('Invalid API key format');
    });
  });

  describe('invalid API key', () => {
    it('should return 401 when key hash not found in database', async () => {
      // Configure DB to return no results for API key lookup
      mockDb._configureApiKeyResult(null);

      const res = await app.request('/test', {
        headers: { Authorization: `Bearer ${testApiKey}` },
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Invalid API key');
    });
  });

  describe('expired API key', () => {
    it('should return 401 when API key is expired', async () => {
      const pastDate = new Date('2020-01-01T00:00:00Z');
      mockDb._configureApiKeyResult({
        keyId: testKeyId,
        orgId: testOrgId,
        expiresAt: pastDate,
      });

      const res = await app.request('/test', {
        headers: { Authorization: `Bearer ${testApiKey}` },
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('API key expired');
    });
  });

  describe('valid API key', () => {
    it('should pass and set auth context for valid key', async () => {
      mockDb._configureApiKeyResult({
        keyId: testKeyId,
        orgId: testOrgId,
        expiresAt: null,
      });
      mockDb._configureOrgResult({ slug: 'test-org' });

      const res = await app.request('/test', {
        headers: { Authorization: `Bearer ${testApiKey}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.orgId).toBe(testOrgId);
      expect(body.orgSlug).toBe('test-org');
    });

    it('should pass for non-expired key with future expiration', async () => {
      const futureDate = new Date('2030-01-01T00:00:00Z');
      mockDb._configureApiKeyResult({
        keyId: testKeyId,
        orgId: testOrgId,
        expiresAt: futureDate,
      });
      mockDb._configureOrgResult({ slug: 'test-org' });

      const res = await app.request('/test', {
        headers: { Authorization: `Bearer ${testApiKey}` },
      });
      expect(res.status).toBe(200);
    });

    it('should return 401 when organization not found', async () => {
      mockDb._configureApiKeyResult({
        keyId: testKeyId,
        orgId: testOrgId,
        expiresAt: null,
      });
      mockDb._configureOrgResult(null);

      const res = await app.request('/test', {
        headers: { Authorization: `Bearer ${testApiKey}` },
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Organization not found');
    });
  });

  describe('hashApiKey', () => {
    it('should produce a consistent SHA-256 hash', () => {
      const hash1 = hashApiKey('rev_test123');
      const hash2 = hashApiKey('rev_test123');
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different keys', () => {
      const hash1 = hashApiKey('rev_key1');
      const hash2 = hashApiKey('rev_key2');
      expect(hash1).not.toBe(hash2);
    });

    it('should match standard SHA-256', () => {
      const key = 'rev_test_key';
      const expected = createHash('sha256').update(key).digest('hex');
      expect(hashApiKey(key)).toBe(expected);
    });
  });
});

function createAuthMockDb() {
  let apiKeyResult: any = null;
  let orgResult: any = null;
  let queryNumber = 0;

  const chainable: any = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => {
      queryNumber++;
      if (queryNumber === 1) {
        // First query: API key lookup
        return Promise.resolve(apiKeyResult ? [apiKeyResult] : []);
      }
      if (queryNumber === 2) {
        // Second query: org lookup
        return Promise.resolve(orgResult ? [orgResult] : []);
      }
      return Promise.resolve([]);
    }),
    catch: vi.fn().mockReturnThis(),

    _configureApiKeyResult(result: any) {
      apiKeyResult = result;
      queryNumber = 0;
    },
    _configureOrgResult(result: any) {
      orgResult = result;
    },
    _resetQueryNumber() {
      queryNumber = 0;
    },
  };

  return chainable;
}
