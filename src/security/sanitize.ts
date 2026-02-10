/**
 * Sanitize webhook payloads and headers before database storage.
 * Full payloads stay in memory for signature verification;
 * sanitized versions go to the database.
 */

const STRIPE_PII_FIELDS = [
  'customer_email',
  'customer_name',
  'receipt_email',
  'billing_details',
  'shipping',
];

/**
 * Strip PII fields from a billing provider payload before storage.
 * Returns a deep copy — does not mutate the original.
 */
export function sanitizePayload(
  source: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (source !== 'stripe') return payload; // Only Stripe sanitization for now

  const sanitized = structuredClone(payload);
  const dataObj = sanitized.data as Record<string, unknown> | undefined;
  if (!dataObj) return sanitized;

  const obj = dataObj.object as Record<string, unknown> | undefined;
  if (!obj) return sanitized;

  for (const field of STRIPE_PII_FIELDS) {
    if (field in obj) {
      obj[field] = '[REDACTED]';
    }
  }

  // Also check nested customer object
  const customer = obj.customer as Record<string, unknown> | undefined;
  if (customer && typeof customer === 'object') {
    for (const field of ['email', 'name', 'phone', 'address']) {
      if (field in customer) {
        customer[field] = '[REDACTED]';
      }
    }
  }

  return sanitized;
}

const ALLOWED_HEADERS = new Set([
  'stripe-signature',
  'content-type',
  'content-length',
  'user-agent',
]);

/**
 * Strip sensitive headers, keeping only what's needed for debugging.
 */
export function sanitizeHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (ALLOWED_HEADERS.has(key.toLowerCase())) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
