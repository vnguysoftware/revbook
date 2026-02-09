import { createHmac, timingSafeEqual } from 'crypto';
import type { Context, Next } from 'hono';
import { getEnv } from '../config/env.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('slack-verify');

/**
 * Slack request signature verification middleware.
 * Verifies HMAC-SHA256 signature using the Slack signing secret.
 * See: https://api.slack.com/authentication/verifying-requests-from-slack
 */
export async function verifySlackSignature(c: Context, next: Next) {
  const env = getEnv();
  const signingSecret = env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    log.error('SLACK_SIGNING_SECRET not configured');
    return c.json({ error: 'Slack integration not configured' }, 500);
  }

  const timestamp = c.req.header('x-slack-request-timestamp');
  const signature = c.req.header('x-slack-signature');

  if (!timestamp || !signature) {
    log.warn('Missing Slack signature headers');
    return c.json({ error: 'Missing signature' }, 401);
  }

  // Reject requests older than 5 minutes to prevent replay attacks
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) {
    log.warn({ timestamp, now }, 'Slack request timestamp too old');
    return c.json({ error: 'Request too old' }, 401);
  }

  // Read raw body for signature verification
  const body = await c.req.text();

  const sigBasestring = `v0:${timestamp}:${body}`;
  const hmac = createHmac('sha256', signingSecret);
  hmac.update(sigBasestring);
  const computed = `v0=${hmac.digest('hex')}`;

  const computedBuf = Buffer.from(computed);
  const signatureBuf = Buffer.from(signature);

  if (computedBuf.length !== signatureBuf.length || !timingSafeEqual(computedBuf, signatureBuf)) {
    log.warn('Slack signature verification failed');
    return c.json({ error: 'Invalid signature' }, 401);
  }

  // Store the parsed body for downstream handlers to avoid re-reading
  c.set('rawBody', body);

  await next();
}
