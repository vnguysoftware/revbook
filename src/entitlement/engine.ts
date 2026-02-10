import { eq, and } from 'drizzle-orm';
import type { Database } from '../config/database.js';
import { entitlements } from '../models/schema.js';
import type { CanonicalEvent, EntitlementState, EventType, StateTransition } from '../models/types.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('entitlement-engine');

/**
 * Entitlement State Machine
 *
 * For each user × product × source, maintains a deterministic state
 * that represents what access the user *should* have based on all
 * known billing events.
 *
 * States:
 *   inactive → trial → active → grace_period → billing_retry → past_due → expired
 *                                                                         → paused
 *                                                                         → revoked
 *                                                                         → refunded
 *
 * Key insight: we don't ask "is this subscription active?" — we ask
 * "based on all events, SHOULD this user have access right now?"
 */

type TransitionResult = {
  newState: EntitlementState;
  shouldHaveAccess: boolean;
};

/**
 * Defines valid state transitions.
 * Key: current state
 * Value: map of event type → result state
 *
 * If a transition isn't listed, it's either invalid (logged as warning)
 * or a no-op.
 */
const STATE_TRANSITIONS: Record<EntitlementState, Partial<Record<EventType, TransitionResult>>> = {
  inactive: {
    purchase: { newState: 'active', shouldHaveAccess: true },
    trial_start: { newState: 'trial', shouldHaveAccess: true },
    offer_redeemed: { newState: 'active', shouldHaveAccess: true },
    renewal: { newState: 'active', shouldHaveAccess: true }, // reactivation
  },
  trial: {
    trial_conversion: { newState: 'active', shouldHaveAccess: true },
    purchase: { newState: 'active', shouldHaveAccess: true },
    cancellation: { newState: 'trial', shouldHaveAccess: true }, // still in trial, just won't renew
    expiration: { newState: 'expired', shouldHaveAccess: false },
    refund: { newState: 'refunded', shouldHaveAccess: false },
  },
  active: {
    renewal: { newState: 'active', shouldHaveAccess: true },
    cancellation: { newState: 'active', shouldHaveAccess: true }, // cancel at period end
    grace_period_start: { newState: 'grace_period', shouldHaveAccess: true },
    billing_retry: { newState: 'billing_retry', shouldHaveAccess: true },
    expiration: { newState: 'expired', shouldHaveAccess: false },
    refund: { newState: 'refunded', shouldHaveAccess: false },
    chargeback: { newState: 'refunded', shouldHaveAccess: false },
    revoke: { newState: 'revoked', shouldHaveAccess: false },
    pause: { newState: 'paused', shouldHaveAccess: false },
    upgrade: { newState: 'active', shouldHaveAccess: true },
    downgrade: { newState: 'active', shouldHaveAccess: true },
    crossgrade: { newState: 'active', shouldHaveAccess: true },
    price_change: { newState: 'active', shouldHaveAccess: true },
  },
  grace_period: {
    renewal: { newState: 'active', shouldHaveAccess: true },
    grace_period_end: { newState: 'billing_retry', shouldHaveAccess: true },
    billing_retry: { newState: 'billing_retry', shouldHaveAccess: true },
    expiration: { newState: 'expired', shouldHaveAccess: false },
    refund: { newState: 'refunded', shouldHaveAccess: false },
  },
  billing_retry: {
    renewal: { newState: 'active', shouldHaveAccess: true },
    billing_retry: { newState: 'billing_retry', shouldHaveAccess: true }, // another retry
    expiration: { newState: 'expired', shouldHaveAccess: false },
    refund: { newState: 'refunded', shouldHaveAccess: false },
  },
  past_due: {
    renewal: { newState: 'active', shouldHaveAccess: true },
    purchase: { newState: 'active', shouldHaveAccess: true },
    expiration: { newState: 'expired', shouldHaveAccess: false },
    refund: { newState: 'refunded', shouldHaveAccess: false },
  },
  paused: {
    resume: { newState: 'active', shouldHaveAccess: true },
    expiration: { newState: 'expired', shouldHaveAccess: false },
    cancellation: { newState: 'expired', shouldHaveAccess: false },
  },
  expired: {
    purchase: { newState: 'active', shouldHaveAccess: true },
    renewal: { newState: 'active', shouldHaveAccess: true },
    offer_redeemed: { newState: 'active', shouldHaveAccess: true },
    trial_start: { newState: 'trial', shouldHaveAccess: true },
  },
  revoked: {
    purchase: { newState: 'active', shouldHaveAccess: true },
  },
  refunded: {
    purchase: { newState: 'active', shouldHaveAccess: true },
  },
};

export class EntitlementEngine {
  constructor(private db: Database) {}

