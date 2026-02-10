import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createHealthRoutes } from '../../api/health.js';

// Mock the logger
vi.mock('../../config/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock Redis connection
const mockRedis = {
  ping: vi.fn(),
};

vi.mock('../../config/queue.js', () => ({
  getRedisConnection: () => mockRedis,
}));

function createMockDb(execResult?: any) {
  return {
    execute: vi.fn().mockImplementation(() => {
      if (execResult instanceof Error) {
        return Promise.reject(execResult);
      }
      return Promise.resolve(execResult ?? [{ '?column?': 1 }]);
    }),
  } as any;
}

describe('Health Routes', () => {
  let app: Hono;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.ping.mockResolvedValue('PONG');
    mockDb = createMockDb();
    app = new Hono();
    app.route('/', createHealthRoutes(mockDb));
  });

  describe('GET /health', () => {
    it('should return ok when all components are healthy', async () => {
      const res = await app.request('/health');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        status: 'ok',
        version: '0.1.0',
        components: {
          database: 'ok',
          redis: 'ok',
        },
      });
    });

    it('should return degraded when database is down but redis is up', async () => {
      mockDb.execute.mockRejectedValue(new Error('connection refused'));

      const res = await app.request('/health');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('degraded');
      expect(body.components.database).toBe('error');
      expect(body.components.redis).toBe('ok');
    });

    it('should return degraded when redis is down but database is up', async () => {
      mockRedis.ping.mockRejectedValue(new Error('ECONNREFUSED'));

      const res = await app.request('/health');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('degraded');
      expect(body.components.database).toBe('ok');
      expect(body.components.redis).toBe('error');
    });

    it('should return unhealthy (503) when all components are down', async () => {
      mockDb.execute.mockRejectedValue(new Error('connection refused'));
      mockRedis.ping.mockRejectedValue(new Error('ECONNREFUSED'));

      const res = await app.request('/health');

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.status).toBe('unhealthy');
      expect(body.components.database).toBe('error');
      expect(body.components.redis).toBe('error');
    });

    it('should include version in response', async () => {
      const res = await app.request('/health');
      const body = await res.json();
      expect(body.version).toBe('0.1.0');
    });
  });

  describe('GET /ready', () => {
    it('should return 200 when all components are ready', async () => {
      const res = await app.request('/ready');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ready).toBe(true);
    });

    it('should return 503 when database is not ready', async () => {
      mockDb.execute.mockRejectedValue(new Error('not ready'));

      const res = await app.request('/ready');

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.ready).toBe(false);
      expect(body.components.database).toBe('error');
    });

    it('should return 503 when redis is not ready', async () => {
      mockRedis.ping.mockRejectedValue(new Error('not ready'));

      const res = await app.request('/ready');

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.ready).toBe(false);
      expect(body.components.redis).toBe('error');
    });

    it('should return 503 when all components are not ready', async () => {
      mockDb.execute.mockRejectedValue(new Error('not ready'));
      mockRedis.ping.mockRejectedValue(new Error('not ready'));

      const res = await app.request('/ready');

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.ready).toBe(false);
    });
  });

  describe('timeouts', () => {
    it('should handle database timeout gracefully', async () => {
      // Simulate a database that never responds
      mockDb.execute.mockImplementation(() => new Promise(() => {}));

      const res = await app.request('/health');

      // Should still respond (with timeout error)
      expect(res.status).toBe(200); // degraded, not unhealthy
      const body = await res.json();
      expect(body.components.database).toBe('error');
      expect(body.components.redis).toBe('ok');
    }, 10000);

    it('should handle redis timeout gracefully', async () => {
      // Simulate redis that never responds
      mockRedis.ping.mockImplementation(() => new Promise(() => {}));

      const res = await app.request('/health');

      expect(res.status).toBe(200); // degraded
      const body = await res.json();
      expect(body.components.database).toBe('ok');
      expect(body.components.redis).toBe('error');
    }, 10000);
  });
});
