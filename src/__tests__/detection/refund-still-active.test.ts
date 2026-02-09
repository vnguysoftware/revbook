import { describe, it, expect, vi, beforeEach } from 'vitest';
import { refundStillActiveDetector } from '../../detection/detectors/refund-still-active.js';
import { createTestCanonicalEvent, createTestEntitlement, resetUuidCounter } from '../helpers.js';
import type { CanonicalEvent } from '../../models/types.js';

describe('RefundStillActiveDetector', () => {
  const orgId = 'org_rsa_test';
  const userId = 'user_rsa_001';
  const productId = 'product_rsa_001';
  let mockDb: any;

  beforeEach(() => {
    resetUuidCounter();
    mockDb = createDetectorMockDb();
  });

  describe('metadata', () => {
    it('should have correct detector id', () => {
      expect(refundStillActiveDetector.id).toBe('refund_still_active');
    });
  });

  describe('checkEvent', () => {
    it('should detect issue when refund occurs but entitlement is active', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'refund',
        status: 'refunded',
        amountCents: 1999,
        currency: 'USD',
      }) as CanonicalEvent;

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'active',
      });
      mockDb._configureSelectResult([ent]);

      const issues = await refundStillActiveDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(1);
      expect(issues[0].issueType).toBe('refund_still_active');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].confidence).toBe(0.92);
      expect(issues[0].estimatedRevenueCents).toBe(1999);
    });

    it('should detect with critical severity when chargeback occurs', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'chargeback',
        status: 'pending',
        amountCents: 4999,
      }) as CanonicalEvent;

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'active',
      });
      mockDb._configureSelectResult([ent]);

      const issues = await refundStillActiveDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
    });

    it('should detect when entitlement is in trial', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'refund',
        status: 'refunded',
      }) as CanonicalEvent;

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'trial',
      });
      mockDb._configureSelectResult([ent]);

      const issues = await refundStillActiveDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(1);
    });

    it('should detect when entitlement is in grace_period', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'refund',
        status: 'refunded',
      }) as CanonicalEvent;

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'grace_period',
      });
      mockDb._configureSelectResult([ent]);

      const issues = await refundStillActiveDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(1);
    });

    it('should detect when entitlement is in billing_retry', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'refund',
        status: 'refunded',
      }) as CanonicalEvent;

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'billing_retry',
      });
      mockDb._configureSelectResult([ent]);

      const issues = await refundStillActiveDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(1);
    });

    it('should NOT detect when entitlement is already expired', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'refund',
        status: 'refunded',
      }) as CanonicalEvent;

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'expired',
      });
      mockDb._configureSelectResult([ent]);

      const issues = await refundStillActiveDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(0);
    });

    it('should NOT detect when entitlement is already revoked', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'refund',
        status: 'refunded',
      }) as CanonicalEvent;

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'revoked',
      });
      mockDb._configureSelectResult([ent]);

      const issues = await refundStillActiveDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(0);
    });

    it('should NOT detect when entitlement is already refunded', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'refund',
        status: 'refunded',
      }) as CanonicalEvent;

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'refunded',
      });
      mockDb._configureSelectResult([ent]);

      const issues = await refundStillActiveDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(0);
    });

    it('should NOT detect for non-refund/chargeback events', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'renewal',
        status: 'success',
      }) as CanonicalEvent;

      const issues = await refundStillActiveDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(0);
    });

    it('should NOT detect when no productId', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId: null,
        eventType: 'refund',
        status: 'refunded',
      }) as CanonicalEvent;

      const issues = await refundStillActiveDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(0);
    });

    it('should NOT detect when no entitlement exists', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'refund',
        status: 'refunded',
      }) as CanonicalEvent;

      mockDb._configureSelectResult([]);

      const issues = await refundStillActiveDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(0);
    });

    it('should include correct evidence', async () => {
      const event = createTestCanonicalEvent(orgId, {
        id: 'rsa-evidence-event',
        userId,
        productId,
        eventType: 'refund',
        status: 'refunded',
        amountCents: 2999,
        currency: 'EUR',
      }) as CanonicalEvent;

      const ent = createTestEntitlement(orgId, userId, productId, {
        id: 'rsa-evidence-ent',
        state: 'active',
      });
      mockDb._configureSelectResult([ent]);

      const issues = await refundStillActiveDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues[0].evidence).toMatchObject({
        eventId: 'rsa-evidence-event',
        eventType: 'refund',
        amount: 2999,
        currency: 'EUR',
        entitlementId: 'rsa-evidence-ent',
        entitlementState: 'active',
      });
    });
  });

  describe('scheduledScan', () => {
    it('should not have a scheduledScan method (event-triggered only)', () => {
      expect(refundStillActiveDetector.scheduledScan).toBeUndefined();
    });
  });
});

function createDetectorMockDb() {
  let selectResult: any[] = [];

  const chainable: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => Promise.resolve(selectResult)),
    returning: vi.fn().mockImplementation(() => Promise.resolve(selectResult)),
    orderBy: vi.fn().mockReturnThis(),
    catch: vi.fn().mockReturnThis(),

    _configureSelectResult(data: any[]) {
      selectResult = data;
    },
  };

  return chainable;
}
