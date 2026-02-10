import pino from 'pino';

/**
 * Pino redaction paths — prevents PII and secrets from leaking into logs.
 *
 * Paths use Pino's dot-notation syntax. Wildcards (*) match any key at that
 * depth, so `*.email` covers `{ user: { email: '...' } }` etc.
 */
const REDACT_PATHS = [
  // Direct top-level fields
  'email',
  'customer_email',
  'receipt_email',
  'customer_name',
  'name',
  'billing_details',
  'shipping',
  'apiKey',
  'api_key',
  'secret',
  'password',
  'token',
  'credit_card',
  'card_number',
  'privateKey',
  'private_key',

  // Nested under any single parent (e.g., data.email, err.customer_email)
  '*.email',
  '*.customer_email',
  '*.receipt_email',
  '*.customer_name',
  '*.name',
  '*.billing_details',
  '*.shipping',
  '*.apiKey',
  '*.api_key',
  '*.secret',
  '*.password',
  '*.token',
  '*.credit_card',
  '*.card_number',
  '*.privateKey',
  '*.private_key',

  // Two levels deep (e.g., err.data.customer_email)
  '*.*.email',
  '*.*.customer_email',
  '*.*.receipt_email',
  '*.*.customer_name',
  '*.*.name',
  '*.*.billing_details',
  '*.*.shipping',
  '*.*.apiKey',
  '*.*.api_key',
  '*.*.secret',
  '*.*.password',
  '*.*.token',
  '*.*.credit_card',
  '*.*.card_number',
  '*.*.privateKey',
  '*.*.private_key',
];

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

export function createChildLogger(name: string) {
  return logger.child({ component: name });
}
