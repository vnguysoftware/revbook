import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntitlementEngine } from '../../entitlement/engine.js';
import type { CanonicalEvent, EntitlementState, EventType } from '../../models/types.js';
import { createTestCanonicalEvent, createTestEntitlement, mockUuid, resetUuidCounter } from '../helpers.js';

// Mock the logger
vi.mock('../../config/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('EntitlementEngine', () => {
  let engine: EntitlementEngine;
  let mockDb: any;
  const orgId = 'org_test_entitlement';
  const userId = 'user_ent_001';
  const productId = 'product_ent_001';

  beforeEach(() => {
    resetUuidCounter();
    mockDb = createEntitlementMockDb();
    engine = new EntitlementEngine(mockDb);
  });

  describe('processEvent', () => {
    it('should skip events with no userId', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId: null,
        productId,
      }) as CanonicalEvent;

      const transition = await engine.processEvent(event);

      expect(transition).toBeNull();
    });

    it('should skip events with no productId', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId: null,
      }) as CanonicalEvent;

      const transition = await engine.processEvent(event);

      expect(transition).toBeNull();
    });

    it('should create entitlement if none exists', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'purchase',
        status: 'success',
      }) as CanonicalEvent;

      const newEnt = createTestEntitlement(orgId, userId, productId, { state: 'inactive', stateHistory: [] });

      // The engine does:
      // 1. insert().values().onConflictDoNothing() — creates the entitlement
      // 2. select().from().where().limit(1) — reads it back
      // After insert, the select should return the newly created entitlement
      let insertDone = false;
      mockDb.onConflictDoNothing = vi.fn().mockImplementation(() => {
        insertDone = true;
        return Promise.resolve([]);
      });
      mockDb.limit = vi.fn().mockImplementation(() => {
        // After insert, return the new entitlement
        if (insertDone) return Promise.resolve([newEnt]);
        return Promise.resolve([]);
      });

      const transition = await engine.processEvent(event);

      expect(transition).not.toBeNull();
      expect(transition!.from).toBe('inactive');
      expect(transition!.to).toBe('active');
    });

    // ─── State Transition Tests ──────────────────────────────────

    describe('INACTIVE state transitions', () => {
      it('should transition INACTIVE -> ACTIVE on purchase', async () => {
        const transition = await processEventWithState('inactive', 'purchase', 'success');
        expect(transition!.from).toBe('inactive');
        expect(transition!.to).toBe('active');
      });

      it('should transition INACTIVE -> TRIAL on trial_start', async () => {
        const transition = await processEventWithState('inactive', 'trial_start', 'success');
        expect(transition!.from).toBe('inactive');
        expect(transition!.to).toBe('trial');
      });

      it('should transition INACTIVE -> ACTIVE on offer_redeemed', async () => {
        const transition = await processEventWithState('inactive', 'offer_redeemed', 'success');
        expect(transition!.from).toBe('inactive');
        expect(transition!.to).toBe('active');
      });

      it('should transition INACTIVE -> ACTIVE on renewal (reactivation)', async () => {
        const transition = await processEventWithState('inactive', 'renewal', 'success');
        expect(transition!.from).toBe('inactive');
        expect(transition!.to).toBe('active');
      });

      it('should return null for invalid transition from inactive', async () => {
        const transition = await processEventWithState('inactive', 'cancellation', 'success');
        expect(transition).toBeNull();
      });
    });

    describe('TRIAL state transitions', () => {
      it('should transition TRIAL -> ACTIVE on trial_conversion', async () => {
        const transition = await processEventWithState('trial', 'trial_conversion', 'success');
        expect(transition!.from).toBe('trial');
        expect(transition!.to).toBe('active');
      });

      it('should transition TRIAL -> ACTIVE on purchase', async () => {
        const transition = await processEventWithState('trial', 'purchase', 'success');
        expect(transition!.from).toBe('trial');
        expect(transition!.to).toBe('active');
      });

      it('should stay in TRIAL on cancellation (will not renew)', async () => {
        const transition = await processEventWithState('trial', 'cancellation', 'success');
        expect(transition!.from).toBe('trial');
        expect(transition!.to).toBe('trial');
      });

      it('should transition TRIAL -> EXPIRED on expiration', async () => {
        const transition = await processEventWithState('trial', 'expiration', 'success');
        expect(transition!.from).toBe('trial');
        expect(transition!.to).toBe('expired');
      });

      it('should transition TRIAL -> REFUNDED on refund', async () => {
        const transition = await processEventWithState('trial', 'refund', 'refunded');
        expect(transition!.from).toBe('trial');
        expect(transition!.to).toBe('refunded');
      });
    });

    describe('ACTIVE state transitions', () => {
      it('should stay ACTIVE on renewal', async () => {
        const transition = await processEventWithState('active', 'renewal', 'success');
        expect(transition!.from).toBe('active');
        expect(transition!.to).toBe('active');
      });

      it('should stay ACTIVE on cancellation (cancel at period end)', async () => {
        const transition = await processEventWithState('active', 'cancellation', 'success');
        expect(transition!.from).toBe('active');
        expect(transition!.to).toBe('active');
      });

      it('should transition ACTIVE -> GRACE_PERIOD on grace_period_start', async () => {
        const transition = await processEventWithState('active', 'grace_period_start', 'pending');
        expect(transition!.from).toBe('active');
        expect(transition!.to).toBe('grace_period');
      });

      it('should transition ACTIVE -> BILLING_RETRY on billing_retry', async () => {
        const transition = await processEventWithState('active', 'billing_retry', 'failed');
        expect(transition!.from).toBe('active');
        expect(transition!.to).toBe('billing_retry');
      });

      it('should transition ACTIVE -> EXPIRED on expiration', async () => {
        const transition = await processEventWithState('active', 'expiration', 'success');
        expect(transition!.from).toBe('active');
        expect(transition!.to).toBe('expired');
      });

      it('should transition ACTIVE -> REFUNDED on refund', async () => {
        const transition = await processEventWithState('active', 'refund', 'refunded');
        expect(transition!.from).toBe('active');
        expect(transition!.to).toBe('refunded');
      });

      it('should transition ACTIVE -> REFUNDED on chargeback', async () => {
        const transition = await processEventWithState('active', 'chargeback', 'pending');
        expect(transition!.from).toBe('active');
        expect(transition!.to).toBe('refunded');
      });

      it('should transition ACTIVE -> REVOKED on revoke', async () => {
        const transition = await processEventWithState('active', 'revoke', 'success');
        expect(transition!.from).toBe('active');
        expect(transition!.to).toBe('revoked');
      });

      it('should transition ACTIVE -> PAUSED on pause', async () => {
        const transition = await processEventWithState('active', 'pause', 'success');
        expect(transition!.from).toBe('active');
        expect(transition!.to).toBe('paused');
      });

      it('should stay ACTIVE on upgrade', async () => {
        const transition = await processEventWithState('active', 'upgrade', 'success');
        expect(transition!.from).toBe('active');
        expect(transition!.to).toBe('active');
      });

      it('should stay ACTIVE on downgrade', async () => {
        const transition = await processEventWithState('active', 'downgrade', 'success');
        expect(transition!.from).toBe('active');
        expect(transition!.to).toBe('active');
      });

      it('should stay ACTIVE on crossgrade', async () => {
        const transition = await processEventWithState('active', 'crossgrade', 'success');
        expect(transition!.from).toBe('active');
        expect(transition!.to).toBe('active');
      });

      it('should stay ACTIVE on price_change', async () => {
        const transition = await processEventWithState('active', 'price_change', 'success');
        expect(transition!.from).toBe('active');
        expect(transition!.to).toBe('active');
      });
    });

    describe('GRACE_PERIOD state transitions', () => {
      it('should transition GRACE_PERIOD -> ACTIVE on renewal (recovery)', async () => {
        const transition = await processEventWithState('grace_period', 'renewal', 'success');
        expect(transition!.from).toBe('grace_period');
        expect(transition!.to).toBe('active');
      });

      it('should transition GRACE_PERIOD -> BILLING_RETRY on grace_period_end', async () => {
        const transition = await processEventWithState('grace_period', 'grace_period_end', 'failed');
        expect(transition!.from).toBe('grace_period');
        expect(transition!.to).toBe('billing_retry');
      });

      it('should transition GRACE_PERIOD -> BILLING_RETRY on billing_retry', async () => {
        const transition = await processEventWithState('grace_period', 'billing_retry', 'failed');
        expect(transition!.from).toBe('grace_period');
        expect(transition!.to).toBe('billing_retry');
      });

      it('should transition GRACE_PERIOD -> EXPIRED on expiration', async () => {
        const transition = await processEventWithState('grace_period', 'expiration', 'success');
        expect(transition!.from).toBe('grace_period');
        expect(transition!.to).toBe('expired');
      });

      it('should transition GRACE_PERIOD -> REFUNDED on refund', async () => {
        const transition = await processEventWithState('grace_period', 'refund', 'refunded');
        expect(transition!.from).toBe('grace_period');
        expect(transition!.to).toBe('refunded');
      });
    });

    describe('BILLING_RETRY state transitions', () => {
      it('should transition BILLING_RETRY -> ACTIVE on renewal (payment recovered)', async () => {
        const transition = await processEventWithState('billing_retry', 'renewal', 'success');
        expect(transition!.from).toBe('billing_retry');
        expect(transition!.to).toBe('active');
      });

      it('should stay in BILLING_RETRY on another billing_retry', async () => {
        const transition = await processEventWithState('billing_retry', 'billing_retry', 'failed');
        expect(transition!.from).toBe('billing_retry');
        expect(transition!.to).toBe('billing_retry');
      });

      it('should transition BILLING_RETRY -> EXPIRED on expiration', async () => {
        const transition = await processEventWithState('billing_retry', 'expiration', 'success');
        expect(transition!.from).toBe('billing_retry');
        expect(transition!.to).toBe('expired');
      });
    });

    describe('PAST_DUE state transitions', () => {
      it('should transition PAST_DUE -> ACTIVE on renewal', async () => {
        const transition = await processEventWithState('past_due', 'renewal', 'success');
        expect(transition!.from).toBe('past_due');
        expect(transition!.to).toBe('active');
      });

      it('should transition PAST_DUE -> ACTIVE on purchase', async () => {
        const transition = await processEventWithState('past_due', 'purchase', 'success');
        expect(transition!.from).toBe('past_due');
        expect(transition!.to).toBe('active');
      });

      it('should transition PAST_DUE -> EXPIRED on expiration', async () => {
        const transition = await processEventWithState('past_due', 'expiration', 'success');
        expect(transition!.from).toBe('past_due');
        expect(transition!.to).toBe('expired');
      });
    });

    describe('PAUSED state transitions', () => {
      it('should transition PAUSED -> ACTIVE on resume', async () => {
        const transition = await processEventWithState('paused', 'resume', 'success');
        expect(transition!.from).toBe('paused');
        expect(transition!.to).toBe('active');
      });

      it('should transition PAUSED -> EXPIRED on expiration', async () => {
        const transition = await processEventWithState('paused', 'expiration', 'success');
        expect(transition!.from).toBe('paused');
        expect(transition!.to).toBe('expired');
      });

      it('should transition PAUSED -> EXPIRED on cancellation', async () => {
        const transition = await processEventWithState('paused', 'cancellation', 'success');
        expect(transition!.from).toBe('paused');
        expect(transition!.to).toBe('expired');
      });
    });

    describe('EXPIRED state transitions', () => {
      it('should transition EXPIRED -> ACTIVE on purchase (resubscribe)', async () => {
        const transition = await processEventWithState('expired', 'purchase', 'success');
        expect(transition!.from).toBe('expired');
        expect(transition!.to).toBe('active');
      });

      it('should transition EXPIRED -> ACTIVE on renewal', async () => {
        const transition = await processEventWithState('expired', 'renewal', 'success');
        expect(transition!.from).toBe('expired');
        expect(transition!.to).toBe('active');
      });

      it('should transition EXPIRED -> ACTIVE on offer_redeemed', async () => {
        const transition = await processEventWithState('expired', 'offer_redeemed', 'success');
        expect(transition!.from).toBe('expired');
        expect(transition!.to).toBe('active');
      });

      it('should transition EXPIRED -> TRIAL on trial_start', async () => {
        const transition = await processEventWithState('expired', 'trial_start', 'success');
        expect(transition!.from).toBe('expired');
        expect(transition!.to).toBe('trial');
      });

      it('should return null for irrelevant events in expired state', async () => {
        const transition = await processEventWithState('expired', 'refund', 'refunded');
        expect(transition).toBeNull();
      });
    });

    describe('REVOKED state transitions', () => {
      it('should transition REVOKED -> ACTIVE on purchase', async () => {
        const transition = await processEventWithState('revoked', 'purchase', 'success');
        expect(transition!.from).toBe('revoked');
        expect(transition!.to).toBe('active');
      });

      it('should return null for non-purchase events in revoked state', async () => {
        const transition = await processEventWithState('revoked', 'renewal', 'success');
        expect(transition).toBeNull();
      });
    });

    describe('REFUNDED state transitions', () => {
      it('should transition REFUNDED -> ACTIVE on purchase (resubscribe)', async () => {
        const transition = await processEventWithState('refunded', 'purchase', 'success');
        expect(transition!.from).toBe('refunded');
        expect(transition!.to).toBe('active');
      });

      it('should return null for non-purchase events in refunded state', async () => {
        const transition = await processEventWithState('refunded', 'renewal', 'success');
        expect(transition).toBeNull();
      });
    });

    describe('failed events', () => {
      it('should not transition on failed events with no explicit transition', async () => {
        const event = createTestCanonicalEvent(orgId, {
          userId,
          productId,
          eventType: 'purchase',
          status: 'failed',
        }) as CanonicalEvent;

        const ent = createTestEntitlement(orgId, userId, productId, {
          state: 'active',
          stateHistory: [],
        });
        mockDb._configureSelectResult([ent]);

        const transition = await engine.processEvent(event);

        // 'purchase' from 'active' is not in the state machine, and it's failed
        expect(transition).toBeNull();
      });
    });

    describe('state history tracking', () => {
      it('should append transition to state history', async () => {
        const event = createTestCanonicalEvent(orgId, {
          id: 'event-history-test',
          userId,
          productId,
          eventType: 'purchase',
          status: 'success',
          eventTime: new Date('2025-01-15T12:00:00Z'),
        }) as CanonicalEvent;

        const ent = createTestEntitlement(orgId, userId, productId, {
          state: 'inactive',
          stateHistory: [],
        });
        mockDb._configureSelectResult([ent]);

        const transition = await engine.processEvent(event);

        expect(transition).not.toBeNull();
        expect(transition!.from).toBe('inactive');
        expect(transition!.to).toBe('active');
        expect(transition!.eventType).toBe('purchase');
        expect(transition!.eventId).toBe('event-history-test');

        // Verify update was called with state history
        expect(mockDb.update).toHaveBeenCalled();
        expect(mockDb.set).toHaveBeenCalled();
      });
    });
  });

  describe('hasAccess', () => {
    it('should return true for active state', async () => {
      const ent = createTestEntitlement(orgId, userId, productId, { state: 'active' });
      mockDb._configureSelectResult([ent]);

      const result = await engine.hasAccess(orgId, userId, productId);
      expect(result).toBe(true);
    });

    it('should return true for trial state', async () => {
      const ent = createTestEntitlement(orgId, userId, productId, { state: 'trial' });
      mockDb._configureSelectResult([ent]);

      const result = await engine.hasAccess(orgId, userId, productId);
      expect(result).toBe(true);
    });

    it('should return true for grace_period state', async () => {
      const ent = createTestEntitlement(orgId, userId, productId, { state: 'grace_period' });
      mockDb._configureSelectResult([ent]);

      const result = await engine.hasAccess(orgId, userId, productId);
      expect(result).toBe(true);
    });

    it('should return true for billing_retry state', async () => {
      const ent = createTestEntitlement(orgId, userId, productId, { state: 'billing_retry' });
      mockDb._configureSelectResult([ent]);

      const result = await engine.hasAccess(orgId, userId, productId);
      expect(result).toBe(true);
    });

    it('should return false for expired state', async () => {
      const ent = createTestEntitlement(orgId, userId, productId, { state: 'expired' });
      mockDb._configureSelectResult([ent]);

      const result = await engine.hasAccess(orgId, userId, productId);
      expect(result).toBe(false);
    });

    it('should return false for revoked state', async () => {
      const ent = createTestEntitlement(orgId, userId, productId, { state: 'revoked' });
      mockDb._configureSelectResult([ent]);

      const result = await engine.hasAccess(orgId, userId, productId);
      expect(result).toBe(false);
    });

    it('should return false for refunded state', async () => {
      const ent = createTestEntitlement(orgId, userId, productId, { state: 'refunded' });
      mockDb._configureSelectResult([ent]);

      const result = await engine.hasAccess(orgId, userId, productId);
      expect(result).toBe(false);
    });

    it('should return false for paused state', async () => {
      const ent = createTestEntitlement(orgId, userId, productId, { state: 'paused' });
      mockDb._configureSelectResult([ent]);

      const result = await engine.hasAccess(orgId, userId, productId);
      expect(result).toBe(false);
    });

    it('should return false for inactive state', async () => {
      const ent = createTestEntitlement(orgId, userId, productId, { state: 'inactive' });
      mockDb._configureSelectResult([ent]);

      const result = await engine.hasAccess(orgId, userId, productId);
      expect(result).toBe(false);
    });

    it('should return false when no entitlement exists', async () => {
      mockDb._configureSelectResult([]);

      const result = await engine.hasAccess(orgId, userId, productId);
      expect(result).toBe(false);
    });
  });

  // Helper to process an event with a given initial state
  async function processEventWithState(
    currentState: EntitlementState,
    eventType: EventType,
    status: string,
  ) {
    const event = createTestCanonicalEvent(orgId, {
      id: `event-${currentState}-${eventType}`,
      userId,
      productId,
      eventType,
      status,
      eventTime: new Date(),
    }) as CanonicalEvent;

    const ent = createTestEntitlement(orgId, userId, productId, {
      state: currentState,
      stateHistory: [],
    });

    mockDb._configureSelectResult([ent]);

    return engine.processEvent(event);
  }
});

function createEntitlementMockDb() {
  let selectResult: any[] = [];
  let insertResult: any[] = [];
  // returning() for update operations should return a non-empty array by default
  // (the engine checks updated.length === 0 for optimistic lock detection)
  let updateReturningResult: any[] = [{ id: 'updated' }];
  let lastOp: 'select' | 'insert' | 'update' = 'select';

  const chainable: any = {
    select: vi.fn().mockImplementation(function (this: any) {
      lastOp = 'select';
      return this;
    }),
    insert: vi.fn().mockImplementation(function (this: any) {
      lastOp = 'insert';
      return this;
    }),
    update: vi.fn().mockImplementation(function (this: any) {
      lastOp = 'update';
      return this;
    }),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => Promise.resolve(selectResult)),
    returning: vi.fn().mockImplementation(function () {
      if (lastOp === 'update') return Promise.resolve(updateReturningResult);
      return Promise.resolve(insertResult);
    }),
    onConflictDoNothing: vi.fn().mockImplementation(() => Promise.resolve([])),
    catch: vi.fn().mockReturnThis(),

    _configureSelectResult(data: any[]) {
      selectResult = data;
    },
    _configureInsertResult(data: any[]) {
      insertResult = data;
    },
  };

  return chainable;
}
