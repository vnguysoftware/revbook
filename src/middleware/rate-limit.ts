import { createMiddleware } from 'hono/factory';
import { TokenBucketRateLimiter } from '../queue/rate-limiter.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('rate-limit');

type RateLimitTier = 'api' | 'webhook' | 'public';

const TIER_CONFIGS: Record<RateLimitTier, { maxTokens: number; refillRate: number; refillIntervalMs: number }> = {
  api: { maxTokens: 100, refillRate: 100, refillIntervalMs: 60_000 },
  webhook: { maxTokens: 500, refillRate: 500, refillIntervalMs: 60_000 },
  public: { maxTokens: 30, refillRate: 30, refillIntervalMs: 60_000 },
};

const limiterCache = new Map<string, TokenBucketRateLimiter>();

function getLimiter(tier: RateLimitTier, key: string): TokenBucketRateLimiter {
  const cacheKey = `${tier}:${key}`;
  let limiter = limiterCache.get(cacheKey);
  if (!limiter) {
    const config = TIER_CONFIGS[tier];
    limiter = new TokenBucketRateLimiter({
      name: `http-${tier}:${key}`,
      ...config,
    });
    limiterCache.set(cacheKey, limiter);
  }
  return limiter;
}

function extractKey(tier: RateLimitTier, c: Parameters<Parameters<typeof createMiddleware>[0]>[0]): string {
  switch (tier) {
    case 'api': {
      const auth = c.get('auth' as never) as { orgId: string } | undefined;
      return auth?.orgId ?? 'unknown';
    }
    case 'webhook': {
      // URL pattern: /webhooks/:orgSlug/stripe or /webhooks/:orgSlug/apple
      const path = c.req.path;
      const parts = path.split('/');
      // e.g. ['', 'webhooks', 'my-org', 'stripe']
      const webhooksIdx = parts.indexOf('webhooks');
      return webhooksIdx >= 0 && parts.length > webhooksIdx + 1
        ? parts[webhooksIdx + 1]
        : 'unknown';
    }
    case 'public': {
      const forwarded = c.req.header('x-forwarded-for');
      return forwarded?.split(',')[0].trim() ?? 'unknown';
    }
  }
}

export function rateLimit(tier: RateLimitTier) {
  return createMiddleware(async (c, next) => {
    try {
      const key = extractKey(tier, c);
      const limiter = getLimiter(tier, key);
      const result = await limiter.tryConsume(1);

      if (!result.allowed) {
        const retryAfterSecs = Math.ceil(result.waitMs / 1000);
        c.header('Retry-After', String(retryAfterSecs));
        return c.json({ error: 'Rate limit exceeded' }, 429);
      }

      c.header('X-RateLimit-Remaining', String(result.remainingTokens));
    } catch (err) {
      // Fail open: if Redis is down, allow the request through
      log.warn({ err, tier }, 'Rate limit check failed, allowing request through');
    }

    await next();
  });
}
