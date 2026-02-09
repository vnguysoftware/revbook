import { getRedisConnection } from '../config/queue.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('rate-limiter');

/**
 * Token bucket rate limiter backed by Redis.
 *
 * Uses a Redis-based token bucket algorithm for distributed rate limiting.
 * Designed primarily for Apple API calls (~300 requests/minute undocumented limit).
 *
 * The algorithm:
 * - Each bucket starts with `maxTokens` tokens
 * - Tokens are consumed on each request
 * - Tokens refill at `refillRate` tokens per `refillIntervalMs`
 * - If no tokens available, the request is rejected (or waits)
 */
export class TokenBucketRateLimiter {
  private readonly keyPrefix: string;
  private readonly maxTokens: number;
  private readonly refillRate: number;
  private readonly refillIntervalMs: number;

  constructor(options: {
    /** Unique key prefix for this limiter (e.g., 'apple-api') */
    name: string;
    /** Maximum tokens in the bucket */
    maxTokens: number;
    /** Number of tokens to add per refill interval */
    refillRate: number;
    /** Refill interval in milliseconds */
    refillIntervalMs: number;
  }) {
    this.keyPrefix = `rate-limit:${options.name}`;
    this.maxTokens = options.maxTokens;
    this.refillRate = options.refillRate;
    this.refillIntervalMs = options.refillIntervalMs;
  }

  /**
   * Lua script for atomic token bucket operations.
   * Ensures correctness under concurrent access.
   */
  private static readonly LUA_SCRIPT = `
    local key = KEYS[1]
    local maxTokens = tonumber(ARGV[1])
    local refillRate = tonumber(ARGV[2])
    local refillIntervalMs = tonumber(ARGV[3])
    local now = tonumber(ARGV[4])
    local requested = tonumber(ARGV[5])

    -- Get current state
    local bucket = redis.call('HMGET', key, 'tokens', 'lastRefill')
    local tokens = tonumber(bucket[1])
    local lastRefill = tonumber(bucket[2])

    -- Initialize if new bucket
    if tokens == nil then
      tokens = maxTokens
      lastRefill = now
    end

    -- Calculate tokens to add based on elapsed time
    local elapsed = now - lastRefill
    local intervalsElapsed = math.floor(elapsed / refillIntervalMs)
    if intervalsElapsed > 0 then
      tokens = math.min(maxTokens, tokens + (intervalsElapsed * refillRate))
      lastRefill = lastRefill + (intervalsElapsed * refillIntervalMs)
    end

    -- Try to consume tokens
    local allowed = 0
    local remainingTokens = tokens
    local waitMs = 0

    if tokens >= requested then
      tokens = tokens - requested
      allowed = 1
      remainingTokens = tokens
    else
      -- Calculate how long to wait for enough tokens
      local tokensNeeded = requested - tokens
      local intervalsNeeded = math.ceil(tokensNeeded / refillRate)
      waitMs = intervalsNeeded * refillIntervalMs
    end

    -- Save state
    redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
    redis.call('EXPIRE', key, 300) -- Expire after 5 minutes of inactivity

    return {allowed, remainingTokens, waitMs}
  `;

  /**
   * Try to consume a token. Returns immediately.
   * @returns Object with `allowed` (boolean), `remainingTokens`, and `waitMs` (if not allowed)
   */
  async tryConsume(tokens: number = 1): Promise<{
    allowed: boolean;
    remainingTokens: number;
    waitMs: number;
  }> {
    const redis = getRedisConnection();
    const now = Date.now();

    const result = (await redis.eval(
      TokenBucketRateLimiter.LUA_SCRIPT,
      1,
      this.keyPrefix,
      this.maxTokens,
      this.refillRate,
      this.refillIntervalMs,
      now,
      tokens,
    )) as [number, number, number];

    const [allowed, remainingTokens, waitMs] = result;

    if (!allowed) {
      log.warn({
        limiter: this.keyPrefix,
        remainingTokens,
        waitMs,
      }, 'Rate limit hit');
    }

    return {
      allowed: allowed === 1,
      remainingTokens,
      waitMs,
    };
  }

  /**
   * Consume a token, waiting if necessary.
   * Will retry up to maxWaitMs before throwing.
   */
  async consume(tokens: number = 1, maxWaitMs: number = 30000): Promise<void> {
    let totalWaited = 0;

    while (totalWaited < maxWaitMs) {
      const result = await this.tryConsume(tokens);

      if (result.allowed) {
        return;
      }

      const waitTime = Math.min(result.waitMs, maxWaitMs - totalWaited);
      if (waitTime <= 0) {
        break;
      }

      log.info({
        limiter: this.keyPrefix,
        waitMs: waitTime,
        totalWaited,
      }, 'Waiting for rate limit token');

      await sleep(waitTime);
      totalWaited += waitTime;
    }

    throw new Error(
      `Rate limit exceeded for ${this.keyPrefix}: waited ${totalWaited}ms without getting a token`,
    );
  }

  /**
   * Get current bucket state without consuming tokens.
   */
  async getState(): Promise<{
    tokens: number;
    maxTokens: number;
    refillRate: number;
  }> {
    const redis = getRedisConnection();
    const bucket = await redis.hmget(this.keyPrefix, 'tokens', 'lastRefill');

    let tokens = this.maxTokens;
    if (bucket[0] !== null && bucket[1] !== null) {
      tokens = parseInt(bucket[0]);
      const lastRefill = parseInt(bucket[1]);
      const elapsed = Date.now() - lastRefill;
      const intervalsElapsed = Math.floor(elapsed / this.refillIntervalMs);
      tokens = Math.min(this.maxTokens, tokens + intervalsElapsed * this.refillRate);
    }

    return {
      tokens,
      maxTokens: this.maxTokens,
      refillRate: this.refillRate,
    };
  }
}

// ─── Pre-configured Rate Limiters ────────────────────────────────────

/**
 * Apple API rate limiter.
 * Undocumented limit: ~300 requests/minute.
 * We use 250/minute to leave headroom.
 */
export const appleApiRateLimiter = new TokenBucketRateLimiter({
  name: 'apple-api',
  maxTokens: 250,
  refillRate: 250,
  refillIntervalMs: 60_000, // Refill every minute
});

// ─── Helpers ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
