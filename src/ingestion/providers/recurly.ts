import { createHmac, timingSafeEqual } from 'crypto';
import type { EventNormalizer } from '../normalizer/base.js';
import type {
  BillingSource,
  EventType,
  EventStatus,
  NormalizedEvent,
  RawWebhookEvent,
  IdentityHint,
} from '../../models/types.js';
import { createChildLogger } from '../../config/logger.js';

const log = createChildLogger('recurly-normalizer');

/** Maximum age of a webhook signature before it's rejected (5 minutes) */
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

/** Maps Recurly event types to canonical event types */
const RECURLY_EVENT_MAP: Record<string, { eventType: EventType; status: EventStatus } | null> = {
  'new_subscription_notification': { eventType: 'purchase', status: 'success' },
  'renewed_subscription_notification': { eventType: 'renewal', status: 'success' },
  'updated_subscription_notification': null, // handled specially
  'canceled_subscription_notification': { eventType: 'cancellation', status: 'success' },
  'expired_subscription_notification': { eventType: 'expiration', status: 'success' },
  'paused_subscription_notification': { eventType: 'pause', status: 'success' },
  'resumed_subscription_notification': { eventType: 'resume', status: 'success' },
  'reactivated_account_notification': { eventType: 'resume', status: 'success' },
  'successful_payment_notification': { eventType: 'renewal', status: 'success' },
  'failed_payment_notification': { eventType: 'billing_retry', status: 'failed' },
  'successful_refund_notification': { eventType: 'refund', status: 'refunded' },
  'new_charge_invoice_notification': null, // informational, skip
  'past_due_invoice_notification': { eventType: 'billing_retry', status: 'failed' },
  'new_dunning_event_notification': { eventType: 'billing_retry', status: 'pending' },
};

/** Recurly webhook payload shape (JSON format) */
interface RecurlyPayload {
  id: string;
  object_type?: string;
  event_type?: string;
  account?: {
    code?: string;
    email?: string;
  };
  subscription?: {
    uuid?: string;
    plan?: {
      code?: string;
      name?: string;
      interval_length?: number;
      interval_unit?: string; // 'months', 'days'
    };
    state?: string;
    unit_amount_in_cents?: number;
    currency?: string;
    trial_started_at?: string;
  };
  invoice?: {
    uuid?: string;
    total_in_cents?: number;
    currency?: string;
  };
  transaction?: {
    uuid?: string;
    amount_in_cents?: number;
    status?: string;
    currency?: string;
  };
  // For updated_subscription_notification: previous state
  previous_subscription?: {
    uuid?: string;
    plan?: {
      code?: string;
      name?: string;
    };
    unit_amount_in_cents?: number;
  };
}

export class RecurlyNormalizer implements EventNormalizer {
  source: BillingSource = 'recurly';

