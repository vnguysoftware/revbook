import { Hono } from 'hono';
import { CircuitBreaker } from '../security/circuit-breaker.js';

export function createCircuitBreakerRoutes() {
  const app = new Hono();

  app.get('/', (c) => {
    return c.json({ breakers: CircuitBreaker.getAllStatuses() });
  });

  return app;
}
