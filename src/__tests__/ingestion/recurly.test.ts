import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import { RecurlyNormalizer } from '../../ingestion/providers/recurly.js';
import type { RawWebhookEvent } from '../../models/types.js';
import {
  createRecurlySubscriptionPayload,
  createRecurlyPaymentPayload,
  createRecurlyRefundPayload,
  createRawWebhookEvent,
} from '../helpers.js';

// Mock the logger to prevent console output during tests
vi.mock('../../config/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('RecurlyNormalizer', () => {
  let normalizer: RecurlyNormalizer;
  const orgId = 'org_test_001';

  beforeEach(() => {
    normalizer = new RecurlyNormalizer();
  });

  describe('source', () => {
    it('should identify as recurly', () => {
      expect(normalizer.source).toBe('recurly');
    });
  });

  describe('normalize', () => {
    // ─── new_subscription_notification ──────────────────────────────
    describe('new_subscription_notification', () => {
      it('should normalize to purchase event', async () => {
        const payload = createRecurlySubscriptionPayload('created');
        const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('purchase');
        expect(events[0].status).toBe('success');
        expect(events[0].source).toBe('recurly');
        expect(events[0].orgId).toBe(orgId);
      });

      it('should extract amount in cents', async () => {
        const payload = createRecurlySubscriptionPayload('created', {
          invoice: { uuid: 'inv_001', total_in_cents: 4999, currency: 'USD' },
        });
        const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events[0].amountCents).toBe(4999);
        expect(events[0].currency).toBe('USD');
      });

      it('should set correct idempotency key', async () => {
        const payload = createRecurlySubscriptionPayload('created');
        const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events[0].idempotencyKey).toBe(`recurly:${payload.id}`);
      });

      it('should extract subscription ID', async () => {
        const payload = createRecurlySubscriptionPayload('created');
        const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events[0].externalSubscriptionId).toBe('sub_recurly_abc123');
      });

      it('should preserve raw payload', async () => {
        const payload = createRecurlySubscriptionPayload('created');
        const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events[0].rawPayload).toEqual(payload);
      });
    });

    // ─── renewed_subscription_notification ──────────────────────────
    describe('renewed_subscription_notification', () => {
      it('should normalize to renewal event', async () => {
        const payload = createRecurlySubscriptionPayload('renewed');
        const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('renewal');
        expect(events[0].status).toBe('success');
      });
    });

    // ─── canceled_subscription_notification ─────────────────────────
    describe('canceled_subscription_notification', () => {
      it('should normalize to cancellation event', async () => {
        const payload = createRecurlySubscriptionPayload('canceled');
        const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('cancellation');
        expect(events[0].status).toBe('success');
      });
    });

    // ─── expired_subscription_notification ──────────────────────────
    describe('expired_subscription_notification', () => {
      it('should normalize to expiration event', async () => {
        const payload = createRecurlySubscriptionPayload('expired');
        const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('expiration');
        expect(events[0].status).toBe('success');
      });
    });

    // ─── paused_subscription_notification ───────────────────────────
    describe('paused_subscription_notification', () => {
      it('should normalize to pause event', async () => {
        const payload = createRecurlySubscriptionPayload('paused');
        const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('pause');
        expect(events[0].status).toBe('success');
      });
    });

    // ─── resumed_subscription_notification ──────────────────────────
    describe('resumed_subscription_notification', () => {
      it('should normalize to resume event', async () => {
        const payload = createRecurlySubscriptionPayload('resumed');
        const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('resume');
        expect(events[0].status).toBe('success');
      });
    });

    // ─── successful_payment_notification ────────────────────────────
    describe('successful_payment_notification', () => {
      it('should normalize to renewal event with amount', async () => {
        const payload = createRecurlyPaymentPayload('success');
        const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('renewal');
        expect(events[0].status).toBe('success');
        expect(events[0].amountCents).toBe(1999);
        expect(events[0].currency).toBe('USD');
      });
    });

    // ─── failed_payment_notification ────────────────────────────────
    describe('failed_payment_notification', () => {
      it('should normalize to billing_retry with failed status', async () => {
        const payload = createRecurlyPaymentPayload('failed');
        const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('billing_retry');
        expect(events[0].status).toBe('failed');
      });
    });

    // ─── successful_refund_notification ─────────────────────────────
    describe('successful_refund_notification', () => {
      it('should normalize to refund event', async () => {
        const payload = createRecurlyRefundPayload();
        const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('refund');
        expect(events[0].status).toBe('refunded');
      });

      it('should extract refund amount', async () => {
        const payload = createRecurlyRefundPayload({
          transaction: { uuid: 'txn_001', amount_in_cents: 999, status: 'success', currency: 'EUR' },
        });
        const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events[0].amountCents).toBe(999);
        expect(events[0].currency).toBe('EUR');
      });
    });

    // ─── updated_subscription_notification (upgrade/downgrade) ──────
    describe('updated_subscription_notification', () => {
      it('should detect upgrade when plan changes and price increases', async () => {
        const payload = {
          id: 'notif_recurly_updated_001',
          object_type: 'subscription',
          event_type: 'updated',
          account: { code: 'acct_123', email: 'user@test.com' },
          subscription: {
            uuid: 'sub_recurly_abc123',
            plan: { code: 'enterprise', name: 'Enterprise Plan', interval_length: 1, interval_unit: 'months' },
            unit_amount_in_cents: 4999,
            currency: 'USD',
          },
          previous_subscription: {
            uuid: 'sub_recurly_abc123',
            plan: { code: 'premium', name: 'Premium Plan' },
            unit_amount_in_cents: 1999,
          },
        };
        const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('upgrade');
        expect(events[0].status).toBe('success');
        expect(events[0].amountCents).toBe(4999);
        expect(events[0].idempotencyKey).toContain(':plan_change');
      });

      it('should detect downgrade when plan changes and price decreases', async () => {
        const payload = {
          id: 'notif_recurly_updated_002',
          object_type: 'subscription',
          event_type: 'updated',
          account: { code: 'acct_123', email: 'user@test.com' },
          subscription: {
            uuid: 'sub_recurly_abc123',
            plan: { code: 'basic', name: 'Basic Plan' },
            unit_amount_in_cents: 999,
            currency: 'USD',
          },
          previous_subscription: {
            uuid: 'sub_recurly_abc123',
            plan: { code: 'premium', name: 'Premium Plan' },
            unit_amount_in_cents: 1999,
          },
        };
        const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('downgrade');
      });

      it('should return empty for update with no actionable changes', async () => {
        const payload = {
          id: 'notif_recurly_updated_003',
          object_type: 'subscription',
          event_type: 'updated',
          account: { code: 'acct_123', email: 'user@test.com' },
          subscription: {
            uuid: 'sub_recurly_abc123',
            plan: { code: 'premium', name: 'Premium Plan' },
            unit_amount_in_cents: 1999,
            currency: 'USD',
          },
        };
        const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(0);
      });
    });

    // ─── Unknown / skipped event types ──────────────────────────────
    describe('unknown and skipped event types', () => {
      it('should return empty array for unmapped event types', async () => {
        const payload = {
          id: 'notif_recurly_unknown_001',
          object_type: 'gift_card',
          event_type: 'delivered',
          account: { code: 'acct_123' },
        };
        const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(0);
      });

      it('should return empty array for informational invoice events', async () => {
        const payload = {
          id: 'notif_recurly_invoice_001',
          object_type: 'invoice',
          event_type: 'new_charge',
          account: { code: 'acct_123' },
          invoice: { uuid: 'inv_001', total_in_cents: 1999, currency: 'USD' },
        };
        const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(0);
      });
    });

    // ─── Plan metadata extraction ───────────────────────────────────
    describe('plan metadata', () => {
      it('should extract billing interval from plan', async () => {
        const payload = createRecurlySubscriptionPayload('created', {
          subscription: {
            uuid: 'sub_001',
            plan: { code: 'yearly', name: 'Yearly Plan', interval_length: 1, interval_unit: 'years' },
            unit_amount_in_cents: 9999,
            currency: 'USD',
          },
        });
        const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events[0].billingInterval).toBe('year');
      });

      it('should format multi-unit intervals correctly', async () => {
        const payload = createRecurlySubscriptionPayload('created', {
          subscription: {
            uuid: 'sub_001',
            plan: { code: 'biannual', name: 'Biannual', interval_length: 6, interval_unit: 'months' },
            unit_amount_in_cents: 5999,
            currency: 'USD',
          },
        });
        const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events[0].billingInterval).toBe('6_month');
      });

      it('should extract plan tier from plan name', async () => {
        const payload = createRecurlySubscriptionPayload('created');
        const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events[0].planTier).toBe('Premium Plan');
      });

      it('should extract trial start date', async () => {
        const trialDate = '2025-01-10T00:00:00Z';
        const payload = createRecurlySubscriptionPayload('created', {
          subscription: {
            uuid: 'sub_001',
            plan: { code: 'premium', name: 'Premium' },
            unit_amount_in_cents: 1999,
            currency: 'USD',
            trial_started_at: trialDate,
          },
        });
        const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events[0].trialStartedAt).toEqual(new Date(trialDate));
      });
    });

    // ─── Malformed payloads ─────────────────────────────────────────
    describe('malformed payloads', () => {
      it('should throw on invalid JSON', async () => {
        const rawEvent = createRawWebhookEvent('recurly', 'not-valid-json');

        await expect(normalizer.normalize(orgId, rawEvent)).rejects.toThrow();
      });

      it('should handle missing subscription gracefully', async () => {
        const payload = {
          id: 'notif_recurly_empty_001',
          object_type: 'subscription',
          event_type: 'created',
          account: { code: 'acct_123' },
        };
        const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('purchase');
      });
    });
  });

  // ─── extractIdentityHints ──────────────────────────────────────────
  describe('extractIdentityHints', () => {
    it('should extract account_code from Recurly payload', () => {
      const payload = {
        account: { code: 'acct_123' },
      };

      const hints = normalizer.extractIdentityHints(payload);

      expect(hints.some(h => h.idType === 'account_code')).toBe(true);
      expect(hints.find(h => h.idType === 'account_code')).toEqual({
        source: 'recurly',
        idType: 'account_code',
        externalId: 'acct_123',
      });
    });

    it('should extract email when present', () => {
      const payload = {
        account: { code: 'acct_123', email: 'user@example.com' },
      };

      const hints = normalizer.extractIdentityHints(payload);

      expect(hints.some(h => h.idType === 'email')).toBe(true);
      expect(hints.find(h => h.idType === 'email')).toEqual({
        source: 'recurly',
        idType: 'email',
        externalId: 'user@example.com',
      });
    });

    it('should extract subscription_id when present', () => {
      const payload = {
        account: { code: 'acct_123' },
        subscription: { uuid: 'sub_xyz' },
      };

      const hints = normalizer.extractIdentityHints(payload);

      expect(hints.some(h => h.idType === 'subscription_id')).toBe(true);
      expect(hints.find(h => h.idType === 'subscription_id')).toEqual({
        source: 'recurly',
        idType: 'subscription_id',
        externalId: 'sub_xyz',
      });
    });

    it('should return empty array when no account data', () => {
      const hints = normalizer.extractIdentityHints({});

      expect(hints).toHaveLength(0);
    });

    it('should extract all identity hints together', () => {
      const payload = {
        account: { code: 'acct_123', email: 'user@test.com' },
        subscription: { uuid: 'sub_abc' },
      };

      const hints = normalizer.extractIdentityHints(payload);

      expect(hints).toHaveLength(3);
    });
  });

  // ─── verifySignature ───────────────────────────────────────────────
  describe('verifySignature', () => {
    const webhookSecret = 'test_webhook_secret_key';

    function createValidSignature(body: string, secret: string): string {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signedPayload = `${timestamp}.${body}`;
      const sig = createHmac('sha256', secret)
        .update(signedPayload)
        .digest('hex');
      return `${timestamp},${sig}`;
    }

    it('should return false when recurly-signature header is missing', async () => {
      const rawEvent: RawWebhookEvent = {
        source: 'recurly',
        headers: {},
        body: '{}',
        receivedAt: new Date(),
      };

      const result = await normalizer.verifySignature(rawEvent, webhookSecret);

      expect(result).toBe(false);
    });

    it('should return false for invalid signature format', async () => {
      const rawEvent: RawWebhookEvent = {
        source: 'recurly',
        headers: { 'recurly-signature': 'invalid_sig' },
        body: '{}',
        receivedAt: new Date(),
      };

      const result = await normalizer.verifySignature(rawEvent, webhookSecret);

      expect(result).toBe(false);
    });

    it('should return false for wrong signature', async () => {
      const body = '{"id":"test"}';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const rawEvent: RawWebhookEvent = {
        source: 'recurly',
        headers: { 'recurly-signature': `${timestamp},deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef` },
        body,
        receivedAt: new Date(),
      };

      const result = await normalizer.verifySignature(rawEvent, webhookSecret);

      expect(result).toBe(false);
    });

    it('should return true for valid signature', async () => {
      const body = '{"id":"test"}';
      const signatureHeader = createValidSignature(body, webhookSecret);
      const rawEvent: RawWebhookEvent = {
        source: 'recurly',
        headers: { 'recurly-signature': signatureHeader },
        body,
        receivedAt: new Date(),
      };

      const result = await normalizer.verifySignature(rawEvent, webhookSecret);

      expect(result).toBe(true);
    });

    it('should reject expired signatures (replay protection)', async () => {
      const body = '{"id":"test"}';
      // Create a signature with a timestamp 10 minutes ago
      const oldTimestamp = (Math.floor(Date.now() / 1000) - 600).toString();
      const signedPayload = `${oldTimestamp}.${body}`;
      const sig = createHmac('sha256', webhookSecret)
        .update(signedPayload)
        .digest('hex');
      const rawEvent: RawWebhookEvent = {
        source: 'recurly',
        headers: { 'recurly-signature': `${oldTimestamp},${sig}` },
        body,
        receivedAt: new Date(),
      };

      const result = await normalizer.verifySignature(rawEvent, webhookSecret);

      expect(result).toBe(false);
    });

    it('should accept any valid signature from multiple signatures', async () => {
      const body = '{"id":"test"}';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signedPayload = `${timestamp}.${body}`;
      const validSig = createHmac('sha256', webhookSecret)
        .update(signedPayload)
        .digest('hex');
      // Include an invalid sig followed by the valid one
      const signatureHeader = `${timestamp},deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef,${validSig}`;
      const rawEvent: RawWebhookEvent = {
        source: 'recurly',
        headers: { 'recurly-signature': signatureHeader },
        body,
        receivedAt: new Date(),
      };

      const result = await normalizer.verifySignature(rawEvent, webhookSecret);

      expect(result).toBe(true);
    });
  });
});
