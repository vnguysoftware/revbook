import type { BillingSource, NormalizedEvent, RawWebhookEvent } from '../../models/types.js';

/**
 * Base interface for all billing source normalizers.
 * Each provider (Stripe, Apple, Google) implements this to convert
 * their proprietary webhook payloads into canonical events.
 */
export interface EventNormalizer {
  source: BillingSource;

  /** Verify the webhook signature is authentic */
  verifySignature(event: RawWebhookEvent, secret: string): Promise<boolean>;

  /** Convert a raw webhook payload into zero or more normalized events */
  normalize(orgId: string, event: RawWebhookEvent): Promise<NormalizedEvent[]>;

  /** Extract identity hints from the raw payload for user resolution */
  extractIdentityHints(payload: Record<string, unknown>): import('../../models/types.js').IdentityHint[];
}

/**
 * Registry of all available normalizers.
 */
const normalizers = new Map<BillingSource, EventNormalizer>();

export function registerNormalizer(normalizer: EventNormalizer) {
  normalizers.set(normalizer.source, normalizer);
}

export function getNormalizer(source: BillingSource): EventNormalizer {
  const normalizer = normalizers.get(source);
  if (!normalizer) {
    throw new Error(`No normalizer registered for source: ${source}`);
  }
  return normalizer;
}

export function getAllNormalizers(): EventNormalizer[] {
  return Array.from(normalizers.values());
}