  /**
   * Verify Recurly webhook signature.
   *
   * Recurly sends a `recurly-signature` header with format: `timestamp,sig1,sig2,...`
   * To verify: compute HMAC-SHA256 of `{timestamp}.{body}` using the webhook secret,
   * then compare against each signature using timing-safe comparison.
   * Also checks timestamp for replay protection (5 min tolerance).
   */
  async verifySignature(event: RawWebhookEvent, secret: string): Promise<boolean> {
    try {
      const signatureHeader = event.headers['recurly-signature'];
      if (!signatureHeader) {
        log.warn('Recurly webhook missing recurly-signature header');
        return false;
      }

      const parts = signatureHeader.split(',');
      if (parts.length < 2) {
        log.warn('Recurly signature header has invalid format (expected timestamp,sig1,...)');
        return false;
      }

      const timestamp = parts[0];
      const signatures = parts.slice(1);

      // Replay protection: reject signatures older than 5 minutes
      const timestampMs = parseInt(timestamp, 10) * 1000;
      if (isNaN(timestampMs)) {
        log.warn('Recurly signature has invalid timestamp');
        return false;
      }
      const age = Math.abs(Date.now() - timestampMs);
      if (age > SIGNATURE_MAX_AGE_MS) {
        log.warn({ age, maxAge: SIGNATURE_MAX_AGE_MS },
          'Recurly webhook signature too old — possible replay attack');
        return false;
      }

      // Compute expected signature
      const signedPayload = `${timestamp}.${event.body}`;
      const expectedSig = createHmac('sha256', secret)
        .update(signedPayload)
        .digest('hex');

      // Compare against each provided signature using timing-safe comparison
      const expectedBuf = Buffer.from(expectedSig, 'hex');
      for (const sig of signatures) {
        const sigBuf = Buffer.from(sig, 'hex');
        if (sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)) {
          return true;
        }
      }

      log.warn('Recurly webhook signature verification failed — no matching signature');
      return false;
    } catch (err) {
      log.warn({ err }, 'Recurly webhook signature verification failed');
      return false;
    }
  }

  async normalize(orgId: string, event: RawWebhookEvent): Promise<NormalizedEvent[]> {
    const payload = JSON.parse(event.body) as RecurlyPayload;

    // Recurly JSON webhooks encode the event type in the top-level notification type.
    // The event_type field from the payload, combined with object_type, maps to our
    // canonical notification type names.
    const notificationType = this.resolveNotificationType(payload);

    // Handle subscription updates specially (detect upgrade/downgrade)
    if (notificationType === 'updated_subscription_notification') {
      return this.normalizeSubscriptionUpdate(orgId, payload);
    }

    const mapping = RECURLY_EVENT_MAP[notificationType];
    if (mapping === undefined) {
      log.debug({ notificationType }, 'Unmapped Recurly event type, skipping');
      return [];
    }
    if (mapping === null) {
      return []; // intentionally skipped
    }

    const identityHints = this.extractIdentityHints(payload as unknown as Record<string, unknown>);

    const normalized: NormalizedEvent = {
      orgId,
      source: 'recurly',
      eventType: mapping.eventType,
      eventTime: event.receivedAt,
      status: mapping.status,
      externalEventId: payload.id,
      idempotencyKey: `recurly:${payload.id}`,
      rawPayload: payload as unknown as Record<string, unknown>,
      identityHints,
    };

    this.enrichWithFinancials(normalized, payload);
    this.enrichWithSubscriptionId(normalized, payload);
    this.enrichWithPlanMetadata(normalized, payload);

    return [normalized];
  }

  /**
   * Resolve the notification type from the payload.
   * Recurly JSON webhooks use event_type + object_type to form a notification key,
   * or the notification type may be embedded directly.
   */
  private resolveNotificationType(payload: RecurlyPayload): string {
    // If the payload has event_type and object_type, combine them into the
    // notification-style key that matches our event map.
    if (payload.event_type && payload.object_type) {
      const eventType = payload.event_type;
      const objectType = payload.object_type;

      // Map Recurly's event_type + object_type to notification names
      const compositeMap: Record<string, string> = {
        'subscription:created': 'new_subscription_notification',
        'subscription:renewed': 'renewed_subscription_notification',
        'subscription:updated': 'updated_subscription_notification',
        'subscription:canceled': 'canceled_subscription_notification',
        'subscription:expired': 'expired_subscription_notification',
        'subscription:paused': 'paused_subscription_notification',
        'subscription:resumed': 'resumed_subscription_notification',
        'account:reactivated': 'reactivated_account_notification',
        'payment:successful': 'successful_payment_notification',
        'payment:failed': 'failed_payment_notification',
        'refund:successful': 'successful_refund_notification',
        'invoice:new_charge': 'new_charge_invoice_notification',
        'invoice:past_due': 'past_due_invoice_notification',
        'dunning_event:new': 'new_dunning_event_notification',
      };

      const key = `${objectType}:${eventType}`;
      if (compositeMap[key]) {
        return compositeMap[key];
      }

      // Fallback: try constructing notification name from event_type + object_type
      return `${eventType}_${objectType}_notification`;
    }

    // Fallback: the payload ID or structure implies a specific notification type.
    // Check for well-known notification patterns in the payload.
    if (payload.subscription) {
      if (payload.transaction) {
        if (payload.transaction.status === 'success') return 'successful_payment_notification';
        if (payload.transaction.status === 'failed') return 'failed_payment_notification';
      }
    }

    return 'unknown';
  }

  private normalizeSubscriptionUpdate(orgId: string, payload: RecurlyPayload): NormalizedEvent[] {
    const events: NormalizedEvent[] = [];
    const identityHints = this.extractIdentityHints(payload as unknown as Record<string, unknown>);

    const base = {
      orgId,
      source: 'recurly' as BillingSource,
      eventTime: new Date(),
      externalEventId: payload.id,
      externalSubscriptionId: payload.subscription?.uuid,
      rawPayload: payload as unknown as Record<string, unknown>,
      identityHints,
      ...this.extractPlanMetadata(payload),
    };

    // Detect plan change (upgrade/downgrade) by comparing current vs previous
    const prevAmount = payload.previous_subscription?.unit_amount_in_cents;
    const currAmount = payload.subscription?.unit_amount_in_cents;
    const prevPlan = payload.previous_subscription?.plan?.code;
    const currPlan = payload.subscription?.plan?.code;

    if (prevPlan && currPlan && prevPlan !== currPlan) {
      const isUpgrade = (currAmount ?? 0) > (prevAmount ?? 0);
      events.push({
        ...base,
        eventType: isUpgrade ? 'upgrade' : 'downgrade',
        status: 'success',
        amountCents: currAmount,
        currency: payload.subscription?.currency?.toUpperCase(),
        idempotencyKey: `recurly:${payload.id}:plan_change`,
      });
    } else if (prevAmount !== undefined && currAmount !== undefined && prevAmount !== currAmount) {
      // Same plan but price changed
      events.push({
        ...base,
        eventType: currAmount > prevAmount ? 'upgrade' : 'downgrade',
        status: 'success',
        amountCents: currAmount,
        currency: payload.subscription?.currency?.toUpperCase(),
        idempotencyKey: `recurly:${payload.id}:price_change`,
      });
    }

    if (events.length === 0) {
      log.debug({ subId: payload.subscription?.uuid }, 'Subscription update with no actionable changes');
    }

    return events;
  }

  private enrichWithFinancials(event: NormalizedEvent, payload: RecurlyPayload) {
    // Prefer transaction amount, then invoice total, then subscription unit amount
    if (payload.transaction?.amount_in_cents !== undefined) {
      event.amountCents = payload.transaction.amount_in_cents;
      event.currency = (payload.transaction.currency || payload.subscription?.currency)?.toUpperCase();
    } else if (payload.invoice?.total_in_cents !== undefined) {
      event.amountCents = payload.invoice.total_in_cents;
      event.currency = (payload.invoice.currency || payload.subscription?.currency)?.toUpperCase();
    } else if (payload.subscription?.unit_amount_in_cents !== undefined) {
      event.amountCents = payload.subscription.unit_amount_in_cents;
      event.currency = payload.subscription.currency?.toUpperCase();
    }
  }

  private enrichWithSubscriptionId(event: NormalizedEvent, payload: RecurlyPayload) {
    if (payload.subscription?.uuid) {
      event.externalSubscriptionId = payload.subscription.uuid;
    }
  }

  private enrichWithPlanMetadata(event: NormalizedEvent, payload: RecurlyPayload) {
    const metadata = this.extractPlanMetadata(payload);
    if (metadata.billingInterval) event.billingInterval = metadata.billingInterval;
    if (metadata.planTier) event.planTier = metadata.planTier;
    if (metadata.trialStartedAt) event.trialStartedAt = metadata.trialStartedAt;
  }

  private extractPlanMetadata(payload: RecurlyPayload): { billingInterval?: string; planTier?: string; trialStartedAt?: Date } {
    const result: { billingInterval?: string; planTier?: string; trialStartedAt?: Date } = {};

    const plan = payload.subscription?.plan;
    if (plan) {
      // Billing interval: combine interval_length + interval_unit (e.g., "1 months" → "month")
      if (plan.interval_length && plan.interval_unit) {
        const unit = plan.interval_unit.replace(/s$/, ''); // "months" → "month"
        result.billingInterval = plan.interval_length === 1 ? unit : `${plan.interval_length}_${unit}`;
      }

      // Plan tier from plan name or code
      if (plan.name) {
        result.planTier = plan.name;
      } else if (plan.code) {
        result.planTier = plan.code;
      }
    }

    // Trial start date
    if (payload.subscription?.trial_started_at) {
      result.trialStartedAt = new Date(payload.subscription.trial_started_at);
    }

    return result;
  }

  extractIdentityHints(payload: Record<string, unknown>): IdentityHint[] {
    const hints: IdentityHint[] = [];
    const data = payload as unknown as RecurlyPayload;

    if (data.account?.code) {
      hints.push({
        source: 'recurly',
        idType: 'account_code',
        externalId: data.account.code,
      });
    }
    if (data.account?.email) {
      hints.push({
        source: 'recurly',
        idType: 'email',
        externalId: data.account.email,
      });
    }
    if (data.subscription?.uuid) {
      hints.push({
        source: 'recurly',
        idType: 'subscription_id',
        externalId: data.subscription.uuid,
      });
    }

    return hints;
  }
}
