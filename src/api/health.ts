import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { Database } from '../config/database.js';
import { getRedisConnection } from '../config/queue.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('health');

type ComponentStatus = 'ok' | 'error';

interface HealthResponse {
  status: 'ok' | 'degraded' | 'unhealthy';
  version: string;
  components: {
    database: ComponentStatus;
    redis: ComponentStatus;
  };
}

const COMPONENT_TIMEOUT_MS = 2000;

/** Wraps a promise with a timeout. Rejects if the promise doesn't resolve in time. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} check timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

async function checkDatabase(db: Database): Promise<ComponentStatus> {
  try {
    await withTimeout(
      db.execute(sql`SELECT 1`),
      COMPONENT_TIMEOUT_MS,
      'database',
    );
    return 'ok';
  } catch (err) {
    log.warn({ err }, 'Database health check failed');
    return 'error';
  }
}

async function checkRedis(): Promise<ComponentStatus> {
  try {
    const redis = getRedisConnection();
    await withTimeout(
      redis.ping(),
      COMPONENT_TIMEOUT_MS,
      'redis',
    );
    return 'ok';
  } catch (err) {
    log.warn({ err }, 'Redis health check failed');
    return 'error';
  }
}

export function createHealthRoutes(db: Database) {
  const app = new Hono();

  // Full health check with component status
  app.get('/health', async (c) => {
    const [database, redis] = await Promise.all([
      checkDatabase(db),
      checkRedis(),
    ]);

    const components = { database, redis };
    const allOk = database === 'ok' && redis === 'ok';
    const allDown = database === 'error' && redis === 'error';

    let status: HealthResponse['status'];
    if (allOk) {
      status = 'ok';
    } else if (allDown) {
      status = 'unhealthy';
    } else {
      status = 'degraded';
    }

    const response: HealthResponse = {
      status,
      version: '0.1.0',
      components,
    };

    const httpStatus = status === 'unhealthy' ? 503 : 200;
    return c.json(response, httpStatus);
  });

  // Readiness probe for Kubernetes -- only returns 200 when ALL components are up
  app.get('/ready', async (c) => {
    const [database, redis] = await Promise.all([
      checkDatabase(db),
      checkRedis(),
    ]);

    if (database === 'ok' && redis === 'ok') {
      return c.json({ ready: true }, 200);
    }

    return c.json({
      ready: false,
      components: { database, redis },
    }, 503);
  });

  return app;
}
