import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StripeNormalizer } from '../../ingestion/providers/stripe.js';
import type { RawWebhookEvent } from '../../models/types.js';
import {
  createStripeInvoicePayload,
  createStripeSubscriptionCreatedPayload,
  createStripeSubscriptionUpdatedPayload,
  createStripeSubscriptionDeletedPayload,
  createStripeChargeRefundedPayload,
  createStripeDisputePayload,
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

describe('StripeNormalizer', () => {
  let normalizer: StripeNormalizer;
  const orgId = 'org_test_001';

  beforeEach(() => {
    normalizer = new StripeNormalizer();
  });

  describe('source', () => {
    it('should identify as stripe', () => {
      expect(normalizer.source).toBe('stripe');
    });
  });

  describe('normalize', () => {
    // ─── invoice.payment_succeeded ────────────────────────────────
    describe('invoice.payment_succeeded', () => {
      it('should normalize to renewal event', async () => {
        const payload = createStripeInvoicePayload();
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('renewal');
        expect(events[0].status).toBe('success');
        expect(events[0].source).toBe('stripe');
        expect(events[0].orgId).toBe(orgId);
      });

      it('should extract amount in cents', async () => {
        const payload = createStripeInvoicePayload({
          dataObject: { amount_paid: 4999, currency: 'usd' },
        });
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events[0].amountCents).toBe(4999);
        expect(events[0].currency).toBe('USD');
      });

      it('should set correct idempotency key', async () => {
        const payload = createStripeInvoicePayload();
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events[0].idempotencyKey).toBe(`stripe:${payload.id}`);
      });

      it('should set event time from Stripe created timestamp', async () => {
        const payload = createStripeInvoicePayload();
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events[0].eventTime).toEqual(new Date(payload.created * 1000));
      });

      it('should extract subscription ID from invoice', async () => {
        const payload = createStripeInvoicePayload({
          dataObject: { subscription: 'sub_abc123' },
        });
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events[0].externalSubscriptionId).toBe('sub_abc123');
      });

      it('should preserve raw payload', async () => {
        const payload = createStripeInvoicePayload();
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events[0].rawPayload).toEqual(payload);
      });
    });

    // ─── invoice.payment_failed ──────────────────────────────────
    describe('invoice.payment_failed', () => {
      it('should normalize to billing_retry with failed status', async () => {
        const payload = createStripeInvoicePayload({
          id: 'evt_payment_failed_001',
          type: 'invoice.payment_failed',
        });
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('billing_retry');
        expect(events[0].status).toBe('failed');
      });
    });

    // ─── customer.subscription.created ───────────────────────────
    describe('customer.subscription.created', () => {
      it('should normalize to purchase event', async () => {
        const payload = createStripeSubscriptionCreatedPayload();
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('purchase');
        expect(events[0].status).toBe('success');
      });

      it('should extract subscription ID from subscription object', async () => {
        const payload = createStripeSubscriptionCreatedPayload();
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events[0].externalSubscriptionId).toBe('sub_test123');
      });

      it('should extract amount from subscription items', async () => {
        const payload = createStripeSubscriptionCreatedPayload();
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events[0].amountCents).toBe(1999);
      });
    });

    // ─── customer.subscription.updated ───────────────────────────
    describe('customer.subscription.updated', () => {
      it('should detect cancellation when cancel_at_period_end changes', async () => {
        const payload = createStripeSubscriptionUpdatedPayload({
          dataObject: { cancel_at_period_end: true },
          previousAttributes: { cancel_at_period_end: false },
        });
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('cancellation');
        expect(events[0].status).toBe('success');
        expect(events[0].idempotencyKey).toContain(':cancel');
      });

      it('should detect past_due status change', async () => {
        const payload = createStripeSubscriptionUpdatedPayload({
          dataObject: { status: 'past_due' },
          previousAttributes: { status: 'active' },
        });
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events.some(e => e.eventType === 'billing_retry')).toBe(true);
        const billingRetry = events.find(e => e.eventType === 'billing_retry');
        expect(billingRetry!.status).toBe('failed');
      });

      it('should detect trial conversion', async () => {
        const payload = createStripeSubscriptionUpdatedPayload({
          dataObject: { status: 'active' },
          previousAttributes: { status: 'trialing' },
        });
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events.some(e => e.eventType === 'trial_conversion')).toBe(true);
      });

      it('should detect upgrade when price increases', async () => {
        const payload = createStripeSubscriptionUpdatedPayload({
          dataObject: {
            items: {
              data: [{
                price: {
                  id: 'price_new',
                  product: 'prod_test123',
                  unit_amount: 4999,
                  currency: 'usd',
                },
              }],
            },
            currency: 'usd',
          },
          previousAttributes: {
            items: {
              data: [{
                price: {
                  id: 'price_old',
                  product: 'prod_test123',
                  unit_amount: 1999,
                  currency: 'usd',
                },
              }],
            },
          },
        });
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events.some(e => e.eventType === 'upgrade')).toBe(true);
        const upgrade = events.find(e => e.eventType === 'upgrade');
        expect(upgrade!.amountCents).toBe(4999);
      });

      it('should detect downgrade when price decreases', async () => {
        const payload = createStripeSubscriptionUpdatedPayload({
          dataObject: {
            items: {
              data: [{
                price: {
                  id: 'price_new',
                  product: 'prod_test123',
                  unit_amount: 999,
                  currency: 'usd',
                },
              }],
            },
            currency: 'usd',
          },
          previousAttributes: {
            items: {
              data: [{
                price: {
                  id: 'price_old',
                  product: 'prod_test123',
                  unit_amount: 1999,
                  currency: 'usd',
                },
              }],
            },
          },
        });
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events.some(e => e.eventType === 'downgrade')).toBe(true);
      });

      it('should return empty for subscription update with no actionable changes', async () => {
        const payload = createStripeSubscriptionUpdatedPayload({
          previousAttributes: { metadata: { old: 'value' } },
        });
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(0);
      });

      it('should generate multiple events for compound updates', async () => {
        const payload = createStripeSubscriptionUpdatedPayload({
          dataObject: {
            cancel_at_period_end: true,
            status: 'active',
            items: {
              data: [{
                price: {
                  id: 'price_new',
                  product: 'prod_test123',
                  unit_amount: 999,
                  currency: 'usd',
                },
              }],
            },
            currency: 'usd',
          },
          previousAttributes: {
            cancel_at_period_end: false,
            items: {
              data: [{
                price: {
                  id: 'price_old',
                  product: 'prod_test123',
                  unit_amount: 1999,
                  currency: 'usd',
                },
              }],
            },
          },
        });
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        // Should have both cancellation and downgrade
        expect(events.length).toBeGreaterThanOrEqual(2);
        expect(events.some(e => e.eventType === 'cancellation')).toBe(true);
        expect(events.some(e => e.eventType === 'downgrade')).toBe(true);
      });
    });

    // ─── customer.subscription.deleted ───────────────────────────
    describe('customer.subscription.deleted', () => {
      it('should normalize to expiration event', async () => {
        const payload = createStripeSubscriptionDeletedPayload();
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('expiration');
        expect(events[0].status).toBe('success');
      });
    });

    // ─── charge.refunded ─────────────────────────────────────────
    describe('charge.refunded', () => {
      it('should normalize to refund event', async () => {
        const payload = createStripeChargeRefundedPayload();
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('refund');
        expect(events[0].status).toBe('refunded');
      });

      it('should extract amount from charge', async () => {
        const payload = createStripeChargeRefundedPayload();
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events[0].amountCents).toBe(1999);
        expect(events[0].currency).toBe('USD');
      });
    });

    // ─── charge.dispute.created ──────────────────────────────────
    describe('charge.dispute.created', () => {
      it('should normalize to chargeback event', async () => {
        const payload = createStripeDisputePayload();
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('chargeback');
        expect(events[0].status).toBe('pending');
      });
    });

    // ─── customer.subscription.paused ────────────────────────────
    describe('customer.subscription.paused', () => {
      it('should normalize to pause event', async () => {
        const payload = {
          id: 'evt_paused_001',
          object: 'event',
          type: 'customer.subscription.paused',
          created: Math.floor(Date.now() / 1000),
          data: {
            object: {
              id: 'sub_test123',
              object: 'subscription',
              customer: 'cus_test123',
              status: 'paused',
              metadata: {},
            },
          },
        };
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('pause');
        expect(events[0].status).toBe('success');
      });
    });

    // ─── customer.subscription.resumed ───────────────────────────
    describe('customer.subscription.resumed', () => {
      it('should normalize to resume event', async () => {
        const payload = {
          id: 'evt_resumed_001',
          object: 'event',
          type: 'customer.subscription.resumed',
          created: Math.floor(Date.now() / 1000),
          data: {
            object: {
              id: 'sub_test123',
              object: 'subscription',
              customer: 'cus_test123',
              status: 'active',
              metadata: {},
            },
          },
        };
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('resume');
        expect(events[0].status).toBe('success');
      });
    });

    // ─── Unknown / skipped event types ───────────────────────────
    describe('unknown and skipped event types', () => {
      it('should return empty array for unmapped event types', async () => {
        const payload = {
          id: 'evt_unknown_001',
          object: 'event',
          type: 'payment_intent.succeeded',
          created: Math.floor(Date.now() / 1000),
          data: { object: { customer: 'cus_test123' } },
        };
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(0);
      });

      it('should return empty array for intentionally skipped events', async () => {
        const payload = {
          id: 'evt_trial_will_end_001',
          object: 'event',
          type: 'customer.subscription.trial_will_end',
          created: Math.floor(Date.now() / 1000),
          data: { object: { customer: 'cus_test123' } },
        };
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        expect(events).toHaveLength(0);
      });
    });

    // ─── Malformed payloads ──────────────────────────────────────
    describe('malformed payloads', () => {
      it('should throw on invalid JSON', async () => {
        const rawEvent = createRawWebhookEvent('stripe', 'not-valid-json');

        await expect(normalizer.normalize(orgId, rawEvent)).rejects.toThrow();
      });

      it('should handle missing data.object gracefully', async () => {
        const payload = {
          id: 'evt_empty_001',
          object: 'event',
          type: 'invoice.payment_succeeded',
          created: Math.floor(Date.now() / 1000),
          data: { object: {} },
        };
        const rawEvent = createRawWebhookEvent('stripe', JSON.stringify(payload));

        const events = await normalizer.normalize(orgId, rawEvent);

        // Should still normalize; financials will just be missing
        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('renewal');
      });
    });
  });

  // ─── extractIdentityHints ────────────────────────────────────────
  describe('extractIdentityHints', () => {
    it('should extract customer_id from Stripe payload', () => {
      const payload = {
        data: {
          object: { customer: 'cus_abc123' },
        },
      };

      const hints = normalizer.extractIdentityHints(payload);

      expect(hints).toHaveLength(1);
      expect(hints[0]).toEqual({
        source: 'stripe',
        idType: 'customer_id',
        externalId: 'cus_abc123',
      });
    });

    it('should extract customer_email when present', () => {
      const payload = {
        data: {
          object: {
            customer: 'cus_abc123',
            customer_email: 'user@example.com',
          },
        },
      };

      const hints = normalizer.extractIdentityHints(payload);

      expect(hints).toHaveLength(2);
      expect(hints.find(h => h.idType === 'email')).toEqual({
        source: 'stripe',
        idType: 'email',
        externalId: 'user@example.com',
      });
    });

    it('should extract app_user_id from metadata', () => {
      const payload = {
        data: {
          object: {
            customer: 'cus_abc123',
            metadata: { user_id: 'app_user_789' },
          },
        },
      };

      const hints = normalizer.extractIdentityHints(payload);

      expect(hints).toHaveLength(2);
      expect(hints.find(h => h.idType === 'app_user_id')).toEqual({
        source: 'stripe',
        idType: 'app_user_id',
        externalId: 'app_user_789',
      });
    });

    it('should return empty array when no data.object', () => {
      const hints = normalizer.extractIdentityHints({});

      expect(hints).toHaveLength(0);
    });

    it('should return empty array when no customer fields', () => {
      const payload = {
        data: {
          object: { id: 'in_test', status: 'paid' },
        },
      };

      const hints = normalizer.extractIdentityHints(payload);

      expect(hints).toHaveLength(0);
    });
  });

  // ─── verifySignature ─────────────────────────────────────────────
  describe('verifySignature', () => {
    it('should return false when stripe-signature header is missing', async () => {
      const rawEvent: RawWebhookEvent = {
        source: 'stripe',
        headers: {},
        body: '{}',
        receivedAt: new Date(),
      };

      const result = await normalizer.verifySignature(rawEvent, 'whsec_test');

      expect(result).toBe(false);
    });

    it('should return false for invalid signature', async () => {
      const rawEvent: RawWebhookEvent = {
        source: 'stripe',
        headers: { 'stripe-signature': 'invalid_sig' },
        body: '{}',
        receivedAt: new Date(),
      };

      const result = await normalizer.verifySignature(rawEvent, 'whsec_test');

      expect(result).toBe(false);
    });
  });
});
