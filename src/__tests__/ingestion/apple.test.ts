import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppleNormalizer } from '../../ingestion/providers/apple.js';
import {
  createAppleNotificationPayload,
  createRawWebhookEvent,
} from '../helpers.js';

// Mock the logger
vi.mock('../../config/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('AppleNormalizer', () => {
  let normalizer: AppleNormalizer;
  const orgId = 'org_test_apple_001';

  beforeEach(() => {
    normalizer = new AppleNormalizer();
  });

  describe('source', () => {
    it('should identify as apple', () => {
      expect(normalizer.source).toBe('apple');
    });
  });

  describe('normalize', () => {
    // ─── SUBSCRIBED:INITIAL_BUY ────────────────────────────────────
    describe('SUBSCRIBED:INITIAL_BUY', () => {
      it('should normalize to purchase event', async () => {
        const payload = await createAppleNotificationPayload(
          'SUBSCRIBED',
          'INITIAL_BUY',
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('purchase');
        expect(events[0].status).toBe('success');
        expect(events[0].source).toBe('apple');
        expect(events[0].orgId).toBe(orgId);
      });

      it('should set external subscription ID to original_transaction_id', async () => {
        const payload = await createAppleNotificationPayload(
          'SUBSCRIBED',
          'INITIAL_BUY',
          { originalTransactionId: 'orig_txn_custom' },
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events[0].externalSubscriptionId).toBe('orig_txn_custom');
      });

      it('should set idempotency key from notification UUID', async () => {
        const payload = await createAppleNotificationPayload(
          'SUBSCRIBED',
          'INITIAL_BUY',
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events[0].idempotencyKey).toMatch(/^apple:/);
      });
    });

    // ─── SUBSCRIBED:RESUBSCRIBE ────────────────────────────────────
    describe('SUBSCRIBED:RESUBSCRIBE', () => {
      it('should normalize to purchase event', async () => {
        const payload = await createAppleNotificationPayload(
          'SUBSCRIBED',
          'RESUBSCRIBE',
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('purchase');
        expect(events[0].status).toBe('success');
      });
    });

    // ─── DID_RENEW ─────────────────────────────────────────────────
    describe('DID_RENEW', () => {
      it('should normalize to renewal event', async () => {
        const payload = await createAppleNotificationPayload(
          'DID_RENEW',
          undefined,
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('renewal');
        expect(events[0].status).toBe('success');
      });

      it('should normalize BILLING_RECOVERY subtype to renewal', async () => {
        const payload = await createAppleNotificationPayload(
          'DID_RENEW',
          'BILLING_RECOVERY',
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('renewal');
        expect(events[0].status).toBe('success');
      });
    });

    // ─── DID_FAIL_TO_RENEW ─────────────────────────────────────────
    describe('DID_FAIL_TO_RENEW', () => {
      it('should normalize to billing_retry when no grace period', async () => {
        const payload = await createAppleNotificationPayload(
          'DID_FAIL_TO_RENEW',
          undefined,
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('billing_retry');
        expect(events[0].status).toBe('failed');
      });

      it('should normalize to grace_period_start with GRACE_PERIOD subtype', async () => {
        const payload = await createAppleNotificationPayload(
          'DID_FAIL_TO_RENEW',
          'GRACE_PERIOD',
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('grace_period_start');
        expect(events[0].status).toBe('pending');
      });
    });

    // ─── EXPIRED ───────────────────────────────────────────────────
    describe('EXPIRED', () => {
      it('should normalize VOLUNTARY expiration', async () => {
        const payload = await createAppleNotificationPayload(
          'EXPIRED',
          'VOLUNTARY',
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('expiration');
        expect(events[0].status).toBe('success');
      });

      it('should normalize BILLING_RETRY expiration with failed status', async () => {
        const payload = await createAppleNotificationPayload(
          'EXPIRED',
          'BILLING_RETRY',
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('expiration');
        expect(events[0].status).toBe('failed');
      });

      it('should normalize PRICE_INCREASE expiration', async () => {
        const payload = await createAppleNotificationPayload(
          'EXPIRED',
          'PRICE_INCREASE',
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('expiration');
        expect(events[0].status).toBe('success');
      });
    });

    // ─── REFUND ────────────────────────────────────────────────────
    describe('REFUND', () => {
      it('should normalize to refund event', async () => {
        const payload = await createAppleNotificationPayload(
          'REFUND',
          undefined,
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('refund');
        expect(events[0].status).toBe('refunded');
      });
    });

    // ─── REVOKE ────────────────────────────────────────────────────
    describe('REVOKE', () => {
      it('should normalize to revoke event', async () => {
        const payload = await createAppleNotificationPayload(
          'REVOKE',
          undefined,
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('revoke');
        expect(events[0].status).toBe('success');
      });
    });

    // ─── OFFER_REDEEMED ────────────────────────────────────────────
    describe('OFFER_REDEEMED', () => {
      it('should normalize INITIAL_BUY offer redemption', async () => {
        const payload = await createAppleNotificationPayload(
          'OFFER_REDEEMED',
          'INITIAL_BUY',
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('offer_redeemed');
        expect(events[0].status).toBe('success');
      });
    });

    // ─── PRICE_INCREASE ────────────────────────────────────────────
    describe('PRICE_INCREASE', () => {
      it('should normalize price increase pending', async () => {
        const payload = await createAppleNotificationPayload(
          'PRICE_INCREASE',
          'PENDING',
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('price_change');
        expect(events[0].status).toBe('pending');
      });

      it('should normalize price increase accepted', async () => {
        const payload = await createAppleNotificationPayload(
          'PRICE_INCREASE',
          'ACCEPTED',
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('price_change');
        expect(events[0].status).toBe('success');
      });
    });

    // ─── Skipped / test events ─────────────────────────────────────
    describe('skipped events', () => {
      it('should return empty for TEST notification', async () => {
        const payload = await createAppleNotificationPayload(
          'TEST',
          undefined,
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(0);
      });

      it('should return empty for CONSUMPTION_REQUEST', async () => {
        const payload = await createAppleNotificationPayload(
          'CONSUMPTION_REQUEST',
          undefined,
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(0);
      });

      it('should return empty for unmapped notification type', async () => {
        const payload = await createAppleNotificationPayload(
          'COMPLETELY_UNKNOWN_TYPE',
          'MYSTERY_SUBTYPE',
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(0);
      });
    });

    // ─── Financial extraction ──────────────────────────────────────
    describe('financial details', () => {
      it('should extract price in milliunits and convert', async () => {
        const payload = await createAppleNotificationPayload(
          'SUBSCRIBED',
          'INITIAL_BUY',
          { price: 9990, currency: 'USD' },
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        // Apple sends price in milliunits, normalizer multiplies by 1000
        expect(events[0].amountCents).toBe(Math.round(9990 * 1000));
        expect(events[0].currency).toBe('USD');
      });

      it('should handle missing price gracefully', async () => {
        const payload = await createAppleNotificationPayload(
          'DID_RENEW',
          undefined,
          { price: undefined },
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].amountCents).toBeUndefined();
      });
    });

    // ─── Environment detection ─────────────────────────────────────
    describe('environment detection', () => {
      it('should preserve Production environment in raw payload', async () => {
        const payload = await createAppleNotificationPayload(
          'SUBSCRIBED',
          'INITIAL_BUY',
          { environment: 'Production' },
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        const raw = events[0].rawPayload as any;
        expect(raw.notification.data.environment).toBe('Production');
      });

      it('should preserve Sandbox environment in raw payload', async () => {
        const payload = await createAppleNotificationPayload(
          'SUBSCRIBED',
          'INITIAL_BUY',
          { environment: 'Sandbox' },
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        const raw = events[0].rawPayload as any;
        expect(raw.transaction.environment).toBe('Sandbox');
      });
    });

    // ─── Family share detection ────────────────────────────────────
    describe('family share', () => {
      it('should include family share info in raw payload when present', async () => {
        const payload = await createAppleNotificationPayload(
          'SUBSCRIBED',
          'INITIAL_BUY',
          { inAppOwnershipType: 'FAMILY_SHARED' },
        );
        const rawEvent = createRawWebhookEvent(
          'apple',
          JSON.stringify({ signedPayload: payload.signedPayload }),
        );

        const events = await normalizer.normalize(orgId, rawEvent);

        const raw = events[0].rawPayload as any;
        expect(raw.transaction.inAppOwnershipType).toBe('FAMILY_SHARED');
      });
    });
  });

  // ─── extractIdentityHints ────────────────────────────────────────
  describe('extractIdentityHints', () => {
    it('should extract original_transaction_id', () => {
      const payload = {
        transaction: {
          originalTransactionId: 'orig_txn_001',
          bundleId: 'com.app.test',
          productId: 'com.app.premium',
        },
      };

      const hints = normalizer.extractIdentityHints(payload);

      expect(hints.find(h => h.idType === 'original_transaction_id')).toEqual({
        source: 'apple',
        idType: 'original_transaction_id',
        externalId: 'orig_txn_001',
      });
    });

    it('should extract appAccountToken as app_user_id', () => {
      const payload = {
        transaction: {
          originalTransactionId: 'orig_txn_001',
          appAccountToken: 'user_uuid_123',
          bundleId: 'com.app.test',
          productId: 'com.app.premium',
        },
      };

      const hints = normalizer.extractIdentityHints(payload);

      expect(hints.find(h => h.idType === 'app_user_id')).toEqual({
        source: 'apple',
        idType: 'app_user_id',
        externalId: 'user_uuid_123',
      });
    });

    it('should extract bundleId with productId metadata', () => {
      const payload = {
        transaction: {
          originalTransactionId: 'orig_txn_001',
          bundleId: 'com.app.test',
          productId: 'com.app.premium',
        },
      };

      const hints = normalizer.extractIdentityHints(payload);

      const bundleHint = hints.find(h => h.idType === 'bundle_id');
      expect(bundleHint).toBeDefined();
      expect(bundleHint!.externalId).toBe('com.app.test');
      expect(bundleHint!.metadata).toEqual({ productId: 'com.app.premium' });
    });

    it('should return empty array when no transaction data', () => {
      const hints = normalizer.extractIdentityHints({});

      expect(hints).toHaveLength(0);
    });
  });

  // ─── verifySignature ─────────────────────────────────────────────
  describe('verifySignature', () => {
    it('should return false for JWT without x5c certificate chain', async () => {
      const payload = await createAppleNotificationPayload(
        'SUBSCRIBED',
        'INITIAL_BUY',
      );
      const rawEvent = createRawWebhookEvent(
        'apple',
        JSON.stringify({ signedPayload: payload.signedPayload }),
      );

      // Test JWS is signed with HS256 and has no x5c chain,
      // so verifySignature correctly returns false
      const result = await normalizer.verifySignature(rawEvent, '');

      expect(result).toBe(false);
    });

    it('should return false for missing signedPayload', async () => {
      const rawEvent = createRawWebhookEvent(
        'apple',
        JSON.stringify({ something: 'else' }),
      );

      const result = await normalizer.verifySignature(rawEvent, '');

      expect(result).toBe(false);
    });

    it('should return false for invalid JWT', async () => {
      const rawEvent = createRawWebhookEvent(
        'apple',
        JSON.stringify({ signedPayload: 'not-a-jwt' }),
      );

      const result = await normalizer.verifySignature(rawEvent, '');

      expect(result).toBe(false);
    });

    it('should return false for invalid JSON body', async () => {
      const rawEvent = createRawWebhookEvent(
        'apple',
        'not-json',
      );

      const result = await normalizer.verifySignature(rawEvent, '');

      expect(result).toBe(false);
    });
  });
});
