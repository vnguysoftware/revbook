import { describe, it, expect, vi, beforeEach } from 'vitest';
import { paidNoAccessDetector } from '../../detection/detectors/paid-no-access.js';
import { createTestCanonicalEvent, createTestEntitlement, resetUuidCounter } from '../helpers.js';
import type { CanonicalEvent } from '../../models/types.js';

describe('PaidNoAccessDetector', () => {
  const orgId = 'org_pna_test';
  const userId = 'user_pna_001';
  const productId = 'product_pna_001';
  let mockDb: any;

  beforeEach(() => {
    resetUuidCounter();
    mockDb = createDetectorMockDb();
  });

  describe('metadata', () => {
    it('should have correct detector id', () => {
      expect(paidNoAccessDetector.id).toBe('paid_no_access');
    });

    it('should have a name and description', () => {
      expect(paidNoAccessDetector.name).toBeTruthy();
      expect(paidNoAccessDetector.description).toBeTruthy();
    });
  });

  describe('checkEvent', () => {
    it('should detect issue when purchase succeeds but entitlement is inactive', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'purchase',
        status: 'success',
        amountCents: 1999,
        currency: 'USD',
      }) as CanonicalEvent;

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'inactive',
      });
      mockDb._configureSelectResult([ent]);

      const issues = await paidNoAccessDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(1);
      expect(issues[0].issueType).toBe('paid_no_access');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].confidence).toBe(0.95);
      expect(issues[0].estimatedRevenueCents).toBe(1999);
      expect(issues[0].userId).toBe(userId);
    });

    it('should detect issue when renewal succeeds but entitlement is expired', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'renewal',
        status: 'success',
        amountCents: 999,
      }) as CanonicalEvent;

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'expired',
      });
      mockDb._configureSelectResult([ent]);

      const issues = await paidNoAccessDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(1);
      expect(issues[0].issueType).toBe('paid_no_access');
    });

    it('should detect issue when entitlement is revoked', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'purchase',
        status: 'success',
      }) as CanonicalEvent;

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'revoked',
      });
      mockDb._configureSelectResult([ent]);

      const issues = await paidNoAccessDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(1);
    });

    it('should detect issue when entitlement is refunded', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'purchase',
        status: 'success',
      }) as CanonicalEvent;

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'refunded',
      });
      mockDb._configureSelectResult([ent]);

      const issues = await paidNoAccessDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(1);
    });

    it('should NOT detect issue when entitlement is active', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'renewal',
        status: 'success',
      }) as CanonicalEvent;

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'active',
      });
      mockDb._configureSelectResult([ent]);

      const issues = await paidNoAccessDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(0);
    });

    it('should NOT detect issue for failed payments', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'renewal',
        status: 'failed',
      }) as CanonicalEvent;

      const issues = await paidNoAccessDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(0);
    });

    it('should NOT detect issue for non-payment events', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'cancellation',
        status: 'success',
      }) as CanonicalEvent;

      const issues = await paidNoAccessDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(0);
    });

    it('should NOT detect issue when no productId', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId: null,
        eventType: 'purchase',
        status: 'success',
      }) as CanonicalEvent;

      const issues = await paidNoAccessDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(0);
    });

    it('should NOT detect issue when no entitlement exists', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'purchase',
        status: 'success',
      }) as CanonicalEvent;

      mockDb._configureSelectResult([]);

      const issues = await paidNoAccessDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(0);
    });

    it('should include evidence with event and entitlement details', async () => {
      const event = createTestCanonicalEvent(orgId, {
        id: 'evidence-test-event',
        userId,
        productId,
        eventType: 'purchase',
        status: 'success',
        amountCents: 2499,
        currency: 'EUR',
        source: 'stripe',
      }) as CanonicalEvent;

      const ent = createTestEntitlement(orgId, userId, productId, {
        id: 'evidence-test-ent',
        state: 'expired',
      });
      mockDb._configureSelectResult([ent]);

      const issues = await paidNoAccessDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues[0].evidence).toMatchObject({
        eventId: 'evidence-test-event',
        entitlementState: 'expired',
        entitlementId: 'evidence-test-ent',
        source: 'stripe',
      });
    });
  });

  describe('scheduledScan', () => {
    it('should have a scheduledScan method', () => {
      expect(paidNoAccessDetector.scheduledScan).toBeDefined();
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
    then: vi.fn().mockImplementation((resolve: any) => resolve(selectResult)),

    _configureSelectResult(data: any[]) {
      selectResult = data;
    },
  };

  return chainable;
}
