import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { createOnboardingRoutes } from './onboarding.js';
import type { Database } from '../config/database.js';

// ─── Test Setup ──────────────────────────────────────────────────────

const TEST_DB_URL = process.env.DATABASE_URL || 'postgresql://revback:revback_secret@localhost:5433/revback';

let sql: ReturnType<typeof postgres>;
let db: Database;
let app: Hono;

beforeAll(async () => {
  sql = postgres(TEST_DB_URL, { max: 3 });
  db = drizzle(sql) as unknown as Database;

  const onboarding = createOnboardingRoutes(db);
  app = new Hono();
  app.route('/setup', onboarding);
});

afterAll(async () => {
  await sql.end();
});

// ─── Helpers ─────────────────────────────────────────────────────────

function request(method: string, path: string, opts?: { body?: unknown; apiKey?: string }) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts?.apiKey) {
    headers['Authorization'] = `Bearer ${opts.apiKey}`;
  }
  return app.request(path, {
    method,
    headers,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('Onboarding API', () => {
  let createdApiKey: string;

  describe('POST /setup/org', () => {
    it('creates an organization without auth', async () => {
      const res = await request('POST', '/setup/org', {
        body: { name: 'Test Onboarding Corp', slug: 'test-onboarding-corp' },
      });
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.organization).toBeDefined();
      expect(data.organization.name).toBe('Test Onboarding Corp');
      expect(data.organization.slug).toBe('test-onboarding-corp');
      expect(data.apiKey).toBeDefined();
      expect(data.apiKey).toMatch(/^rev_/);
      expect(data.webhookBaseUrl).toBe('/webhooks/test-onboarding-corp');

      createdApiKey = data.apiKey;
    });

    it('rejects missing name/slug', async () => {
      const res = await request('POST', '/setup/org', {
        body: { name: '' },
      });
      expect(res.status).toBe(400);
    });

    it('rejects invalid slug format', async () => {
      const res = await request('POST', '/setup/org', {
        body: { name: 'Test', slug: '-bad-slug-' },
      });
      expect(res.status).toBe(400);
    });

    it('rejects duplicate slug', async () => {
      const res = await request('POST', '/setup/org', {
        body: { name: 'Duplicate', slug: 'test-onboarding-corp' },
      });
      expect(res.status).toBe(409);
    });
  });

  describe('Auth middleware on setup routes', () => {
    it('returns 401 for /setup/status without auth', async () => {
      const res = await request('GET', '/setup/status');
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Missing or invalid Authorization header');
    });

    it('returns 401 for /setup/status with invalid key', async () => {
      const res = await request('GET', '/setup/status', {
        apiKey: 'rev_notarealkey',
      });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Invalid API key');
    });

    it('returns 401 for /setup/status with non-rev_ key', async () => {
      const res = await request('GET', '/setup/status', {
        apiKey: 'sk_test_something',
      });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Invalid API key format');
    });

    it('returns 401 for /setup/stripe without auth', async () => {
      const res = await request('POST', '/setup/stripe', {
        body: { stripeSecretKey: 'sk_test_foo' },
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 for /setup/backfill/progress without auth', async () => {
      const res = await request('GET', '/setup/backfill/progress');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /setup/status', () => {
    it('returns status for authenticated user', async () => {
      const res = await request('GET', '/setup/status', {
        apiKey: createdApiKey,
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.integrations).toBeDefined();
      expect(data.stats).toBeDefined();
      expect(data.stats.eventsProcessed).toBe(0);
      expect(data.readiness).toBeDefined();
      expect(data.readiness.hasConnection).toBe(false);
      expect(data.readiness.isReady).toBe(false);
      expect(data.backfill).toBeNull();
    });
  });

  describe('POST /setup/stripe', () => {
    it('rejects invalid Stripe key', async () => {
      const res = await request('POST', '/setup/stripe', {
        apiKey: createdApiKey,
        body: { stripeSecretKey: 'sk_test_invalid_key' },
      });
      // Should return 400 because the Stripe key is invalid
      expect(res.status).toBe(400);
    });

    it('rejects missing Stripe key', async () => {
      const res = await request('POST', '/setup/stripe', {
        apiKey: createdApiKey,
        body: {},
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /setup/backfill/progress', () => {
    it('returns not_started when no backfill exists', async () => {
      const res = await request('GET', '/setup/backfill/progress', {
        apiKey: createdApiKey,
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.status).toBe('not_started');
    });
  });
});
