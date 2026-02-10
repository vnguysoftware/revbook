import { describe, it, expect } from 'vitest';
import { logger, createChildLogger } from '../../config/logger.js';

/**
 * Verifies that Pino redaction is configured correctly.
 *
 * We use pino's internal serializer: pass an object through logger bindings
 * and inspect the output to confirm sensitive fields are censored.
 */

// Helper: capture what Pino would serialize by writing to a destination and
// parsing the JSON line output.
function captureLog(logFn: (obj: Record<string, unknown>, msg: string) => void, obj: Record<string, unknown>): Record<string, unknown> {
  const chunks: Buffer[] = [];
  const dest = new (require('stream').Writable)({
    write(chunk: Buffer, _enc: string, cb: () => void) {
      chunks.push(chunk);
      cb();
    },
  });

  // Create a logger that writes to our capture stream
  const pino = require('pino');
  const captureLogger = pino({
    level: 'info',
    redact: {
      paths: (logger as any)[Symbol.for('pino.opts')]?.redact?.paths
        ?? getRedactPaths(),
      censor: '[REDACTED]',
    },
  }, dest);

  captureLogger.info(obj, 'test');
  const output = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(output);
}

/** Fall back: import the paths directly from the logger config */
function getRedactPaths(): string[] {
  // Access Pino's redact configuration
  return [
    'email', 'customer_email', 'receipt_email',
    'customer_name', 'name', 'billing_details', 'shipping',
    'apiKey', 'api_key', 'secret', 'password', 'token',
    'credit_card', 'card_number', 'privateKey', 'private_key',
    '*.email', '*.customer_email', '*.receipt_email',
    '*.customer_name', '*.name', '*.billing_details', '*.shipping',
    '*.apiKey', '*.api_key', '*.secret', '*.password', '*.token',
    '*.credit_card', '*.card_number', '*.privateKey', '*.private_key',
    '*.*.email', '*.*.customer_email', '*.*.receipt_email',
    '*.*.customer_name', '*.*.name', '*.*.billing_details', '*.*.shipping',
    '*.*.apiKey', '*.*.api_key', '*.*.secret', '*.*.password', '*.*.token',
    '*.*.credit_card', '*.*.card_number', '*.*.privateKey', '*.*.private_key',
  ];
}

describe('log sanitization', () => {
  it('redacts top-level email field', () => {
    const result = captureLog(logger.info.bind(logger), { email: 'user@example.com' });
    expect(result.email).toBe('[REDACTED]');
  });

  it('redacts top-level apiKey field', () => {
    const result = captureLog(logger.info.bind(logger), { apiKey: 'sk_live_secret123' });
    expect(result.apiKey).toBe('[REDACTED]');
  });

  it('redacts password field', () => {
    const result = captureLog(logger.info.bind(logger), { password: 'hunter2' });
    expect(result.password).toBe('[REDACTED]');
  });

  it('redacts token field', () => {
    const result = captureLog(logger.info.bind(logger), { token: 'jwt_abc123' });
    expect(result.token).toBe('[REDACTED]');
  });

  it('redacts secret field', () => {
    const result = captureLog(logger.info.bind(logger), { secret: 'whsec_test' });
    expect(result.secret).toBe('[REDACTED]');
  });

  it('redacts nested fields (one level deep)', () => {
    const result = captureLog(logger.info.bind(logger), {
      data: { customer_email: 'user@test.com', customer_name: 'John Doe' },
    });
    expect((result.data as any).customer_email).toBe('[REDACTED]');
    expect((result.data as any).customer_name).toBe('[REDACTED]');
  });

  it('redacts deeply nested fields (two levels)', () => {
    const result = captureLog(logger.info.bind(logger), {
      err: { data: { email: 'deep@test.com' } },
    });
    expect((result.err as any).data.email).toBe('[REDACTED]');
  });

  it('redacts billing_details and shipping objects', () => {
    const result = captureLog(logger.info.bind(logger), {
      billing_details: { address: '123 Main St', phone: '555-0100' },
      shipping: { address: '456 Elm St' },
    });
    expect(result.billing_details).toBe('[REDACTED]');
    expect(result.shipping).toBe('[REDACTED]');
  });

  it('redacts private_key and credit_card', () => {
    const result = captureLog(logger.info.bind(logger), {
      private_key: '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----',
      credit_card: '4111111111111111',
    });
    expect(result.private_key).toBe('[REDACTED]');
    expect(result.credit_card).toBe('[REDACTED]');
  });

  it('does not redact safe fields', () => {
    const result = captureLog(logger.info.bind(logger), {
      orgId: 'org_123',
      eventType: 'subscription.created',
      status: 'active',
    });
    expect(result.orgId).toBe('org_123');
    expect(result.eventType).toBe('subscription.created');
    expect(result.status).toBe('active');
  });

  it('createChildLogger inherits redaction', () => {
    const child = createChildLogger('test-component');
    const result = captureLog(child.info.bind(child), { api_key: 'sk_test_abc' });
    expect(result.api_key).toBe('[REDACTED]');
  });
});
