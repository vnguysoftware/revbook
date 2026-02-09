import Stripe from 'stripe';
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

const log = createChildLogger('stripe-normalizer');

/** Maps Stripe event types to our canonical event types */
const STRIPE_EVENT_MAP: Record<string, { eventType: EventType; status: EventStatus } | null> = {
  'invoice.payment_succeeded': { eventType: 'renewal', status: 'success' },
  'invoice.payment_failed': { eventType: 'billing_retry', status: 'failed' },
  'customer.subscription.created': { eventType: 'purchase', status: 'success' },
  'customer.subscription.updated': null, // handled specially
  'customer.subscription.deleted': { eventType: 'expiration', status: 'success' },
  'customer.subscription.trial_will_end': null, // informational only
  'customer.subscription.paused': { eventType: 'pause', status: 'success' },
  'customer.subscription.resumed': { eventType: 'resume', status: 'success' },
  'charge.refunded': { eventType: 'refund', status: 'refunded' },
  'charge.dispute.created': { eventType: 'chargeback', status: 'pending' },
  'charge.dispute.closed': null, // handled specially
  'checkout.session.completed': { eventType: 'purchase', status: 'success' },
};

export class StripeNormalizer implements EventNormalizer {
  source: BillingSource = 'stripe';

  async verifySignature(event: RawWebhookEvent, secret: string): Promise<boolean> {
    try {
      const sig = event.headers['stripe-signature'];
      if (!sig) {
        log.warn('Stripe webhook missing stripe-signature header');
        return false;
      }

      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-02-24.acacia' });
      // constructEvent verifies both the HMAC signature and the timestamp
      // (default tolerance: 300 seconds) to prevent replay attacks.
      stripe.webhooks.constructEvent(event.body, sig, secret);
      return true;
    } catch (err) {
      log.warn({ err, hasSignature: !!event.headers['stripe-signature'] },
        'Stripe webhook signature verification failed — possible replay attack or misconfigured webhook secret');
      return false;
    }
  }

  async normalize(orgId: string, event: RawWebhookEvent): Promise<NormalizedEvent[]> {
    const payload = JSON.parse(event.body) as Stripe.Event;
    const stripeEventType = payload.type;

    // Handle subscription.updated specially — it can mean many things
    if (stripeEventType === 'customer.subscription.updated') {
      return this.normalizeSubscriptionUpdate(orgId, payload);
    }

    const mapping = STRIPE_EVENT_MAP[stripeEventType];
    if (mapping === undefined) {
      log.debug({ stripeEventType }, 'Unmapped Stripe event type, skipping');
      return [];
    }
    if (mapping === null) {
      return []; // intentionally skipped
    }

    const identityHints = this.extractIdentityHints(payload as unknown as Record<string, unknown>);

    const normalized: NormalizedEvent = {
      orgId,
      source: 'stripe',
      eventType: mapping.eventType,
      eventTime: new Date(payload.created * 1000),
      status: mapping.status,
      externalEventId: payload.id,
      idempotencyKey: `stripe:${payload.id}`,
      rawPayload: payload as unknown as Record<string, unknown>,
      identityHints,
    };

    // Extract financial details based on event type
    this.enrichWithFinancials(normalized, payload);
    this.enrichWithSubscriptionId(normalized, payload);

    return [normalized];
  }

  private normalizeSubscriptionUpdate(orgId: string, payload: Stripe.Event): NormalizedEvent[] {
    const sub = payload.data.object as Stripe.Subscription;
    const prev = payload.data.previous_attributes as Partial<Stripe.Subscription> | undefined;
    const events: NormalizedEvent[] = [];

    const base = {
      orgId,
      source: 'stripe' as BillingSource,
      eventTime: new Date(payload.created * 1000),
      externalEventId: payload.id,
      externalSubscriptionId: sub.id,
      rawPayload: payload as unknown as Record<string, unknown>,
      identityHints: this.extractIdentityHints(payload as unknown as Record<string, unknown>),
    };

    // Cancellation scheduled
    if (sub.cancel_at_period_end && prev && !prev.cancel_at_period_end) {
      events.push({
        ...base,
        eventType: 'cancellation',
        status: 'success',
        idempotencyKey: `stripe:${payload.id}:cancel`,
      });
    }

    // Status change to past_due
    if (sub.status === 'past_due' && prev?.status && prev.status !== 'past_due') {
      events.push({
        ...base,
        eventType: 'billing_retry',
        status: 'failed',
        idempotencyKey: `stripe:${payload.id}:past_due`,
      });
    }

    // Trial end / conversion
    if (sub.status === 'active' && prev?.status === 'trialing') {
      events.push({
        ...base,
        eventType: 'trial_conversion',
        status: 'success',
        idempotencyKey: `stripe:${payload.id}:trial_convert`,
      });
    }

    // Plan change (upgrade/downgrade)
    if (prev?.items) {
      const prevPriceId = (prev.items as any)?.data?.[0]?.price?.id;
      const currPriceId = sub.items?.data?.[0]?.price?.id;
      if (prevPriceId && currPriceId && prevPriceId !== currPriceId) {
        const prevAmount = (prev.items as any)?.data?.[0]?.price?.unit_amount || 0;
        const currAmount = sub.items?.data?.[0]?.price?.unit_amount || 0;
        events.push({
          ...base,
          eventType: currAmount > prevAmount ? 'upgrade' : 'downgrade',
          status: 'success',
          amountCents: currAmount,
          currency: sub.currency?.toUpperCase(),
          idempotencyKey: `stripe:${payload.id}:plan_change`,
        });
      }
    }

    // If no specific change was detected, skip
    if (events.length === 0) {
      log.debug({ subId: sub.id }, 'Subscription update with no actionable changes');
    }

    return events;
  }

  private enrichWithFinancials(event: NormalizedEvent, payload: Stripe.Event) {
    const obj = payload.data.object as any;
    if (obj.amount_paid !== undefined) {
      event.amountCents = obj.amount_paid;
      event.currency = obj.currency?.toUpperCase();
    } else if (obj.amount !== undefined) {
      event.amountCents = obj.amount;
      event.currency = obj.currency?.toUpperCase();
    } else if (obj.items?.data?.[0]?.price?.unit_amount) {
      event.amountCents = obj.items.data[0].price.unit_amount;
      event.currency = obj.items.data[0].price.currency?.toUpperCase();
    }
  }

  private enrichWithSubscriptionId(event: NormalizedEvent, payload: Stripe.Event) {
    const obj = payload.data.object as any;
    if (obj.subscription) {
      event.externalSubscriptionId = obj.subscription;
    } else if (obj.id?.startsWith('sub_')) {
      event.externalSubscriptionId = obj.id;
    }
  }

  extractIdentityHints(payload: Record<string, unknown>): IdentityHint[] {
    const hints: IdentityHint[] = [];
    const data = (payload as any)?.data?.object;
    if (!data) return hints;

    if (data.customer) {
      hints.push({
        source: 'stripe',
        idType: 'customer_id',
        externalId: data.customer,
      });
    }
    if (data.customer_email) {
      hints.push({
        source: 'stripe',
        idType: 'email',
        externalId: data.customer_email,
      });
    }
    if (data.metadata?.user_id) {
      hints.push({
        source: 'stripe',
        idType: 'app_user_id',
        externalId: data.metadata.user_id,
      });
    }

    return hints;
  }
}
