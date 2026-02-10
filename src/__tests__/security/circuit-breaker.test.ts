import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker, CircuitBreakerOpenError } from '../../security/circuit-breaker.js';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    // Each test gets a unique name to avoid registry collisions
    breaker = new CircuitBreaker(`test-${Date.now()}-${Math.random()}`, {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      halfOpenMaxAttempts: 2,
    });
  });

  describe('CLOSED state (normal operation)', () => {
    it('executes successfully', async () => {
      const result = await breaker.execute(() => Promise.resolve('ok'));
      expect(result).toBe('ok');
      expect(breaker.getStatus().state).toBe('CLOSED');
    });

    it('passes through errors without opening circuit below threshold', async () => {
      const error = new Error('api down');
      await expect(breaker.execute(() => Promise.reject(error))).rejects.toThrow('api down');
      await expect(breaker.execute(() => Promise.reject(error))).rejects.toThrow('api down');

      expect(breaker.getStatus().state).toBe('CLOSED');
      expect(breaker.getStatus().failureCount).toBe(2);
    });

    it('resets failure count on success', async () => {
      const error = new Error('temporary');
      await expect(breaker.execute(() => Promise.reject(error))).rejects.toThrow();
      await expect(breaker.execute(() => Promise.reject(error))).rejects.toThrow();

      // Success resets the counter
      await breaker.execute(() => Promise.resolve('ok'));
      expect(breaker.getStatus().failureCount).toBe(0);
    });
  });

  describe('CLOSED -> OPEN transition', () => {
    it('opens after reaching failure threshold', async () => {
      const error = new Error('service unavailable');

      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(() => Promise.reject(error))).rejects.toThrow();
      }

      expect(breaker.getStatus().state).toBe('OPEN');
    });

    it('rejects calls immediately when OPEN', async () => {
      const error = new Error('service unavailable');

      // Trip the breaker
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(() => Promise.reject(error))).rejects.toThrow();
      }

      // Now it should reject without calling the function
      const fn = vi.fn(() => Promise.resolve('should not run'));
      await expect(breaker.execute(fn)).rejects.toThrow(CircuitBreakerOpenError);
      expect(fn).not.toHaveBeenCalled();
    });

    it('CircuitBreakerOpenError has breaker name', async () => {
      const name = `named-${Date.now()}`;
      const namedBreaker = new CircuitBreaker(name, { failureThreshold: 1, resetTimeoutMs: 60_000 });

      await expect(namedBreaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      try {
        await namedBreaker.execute(() => Promise.resolve());
      } catch (err) {
        expect(err).toBeInstanceOf(CircuitBreakerOpenError);
        expect((err as CircuitBreakerOpenError).breakerName).toBe(name);
      }
    });
  });

  describe('OPEN -> HALF_OPEN transition', () => {
    it('transitions to HALF_OPEN after reset timeout', async () => {
      const quickBreaker = new CircuitBreaker(`quick-${Date.now()}`, {
        failureThreshold: 1,
        resetTimeoutMs: 50, // 50ms for testing
        halfOpenMaxAttempts: 2,
      });

      // Trip it
      await expect(quickBreaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      expect(quickBreaker.getStatus().state).toBe('OPEN');

      // Wait for reset timeout
      await new Promise((r) => setTimeout(r, 60));

      // Next call should go through (half-open)
      await quickBreaker.execute(() => Promise.resolve('test'));
      expect(quickBreaker.getStatus().state).toBe('HALF_OPEN');
    });
  });

  describe('HALF_OPEN -> CLOSED transition', () => {
    it('closes after enough successful calls in HALF_OPEN', async () => {
      const quickBreaker = new CircuitBreaker(`close-${Date.now()}`, {
        failureThreshold: 1,
        resetTimeoutMs: 50,
        halfOpenMaxAttempts: 2,
      });

      // Trip it
      await expect(quickBreaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      // Wait for reset
      await new Promise((r) => setTimeout(r, 60));

      // Two successes should close the circuit
      await quickBreaker.execute(() => Promise.resolve('ok'));
      expect(quickBreaker.getStatus().state).toBe('HALF_OPEN');

      await quickBreaker.execute(() => Promise.resolve('ok'));
      expect(quickBreaker.getStatus().state).toBe('CLOSED');
    });
  });

  describe('HALF_OPEN -> OPEN transition', () => {
    it('re-opens on any failure in HALF_OPEN', async () => {
      const quickBreaker = new CircuitBreaker(`reopen-${Date.now()}`, {
        failureThreshold: 1,
        resetTimeoutMs: 50,
        halfOpenMaxAttempts: 3,
      });

      // Trip it
      await expect(quickBreaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      // Wait for reset
      await new Promise((r) => setTimeout(r, 60));

      // One success to enter HALF_OPEN
      await quickBreaker.execute(() => Promise.resolve('ok'));
      expect(quickBreaker.getStatus().state).toBe('HALF_OPEN');

      // Failure should re-open
      await expect(quickBreaker.execute(() => Promise.reject(new Error('still broken')))).rejects.toThrow();
      expect(quickBreaker.getStatus().state).toBe('OPEN');
    });
  });

  describe('getStatus', () => {
    it('returns correct status shape', () => {
      const status = breaker.getStatus();
      expect(status).toHaveProperty('name');
      expect(status).toHaveProperty('state');
      expect(status).toHaveProperty('failureCount');
      expect(status).toHaveProperty('successCount');
      expect(status).toHaveProperty('lastFailureTime');
      expect(status).toHaveProperty('options');
      expect(status.state).toBe('CLOSED');
      expect(status.failureCount).toBe(0);
      expect(status.lastFailureTime).toBeNull();
    });

    it('tracks lastFailureTime', async () => {
      await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      const status = breaker.getStatus();
      expect(status.lastFailureTime).not.toBeNull();
    });
  });

  describe('reset', () => {
    it('manually resets breaker to CLOSED', async () => {
      const error = new Error('fail');
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(() => Promise.reject(error))).rejects.toThrow();
      }
      expect(breaker.getStatus().state).toBe('OPEN');

      breaker.reset();
      expect(breaker.getStatus().state).toBe('CLOSED');
      expect(breaker.getStatus().failureCount).toBe(0);

      // Should work again
      const result = await breaker.execute(() => Promise.resolve('recovered'));
      expect(result).toBe('recovered');
    });
  });

  describe('registry', () => {
    it('getAllStatuses returns registered breakers', () => {
      const statuses = CircuitBreaker.getAllStatuses();
      expect(Array.isArray(statuses)).toBe(true);
      expect(statuses.length).toBeGreaterThan(0);
    });

    it('getAll returns Map of breakers', () => {
      const all = CircuitBreaker.getAll();
      expect(all).toBeInstanceOf(Map);
    });
  });
});
