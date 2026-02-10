/**
 * Critical path tests for the Recurly normalizer.
 *
 * Covers edge cases and paths not exercised by the main recurly.test.ts:
 * - Additional event type mappings (past_due_invoice, dunning, reactivation)
 * - Financial enrichment priority (transaction > invoice > subscription)
 * - Subscription update: same plan, price-only change
 * - Composite type resolution fallback paths
 * - Signature verification edge cases (NaN timestamp, empty body)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import { RecurlyNormalizer } from '../../ingestion/providers/recurly.js';
import type { RawWebhookEvent } from '../../models/types.js';
import { createRawWebhookEvent } from '../helpers.js';

vi.mock('../../config/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('RecurlyNormalizer – critical paths', () => {
  let normalizer: RecurlyNormalizer;
  const orgId = 'org_critical';

  beforeEach(() => {
    normalizer = new RecurlyNormalizer();
  });

  // ─── Additional event type mappings ────────────────────────────────

  describe('past_due_invoice_notification', () => {
    it('should normalize to billing_retry with failed status', async () => {
      const payload = {
        id: 'notif_past_due_001',
        object_type: 'invoice',
        event_type: 'past_due',
        account: { code: 'acct_pd' },
        invoice: { uuid: 'inv_pd', total_in_cents: 2999, currency: 'USD' },
      };
      const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('billing_retry');
      expect(events[0].status).toBe('failed');
      expect(events[0].amountCents).toBe(2999);
    });
  });

  describe('new_dunning_event_notification', () => {
    it('should normalize to billing_retry with pending status', async () => {
      const payload = {
        id: 'notif_dunning_001',
        object_type: 'dunning_event',
        event_type: 'new',
        account: { code: 'acct_dun' },
        subscription: {
          uuid: 'sub_dun_001',
          plan: { code: 'basic', name: 'Basic' },
          unit_amount_in_cents: 999,
          currency: 'USD',
        },
      };
      const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('billing_retry');
      expect(events[0].status).toBe('pending');
    });
  });

  describe('reactivated_account_notification', () => {
    it('should normalize to resume event', async () => {
      const payload = {
        id: 'notif_reactivated_001',
        object_type: 'account',
        event_type: 'reactivated',
        account: { code: 'acct_react', email: 'reactivated@test.com' },
      };
      const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('resume');
      expect(events[0].status).toBe('success');
    });
  });

  // ─── Financial enrichment priority ─────────────────────────────────

  describe('financial enrichment priority', () => {
    it('should prefer transaction amount over invoice and subscription amounts', async () => {
      const payload = {
        id: 'notif_priority_001',
        object_type: 'payment',
        event_type: 'successful',
        account: { code: 'acct_fp' },
        subscription: {
          uuid: 'sub_fp',
          plan: { code: 'pro', name: 'Pro' },
          unit_amount_in_cents: 5000,
          currency: 'USD',
        },
        invoice: { uuid: 'inv_fp', total_in_cents: 7500, currency: 'USD' },
        transaction: { uuid: 'txn_fp', amount_in_cents: 3000, status: 'success', currency: 'EUR' },
      };
      const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events[0].amountCents).toBe(3000);
      expect(events[0].currency).toBe('EUR');
    });

    it('should fall back to invoice amount when no transaction', async () => {
      const payload = {
        id: 'notif_inv_001',
        object_type: 'subscription',
        event_type: 'created',
        account: { code: 'acct_inv' },
        subscription: {
          uuid: 'sub_inv',
          plan: { code: 'basic', name: 'Basic' },
          unit_amount_in_cents: 999,
          currency: 'USD',
        },
        invoice: { uuid: 'inv_fb', total_in_cents: 1500, currency: 'GBP' },
      };
      const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events[0].amountCents).toBe(1500);
      expect(events[0].currency).toBe('GBP');
    });

    it('should fall back to subscription amount when no transaction or invoice', async () => {
      const payload = {
        id: 'notif_sub_only_001',
        object_type: 'subscription',
        event_type: 'renewed',
        account: { code: 'acct_so' },
        subscription: {
          uuid: 'sub_so',
          plan: { code: 'enterprise', name: 'Enterprise' },
          unit_amount_in_cents: 9999,
          currency: 'JPY',
        },
      };
      const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events[0].amountCents).toBe(9999);
      expect(events[0].currency).toBe('JPY');
    });
  });

  // ─── Subscription update: price-only change ────────────────────────

  describe('updated_subscription_notification – price-only change', () => {
    it('should detect upgrade when same plan but price increases', async () => {
      const payload = {
        id: 'notif_price_up_001',
        object_type: 'subscription',
        event_type: 'updated',
        account: { code: 'acct_pu' },
        subscription: {
          uuid: 'sub_pu',
          plan: { code: 'premium', name: 'Premium' },
          unit_amount_in_cents: 3999,
          currency: 'USD',
        },
        previous_subscription: {
          uuid: 'sub_pu',
          plan: { code: 'premium', name: 'Premium' },
          unit_amount_in_cents: 1999,
        },
      };
      const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('upgrade');
      expect(events[0].amountCents).toBe(3999);
      expect(events[0].idempotencyKey).toContain(':price_change');
    });

    it('should detect downgrade when same plan but price decreases', async () => {
      const payload = {
        id: 'notif_price_down_001',
        object_type: 'subscription',
        event_type: 'updated',
        account: { code: 'acct_pd2' },
        subscription: {
          uuid: 'sub_pd2',
          plan: { code: 'premium', name: 'Premium' },
          unit_amount_in_cents: 999,
          currency: 'USD',
        },
        previous_subscription: {
          uuid: 'sub_pd2',
          plan: { code: 'premium', name: 'Premium' },
          unit_amount_in_cents: 1999,
        },
      };
      const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('downgrade');
      expect(events[0].idempotencyKey).toContain(':price_change');
    });

    it('should skip when same plan and same price', async () => {
      const payload = {
        id: 'notif_no_change_001',
        object_type: 'subscription',
        event_type: 'updated',
        account: { code: 'acct_nc' },
        subscription: {
          uuid: 'sub_nc',
          plan: { code: 'premium', name: 'Premium' },
          unit_amount_in_cents: 1999,
          currency: 'USD',
        },
        previous_subscription: {
          uuid: 'sub_nc',
          plan: { code: 'premium', name: 'Premium' },
          unit_amount_in_cents: 1999,
        },
      };
      const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events).toHaveLength(0);
    });
  });

  // ─── Composite type resolution fallbacks ───────────────────────────

  describe('type resolution', () => {
    it('should fall back to transaction-based type resolution when no event_type/object_type', async () => {
      const payload = {
        id: 'notif_fallback_001',
        subscription: {
          uuid: 'sub_fb',
          plan: { code: 'basic', name: 'Basic' },
          unit_amount_in_cents: 999,
          currency: 'USD',
        },
        transaction: { uuid: 'txn_fb', amount_in_cents: 999, status: 'success', currency: 'USD' },
        account: { code: 'acct_fb' },
      };
      const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('renewal');
      expect(events[0].status).toBe('success');
    });

    it('should resolve failed transaction as failed_payment_notification', async () => {
      const payload = {
        id: 'notif_fallback_002',
        subscription: {
          uuid: 'sub_fb2',
          plan: { code: 'basic', name: 'Basic' },
          unit_amount_in_cents: 999,
          currency: 'USD',
        },
        transaction: { uuid: 'txn_fb2', amount_in_cents: 999, status: 'failed', currency: 'USD' },
        account: { code: 'acct_fb2' },
      };
      const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('billing_retry');
      expect(events[0].status).toBe('failed');
    });

    it('should return empty for completely unknown event type', async () => {
      const payload = {
        id: 'notif_totally_unknown',
        object_type: 'custom_thing',
        event_type: 'happened',
        account: { code: 'acct_u' },
      };
      const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events).toHaveLength(0);
    });
  });

  // ─── Signature verification edge cases ─────────────────────────────

  describe('verifySignature – edge cases', () => {
    const secret = 'edge_case_secret';

    it('should return false for NaN timestamp', async () => {
      const rawEvent: RawWebhookEvent = {
        source: 'recurly',
        headers: { 'recurly-signature': 'not_a_number,deadbeef' },
        body: '{}',
        receivedAt: new Date(),
      };

      const result = await normalizer.verifySignature(rawEvent, secret);
      expect(result).toBe(false);
    });

    it('should return false for signature with only timestamp (no sigs)', async () => {
      const rawEvent: RawWebhookEvent = {
        source: 'recurly',
        headers: { 'recurly-signature': '1234567890' },
        body: '{}',
        receivedAt: new Date(),
      };

      const result = await normalizer.verifySignature(rawEvent, secret);
      expect(result).toBe(false);
    });

    it('should handle empty body with valid signature', async () => {
      const body = '';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const sig = createHmac('sha256', secret)
        .update(`${timestamp}.${body}`)
        .digest('hex');

      const rawEvent: RawWebhookEvent = {
        source: 'recurly',
        headers: { 'recurly-signature': `${timestamp},${sig}` },
        body,
        receivedAt: new Date(),
      };

      const result = await normalizer.verifySignature(rawEvent, secret);
      expect(result).toBe(true);
    });

    it('should reject signature with mismatched length', async () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      // Short signature (not a valid hex SHA-256)
      const rawEvent: RawWebhookEvent = {
        source: 'recurly',
        headers: { 'recurly-signature': `${timestamp},abc` },
        body: '{}',
        receivedAt: new Date(),
      };

      const result = await normalizer.verifySignature(rawEvent, secret);
      expect(result).toBe(false);
    });
  });

  // ─── Plan metadata extraction edge cases ───────────────────────────

  describe('plan metadata – edge cases', () => {
    it('should use plan code when plan name is missing', async () => {
      const payload = {
        id: 'notif_code_only_001',
        object_type: 'subscription',
        event_type: 'created',
        account: { code: 'acct_co' },
        subscription: {
          uuid: 'sub_co',
          plan: { code: 'enterprise_v2' },
          unit_amount_in_cents: 9999,
          currency: 'USD',
        },
      };
      const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events[0].planTier).toBe('enterprise_v2');
    });

    it('should handle missing plan entirely', async () => {
      const payload = {
        id: 'notif_no_plan_001',
        object_type: 'subscription',
        event_type: 'created',
        account: { code: 'acct_np' },
        subscription: {
          uuid: 'sub_np',
          unit_amount_in_cents: 999,
          currency: 'USD',
        },
      };
      const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events).toHaveLength(1);
      expect(events[0].billingInterval).toBeUndefined();
      expect(events[0].planTier).toBeUndefined();
    });

    it('should handle daily billing intervals', async () => {
      const payload = {
        id: 'notif_daily_001',
        object_type: 'subscription',
        event_type: 'created',
        account: { code: 'acct_daily' },
        subscription: {
          uuid: 'sub_daily',
          plan: { code: 'daily', name: 'Daily Plan', interval_length: 1, interval_unit: 'days' },
          unit_amount_in_cents: 99,
          currency: 'USD',
        },
      };
      const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events[0].billingInterval).toBe('day');
    });

    it('should handle multi-day billing intervals', async () => {
      const payload = {
        id: 'notif_biweekly_001',
        object_type: 'subscription',
        event_type: 'created',
        account: { code: 'acct_bw' },
        subscription: {
          uuid: 'sub_bw',
          plan: { code: 'biweekly', name: 'Biweekly', interval_length: 14, interval_unit: 'days' },
          unit_amount_in_cents: 499,
          currency: 'USD',
        },
      };
      const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events[0].billingInterval).toBe('14_day');
    });
  });

  // ─── Identity hints with partial data ──────────────────────────────

  describe('identity hints – partial data', () => {
    it('should extract only account_code when email is missing', () => {
      const hints = normalizer.extractIdentityHints({
        account: { code: 'acct_no_email' },
      });

      expect(hints).toHaveLength(1);
      expect(hints[0].idType).toBe('account_code');
      expect(hints[0].externalId).toBe('acct_no_email');
    });

    it('should extract account_code and subscription_id without email', () => {
      const hints = normalizer.extractIdentityHints({
        account: { code: 'acct_with_sub' },
        subscription: { uuid: 'sub_with_acct' },
      });

      expect(hints).toHaveLength(2);
      expect(hints.map(h => h.idType).sort()).toEqual(['account_code', 'subscription_id']);
    });
  });

  // ─── Currency normalization ────────────────────────────────────────

  describe('currency normalization', () => {
    it('should uppercase lowercase currency codes', async () => {
      const payload = {
        id: 'notif_lc_curr_001',
        object_type: 'subscription',
        event_type: 'created',
        account: { code: 'acct_lc' },
        subscription: {
          uuid: 'sub_lc',
          plan: { code: 'basic', name: 'Basic' },
          unit_amount_in_cents: 999,
          currency: 'eur',
        },
      };
      const rawEvent = createRawWebhookEvent('recurly', JSON.stringify(payload));

      const events = await normalizer.normalize(orgId, rawEvent);

      expect(events[0].currency).toBe('EUR');
    });
  });
});
