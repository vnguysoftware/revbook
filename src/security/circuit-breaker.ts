import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('circuit-breaker');

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreakerOpenError extends Error {
  constructor(public readonly breakerName: string) {
    super(`Circuit breaker "${breakerName}" is OPEN — request rejected`);
    this.name = 'CircuitBreakerOpenError';
  }
}

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. Default: 5 */
  failureThreshold?: number;
  /** Milliseconds to wait before transitioning from OPEN to HALF_OPEN. Default: 60000 (60s) */
  resetTimeoutMs?: number;
  /** Max successful calls in HALF_OPEN state before closing the circuit. Default: 3 */
  halfOpenMaxAttempts?: number;
}

const DEFAULTS: Required<CircuitBreakerOptions> = {
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
  halfOpenMaxAttempts: 3,
};

/** Global registry so we can list all breakers from an admin endpoint. */
const registry = new Map<string, CircuitBreaker>();

export class CircuitBreaker {
  readonly name: string;
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private readonly opts: Required<CircuitBreakerOptions>;

  constructor(name: string, options?: CircuitBreakerOptions) {
    this.name = name;
    this.opts = { ...DEFAULTS, ...options };
    registry.set(name, this);
  }

  /** Execute a function through the circuit breaker. */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      // Check if enough time has passed to try half-open
      if (this.lastFailureTime && Date.now() - this.lastFailureTime >= this.opts.resetTimeoutMs) {
        this.transitionTo('HALF_OPEN');
      } else {
        throw new CircuitBreakerOpenError(this.name);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.opts.halfOpenMaxAttempts) {
        this.transitionTo('CLOSED');
      }
    } else if (this.state === 'CLOSED') {
      // Reset failure count on success
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      // Any failure in half-open immediately re-opens
      this.transitionTo('OPEN');
      return;
    }

    // CLOSED state
    this.failureCount++;
    if (this.failureCount >= this.opts.failureThreshold) {
      this.transitionTo('OPEN');
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;

    log.info({ breaker: this.name, from: oldState, to: newState }, 'Circuit breaker state transition');

    if (newState === 'CLOSED') {
      this.failureCount = 0;
      this.successCount = 0;
    } else if (newState === 'HALF_OPEN') {
      this.successCount = 0;
    } else if (newState === 'OPEN') {
      this.successCount = 0;
    }
  }

  /** Get current state for monitoring. */
  getStatus(): {
    name: string;
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureTime: string | null;
    options: Required<CircuitBreakerOptions>;
  } {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : null,
      options: { ...this.opts },
    };
  }

  /** Manually reset the breaker to CLOSED (for admin use). */
  reset(): void {
    this.transitionTo('CLOSED');
    this.lastFailureTime = null;
  }

  /** Get all registered circuit breakers. */
  static getAll(): Map<string, CircuitBreaker> {
    return registry;
  }

  /** Get all breaker statuses as a plain array. */
  static getAllStatuses(): ReturnType<CircuitBreaker['getStatus']>[] {
    return Array.from(registry.values()).map((b) => b.getStatus());
  }
}
