import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Generate a new webhook signing secret.
 * Format: whsec_<64 hex characters>
 */
export function generateSigningSecret(): string {
  return `whsec_${randomBytes(32).toString('hex')}`;
}

/**
 * Sign a webhook payload using HMAC-SHA256.
 *
 * Returns a signature header value and the timestamp used.
 * Format: t=<unix_seconds>,v1=<hex_hmac>
 */
export function signWebhookPayload(
  payload: string,
  secret: string,
  timestamp?: number,
): { signature: string; timestamp: number } {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const signedContent = `${ts}.${payload}`;
  const rawSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const hmac = createHmac('sha256', rawSecret).update(signedContent).digest('hex');
  return {
    signature: `t=${ts},v1=${hmac}`,
    timestamp: ts,
  };
}

/**
 * Verify a webhook signature.
 *
 * @param payload - The raw request body string
 * @param signatureHeader - The X-RevBack-Signature header value
 * @param secret - The signing secret
 * @param toleranceSeconds - Max age of the signature (default 300s / 5 minutes)
 */
export function verifyWebhookSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
  toleranceSeconds = 300,
): boolean {
  // Parse signature header: t=<timestamp>,v1=<hmac>
  const parts: Record<string, string> = {};
  for (const part of signatureHeader.split(',')) {
    const [key, value] = part.split('=', 2);
    if (key && value) parts[key] = value;
  }

  const ts = parseInt(parts.t, 10);
  const v1 = parts.v1;

  if (!ts || !v1) return false;

  // Check replay tolerance
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > toleranceSeconds) return false;

  // Compute expected signature
  const signedContent = `${ts}.${payload}`;
  const rawSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const expected = createHmac('sha256', rawSecret).update(signedContent).digest('hex');

  // Constant-time comparison
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(v1, 'hex');
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
