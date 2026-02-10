import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleNormalizer } from '../../ingestion/providers/google.js';
import type { RawWebhookEvent } from '../../models/types.js';
import {
  createGooglePubSubMessage,
  createGoogleSubscriptionDetails,
  createGoogleVoidedPurchaseNotification,
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

// Mock the circuit breaker
vi.mock('../../security/circuit-breaker.js', () => ({
  CircuitBreaker: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockImplementation((fn: () => any) => fn()),
    getState: vi.fn().mockReturnValue('CLOSED'),
  })),
}));

describe('GoogleNormalizer', () => {
  let normalizer: GoogleNormalizer;
  const orgId = 'org_test_001';

  beforeEach(() => {
    normalizer = new GoogleNormalizer();
  });

  describe('source', () => {
    it('should identify as google', () => {
      expect(normalizer.source).toBe('google');
    });
  });

  // ─── Subscription Notification Mapping ────────────────────────────

  describe('normalize — subscription notifications', () => {
    const subscriptionNotificationTests: Array<{
      name: string;
      type: number;
      expectedEventType: string;
      expectedStatus: string;
    }> = [
      { name: 'RECOVERED (1)', type: 1, expectedEventType: 'renewal', expectedStatus: 'success' },
      { name: 'RENEWED (2)', type: 2, expectedEventType: 'renewal', expectedStatus: 'success' },
      { name: 'CANCELED (3)', type: 3, expectedEventType: 'cancellation', expectedStatus: 'success' },
      { name: 'PURCHASED (4)', type: 4, expectedEventType: 'purchase', expectedStatus: 'success' },
      { name: 'ON_HOLD (5)', type: 5, expectedEventType: 'billing_retry', expectedStatus: 'failed' },
      { name: 'IN_GRACE_PERIOD (6)', type: 6, expectedEventType: 'grace_period_start', expectedStatus: 'pending' },
      { name: 'RESTARTED (7)', type: 7, expectedEventType: 'resume', expectedStatus: 'success' },
      { name: 'PRICE_CHANGE_CONFIRMED (8)', type: 8, expectedEventType: 'price_change', expectedStatus: 'success' },
      { name: 'PAUSED (10)', type: 10, expectedEventType: 'pause', expectedStatus: 'success' },
      { name: 'REVOKED (12)', type: 12, expectedEventType: 'revoke', expectedStatus: 'success' },
      { name: 'EXPIRED (13)', type: 13, expectedEventType: 'expiration', expectedStatus: 'success' },
    ];

    for (const test of subscriptionNotificationTests) {
      it(`should map ${test.name} to ${test.expectedEventType}/${test.expectedStatus}`, async () => {
        const pubSubMsg = createGooglePubSubMessage('subscription', {
          subscriptionNotificationType: test.type,
        });
        const rawEvent = createRawWebhookEvent('google', JSON.stringify(pubSubMsg));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe(test.expectedEventType);
        expect(events[0].status).toBe(test.expectedStatus);
        expect(events[0].source).toBe('google');
        expect(events[0].orgId).toBe(orgId);
      });
    }

    it('should skip DEFERRED (9)', async () => {
      const pubSubMsg = createGooglePubSubMessage('subscription', {
        subscriptionNotificationType: 9,
      });
      const rawEvent = createRawWebhookEvent('google', JSON.stringify(pubSubMsg));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events).toHaveLength(0);
    });

    it('should skip PAUSE_SCHEDULE_CHANGED (11)', async () => {
      const pubSubMsg = createGooglePubSubMessage('subscription', {
        subscriptionNotificationType: 11,
      });
      const rawEvent = createRawWebhookEvent('google', JSON.stringify(pubSubMsg));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events).toHaveLength(0);
    });

    it('should return empty for unknown notification type', async () => {
      const pubSubMsg = createGooglePubSubMessage('subscription', {
        subscriptionNotificationType: 99,
      });
      const rawEvent = createRawWebhookEvent('google', JSON.stringify(pubSubMsg));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events).toHaveLength(0);
    });

    it('should set correct idempotency key from message ID', async () => {
      const pubSubMsg = createGooglePubSubMessage('subscription', {
        messageId: 'msg_unique_123',
      });
      const rawEvent = createRawWebhookEvent('google', JSON.stringify(pubSubMsg));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events[0].idempotencyKey).toBe('google:msg_unique_123');
    });

    it('should use purchase token as external subscription ID', async () => {
      const pubSubMsg = createGooglePubSubMessage('subscription', {
        purchaseToken: 'token_abc_xyz',
      });
      const rawEvent = createRawWebhookEvent('google', JSON.stringify(pubSubMsg));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events[0].externalSubscriptionId).toBe('token_abc_xyz');
    });

    it('should parse eventTimeMillis to Date correctly', async () => {
      const eventTime = new Date('2025-03-20T15:30:00Z');
      const pubSubMsg = createGooglePubSubMessage('subscription', {
        notification: {
          version: '1.0',
          packageName: 'com.example.app',
          eventTimeMillis: String(eventTime.getTime()),
          subscriptionNotification: {
            version: '1.0',
            notificationType: 4,
            purchaseToken: 'token_001',
            subscriptionId: 'premium_monthly',
          },
        },
      });
      const rawEvent = createRawWebhookEvent('google', JSON.stringify(pubSubMsg));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events[0].eventTime.getTime()).toBe(eventTime.getTime());
    });

    it('should set planTier from subscriptionId when no API enrichment', async () => {
      const pubSubMsg = createGooglePubSubMessage('subscription', {
        subscriptionId: 'pro_annual',
      });
      const rawEvent = createRawWebhookEvent('google', JSON.stringify(pubSubMsg));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events[0].planTier).toBe('pro_annual');
    });

    it('should preserve raw payload with notification data', async () => {
      const pubSubMsg = createGooglePubSubMessage('subscription');
      const rawEvent = createRawWebhookEvent('google', JSON.stringify(pubSubMsg));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events[0].rawPayload).toBeDefined();
      expect((events[0].rawPayload as any).notification).toBeDefined();
      expect((events[0].rawPayload as any).notification.packageName).toBe('com.example.app');
    });
  });

  // ─── Voided Purchase Notifications ────────────────────────────────

  describe('normalize — voided purchase notifications', () => {
    it('should normalize refundType=1 as refund', async () => {
      const pubSubMsg = createGoogleVoidedPurchaseNotification(1);
      const rawEvent = createRawWebhookEvent('google', JSON.stringify(pubSubMsg));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('refund');
      expect(events[0].status).toBe('refunded');
      expect(events[0].source).toBe('google');
    });

    it('should normalize refundType!=1 as chargeback', async () => {
      const pubSubMsg = createGoogleVoidedPurchaseNotification(2);
      const rawEvent = createRawWebhookEvent('google', JSON.stringify(pubSubMsg));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('chargeback');
      expect(events[0].status).toBe('refunded');
    });

    it('should normalize undefined refundType as chargeback', async () => {
      const pubSubMsg = createGooglePubSubMessage('voided', {
        voidedPurchase: { refundType: undefined },
      });
      const rawEvent = createRawWebhookEvent('google', JSON.stringify(pubSubMsg));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('chargeback');
    });

    it('should use orderId for idempotency key', async () => {
      const pubSubMsg = createGoogleVoidedPurchaseNotification(1, {
        orderId: 'GPA.ORDER.123',
      });
      const rawEvent = createRawWebhookEvent('google', JSON.stringify(pubSubMsg));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events[0].idempotencyKey).toBe('google:voided:GPA.ORDER.123');
    });

    it('should extract purchase_token identity hint from voided notification', async () => {
      const pubSubMsg = createGoogleVoidedPurchaseNotification(1, {
        purchaseToken: 'voided_token_xyz',
      });
      const rawEvent = createRawWebhookEvent('google', JSON.stringify(pubSubMsg));

      const events = await normalizer.normalize(orgId, rawEvent);

      const tokenHint = events[0].identityHints.find(h => h.idType === 'purchase_token');
      expect(tokenHint).toBeDefined();
      expect(tokenHint!.externalId).toBe('voided_token_xyz');
    });
  });

  // ─── One-Time Product Notifications ───────────────────────────────

  describe('normalize — one-time product notifications', () => {
    it('should normalize one-time purchase (type 1) to purchase event', async () => {
      const pubSubMsg = createGooglePubSubMessage('oneTime', {
        oneTimeNotificationType: 1,
        sku: 'coin_pack_500',
      });
      const rawEvent = createRawWebhookEvent('google', JSON.stringify(pubSubMsg));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('purchase');
      expect(events[0].status).toBe('success');
      expect(events[0].planTier).toBe('coin_pack_500');
    });

    it('should normalize one-time cancellation (type 2) to cancellation event', async () => {
      const pubSubMsg = createGooglePubSubMessage('oneTime', {
        oneTimeNotificationType: 2,
      });
      const rawEvent = createRawWebhookEvent('google', JSON.stringify(pubSubMsg));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('cancellation');
      expect(events[0].status).toBe('success');
    });

    it('should skip unknown one-time notification types', async () => {
      const pubSubMsg = createGooglePubSubMessage('oneTime', {
        oneTimeNotificationType: 99,
      });
      const rawEvent = createRawWebhookEvent('google', JSON.stringify(pubSubMsg));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events).toHaveLength(0);
    });
  });

  // ─── Test Notifications ───────────────────────────────────────────

  describe('normalize — test notifications', () => {
    it('should skip test notifications', async () => {
      const pubSubMsg = createGooglePubSubMessage('test');
      const rawEvent = createRawWebhookEvent('google', JSON.stringify(pubSubMsg));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events).toHaveLength(0);
    });
  });

  // ─── Identity Hints ──────────────────────────────────────────────

  describe('extractIdentityHints', () => {
    it('should extract purchase_token', () => {
      const hints = normalizer.extractIdentityHints({
        purchaseToken: 'google_token_abc',
      });

      expect(hints).toHaveLength(1);
      expect(hints[0]).toEqual({
        source: 'google',
        idType: 'purchase_token',
        externalId: 'google_token_abc',
      });
    });

    it('should extract app_user_id from obfuscatedExternalAccountId', () => {
      const hints = normalizer.extractIdentityHints({
        purchaseToken: 'token_abc',
        obfuscatedExternalAccountId: 'user_ext_456',
      });

      expect(hints).toHaveLength(2);
      const appUserHint = hints.find(h => h.idType === 'app_user_id');
      expect(appUserHint).toEqual({
        source: 'google',
        idType: 'app_user_id',
        externalId: 'user_ext_456',
      });
    });

    it('should extract linked_purchase_token for upgrade/downgrade chains', () => {
      const hints = normalizer.extractIdentityHints({
        purchaseToken: 'token_new',
        linkedPurchaseToken: 'token_old',
      });

      expect(hints).toHaveLength(2);
      const linkedHint = hints.find(h => h.idType === 'linked_purchase_token');
      expect(linkedHint).toEqual({
        source: 'google',
        idType: 'linked_purchase_token',
        externalId: 'token_old',
      });
    });

    it('should extract all identity hints together', () => {
      const hints = normalizer.extractIdentityHints({
        purchaseToken: 'token_1',
        obfuscatedExternalAccountId: 'user_ext_1',
        linkedPurchaseToken: 'token_old_1',
      });

      expect(hints).toHaveLength(3);
    });

    it('should return empty array when no identifiers present', () => {
      const hints = normalizer.extractIdentityHints({});

      expect(hints).toHaveLength(0);
    });
  });

  // ─── Signature Verification ───────────────────────────────────────

  describe('verifySignature', () => {
    it('should return false when Authorization header is missing', async () => {
      const rawEvent: RawWebhookEvent = {
        source: 'google',
        headers: {},
        body: '{}',
        receivedAt: new Date(),
      };

      const result = await normalizer.verifySignature(rawEvent, 'https://example.com/webhook');

      expect(result).toBe(false);
    });

    it('should return false when Authorization header is not Bearer', async () => {
      const rawEvent: RawWebhookEvent = {
        source: 'google',
        headers: { 'authorization': 'Basic abc123' },
        body: '{}',
        receivedAt: new Date(),
      };

      const result = await normalizer.verifySignature(rawEvent, 'https://example.com/webhook');

      expect(result).toBe(false);
    });

    it('should return false for invalid JWT token', async () => {
      const rawEvent: RawWebhookEvent = {
        source: 'google',
        headers: { 'authorization': 'Bearer invalid.jwt.token' },
        body: '{}',
        receivedAt: new Date(),
      };

      const result = await normalizer.verifySignature(rawEvent, 'https://example.com/webhook');

      expect(result).toBe(false);
    });

    it('should handle Authorization with capital A', async () => {
      const rawEvent: RawWebhookEvent = {
        source: 'google',
        headers: { 'Authorization': 'Basic abc123' },
        body: '{}',
        receivedAt: new Date(),
      };

      const result = await normalizer.verifySignature(rawEvent, 'https://example.com/webhook');

      expect(result).toBe(false);
    });
  });

  // ─── API Enrichment Graceful Degradation ──────────────────────────

  describe('API enrichment graceful degradation', () => {
    it('should still produce events when no credentials are set (no API enrichment)', async () => {
      // normalizer has no credentials set
      const pubSubMsg = createGooglePubSubMessage('subscription', {
        subscriptionNotificationType: 4, // PURCHASED
        subscriptionId: 'premium_monthly',
      });
      const rawEvent = createRawWebhookEvent('google', JSON.stringify(pubSubMsg));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('purchase');
      expect(events[0].planTier).toBe('premium_monthly');
      // subscriptionDetails should be null when no credentials
      expect((events[0].rawPayload as any).subscriptionDetails).toBeNull();
    });
  });

  // ─── Base64 Decoding ──────────────────────────────────────────────

  describe('base64 decoding', () => {
    it('should correctly decode base64 Pub/Sub message data', async () => {
      const notification = {
        version: '1.0',
        packageName: 'com.test.myapp',
        eventTimeMillis: String(new Date('2025-06-01T10:00:00Z').getTime()),
        subscriptionNotification: {
          version: '1.0',
          notificationType: 4,
          purchaseToken: 'direct_token_test',
          subscriptionId: 'basic_plan',
        },
      };

      const message = {
        message: {
          data: Buffer.from(JSON.stringify(notification)).toString('base64'),
          messageId: 'msg_direct_test',
          publishTime: '2025-06-01T10:00:00.000Z',
        },
        subscription: 'projects/test/subscriptions/play',
      };

      const rawEvent = createRawWebhookEvent('google', JSON.stringify(message));
      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('purchase');
      expect(events[0].externalSubscriptionId).toBe('direct_token_test');
    });
  });

  // ─── Malformed Payloads ───────────────────────────────────────────

  describe('malformed payloads', () => {
    it('should throw on invalid JSON body', async () => {
      const rawEvent = createRawWebhookEvent('google', 'not-valid-json');

      await expect(normalizer.normalize(orgId, rawEvent)).rejects.toThrow();
    });

    it('should throw on invalid base64 data', async () => {
      const message = {
        message: {
          data: '!!!invalid_base64!!!',
          messageId: 'msg_bad',
          publishTime: '2025-01-01T00:00:00Z',
        },
        subscription: 'projects/test/subscriptions/play',
      };
      const rawEvent = createRawWebhookEvent('google', JSON.stringify(message));

      await expect(normalizer.normalize(orgId, rawEvent)).rejects.toThrow();
    });

    it('should return empty for notification with no sub-notification fields', async () => {
      const notification = {
        version: '1.0',
        packageName: 'com.example.app',
        eventTimeMillis: String(Date.now()),
      };
      const message = {
        message: {
          data: Buffer.from(JSON.stringify(notification)).toString('base64'),
          messageId: 'msg_empty',
          publishTime: '2025-01-01T00:00:00Z',
        },
        subscription: 'projects/test/subscriptions/play',
      };
      const rawEvent = createRawWebhookEvent('google', JSON.stringify(message));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events).toHaveLength(0);
    });
  });

  // ─── setCredentials ───────────────────────────────────────────────

  describe('setCredentials', () => {
    it('should accept service account credentials', () => {
      expect(() => {
        normalizer.setCredentials(
          'test@project.iam.gserviceaccount.com',
          '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
          'com.example.app',
        );
      }).not.toThrow();
    });
  });
});