  /**
   * Process a canonical event and update the entitlement state.
   * Returns the state transition that occurred (if any).
   */
  async processEvent(event: CanonicalEvent): Promise<StateTransition | null> {
    if (!event.userId || !event.productId) {
      log.debug({ eventId: event.id }, 'Skipping entitlement update — no user or product');
      return null;
    }

    // Get or create entitlement record atomically
    await this.db
      .insert(entitlements)
      .values({
        orgId: event.orgId,
        userId: event.userId,
        productId: event.productId,
        source: event.source,
        state: 'inactive',
        externalSubscriptionId: event.externalSubscriptionId,
        billingInterval: event.billingInterval,
        planTier: event.planTier,
        stateHistory: [],
      })
      .onConflictDoNothing();

    const [entitlement] = await this.db
      .select()
      .from(entitlements)
      .where(
        and(
          eq(entitlements.orgId, event.orgId),
          eq(entitlements.userId, event.userId),
          eq(entitlements.productId, event.productId),
          eq(entitlements.source, event.source),
        ),
      )
      .limit(1);

    const currentState = entitlement.state as EntitlementState;
    const eventType = event.eventType as EventType;

    // Look up transition
    const transitions = STATE_TRANSITIONS[currentState];
    const result = transitions?.[eventType];

    if (!result) {
      // No valid transition — could be an issue or just irrelevant
      if (event.status === 'failed') {
        // Failed events often don't cause transitions
        log.debug({ currentState, eventType, eventId: event.id }, 'No transition for failed event');
        return null;
      }

      log.warn(
        { currentState, eventType, eventId: event.id },
        'No valid state transition found — possible anomaly',
      );
      return null;
    }

    const transition: StateTransition = {
      from: currentState,
      to: result.newState,
      eventType,
      eventId: event.id,
      timestamp: event.eventTime,
    };

    // Update entitlement with optimistic lock on current state
    const history = (entitlement.stateHistory as StateTransition[]) || [];
    history.push(transition);

    const updated = await this.db
      .update(entitlements)
      .set({
        state: result.newState,
        lastEventId: event.id,
        stateHistory: history,
        currentPeriodStart: this.extractPeriodStart(event),
        currentPeriodEnd: this.extractPeriodEnd(event),
        billingInterval: event.billingInterval ?? entitlement.billingInterval,
        planTier: event.planTier ?? entitlement.planTier,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(entitlements.id, entitlement.id),
          eq(entitlements.state, currentState), // optimistic lock
        ),
      )
      .returning();

    if (updated.length === 0) {
      log.warn({
        entitlementId: entitlement.id,
        expectedState: currentState,
        eventType,
      }, 'Entitlement state changed concurrently, skipping update');
      return null;
    }

    log.info({
      entitlementId: entitlement.id,
      from: currentState,
      to: result.newState,
      eventType,
      hasAccess: result.shouldHaveAccess,
    }, 'Entitlement state transition');

    return transition;
  }

  /**
   * Get the current entitlement state for a user across all products.
   */
  async getUserEntitlements(orgId: string, userId: string) {
    return this.db
      .select()
      .from(entitlements)
      .where(
        and(
          eq(entitlements.orgId, orgId),
          eq(entitlements.userId, userId),
        ),
      );
  }

  /**
   * Check if a user should currently have access to a product.
   */
  async hasAccess(orgId: string, userId: string, productId: string): Promise<boolean> {
    const [ent] = await this.db
      .select()
      .from(entitlements)
      .where(
        and(
          eq(entitlements.orgId, orgId),
          eq(entitlements.userId, userId),
          eq(entitlements.productId, productId),
        ),
      )
      .limit(1);

    if (!ent) return false;

    const accessStates: EntitlementState[] = [
      'trial',
      'active',
      'grace_period',
      'billing_retry',
    ];

    return accessStates.includes(ent.state as EntitlementState);
  }

  private extractPeriodStart(event: CanonicalEvent): Date | undefined {
    const raw = event.rawPayload as any;
    // Stripe
    if (raw?.data?.object?.current_period_start) {
      return new Date(raw.data.object.current_period_start * 1000);
    }
    // Apple
    if (raw?.transaction?.purchaseDate) {
      return new Date(raw.transaction.purchaseDate);
    }
    return undefined;
  }

  private extractPeriodEnd(event: CanonicalEvent): Date | undefined {
    const raw = event.rawPayload as any;
    // Stripe
    if (raw?.data?.object?.current_period_end) {
      return new Date(raw.data.object.current_period_end * 1000);
    }
    // Apple
    if (raw?.transaction?.expiresDate) {
      return new Date(raw.transaction.expiresDate);
    }
    return undefined;
  }
}
