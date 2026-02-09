import { describe, it, expect, vi, beforeEach } from 'vitest';
import { accessNoPaymentDetector } from '../../detection/detectors/access-no-payment.js';
import { createTestCanonicalEvent, createTestEntitlement, resetUuidCounter } from '../helpers.js';
import type { CanonicalEvent } from '../../models/types.js';

describe('AccessNoPaymentDetector', () => {
  const orgId = 'org_anp_test';
  const userId = 'user_anp_001';
  const productId = 'product_anp_001';
  let mockDb: any;

  beforeEach(() => {
    resetUuidCounter();
    mockDb = createDetectorMockDb();
  });

  describe('metadata', () => {
    it('should have correct detector id', () => {
      expect(accessNoPaymentDetector.id).toBe('entitlement_without_payment');
    });
  });

  describe('checkEvent', () => {
    it('should detect issue when billing_retry fails but entitlement is active', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'billing_retry',
        status: 'failed',
        amountCents: 1999,
      }) as CanonicalEvent;

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'active',
      });
      mockDb._configureSelectResult([ent]);

      const issues = await accessNoPaymentDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(1);
      expect(issues[0].issueType).toBe('entitlement_without_payment');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].confidence).toBe(0.80);
    });

    it('should NOT detect when billing_retry fails and entitlement is NOT active', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'billing_retry',
        status: 'failed',
      }) as CanonicalEvent;

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'expired',
      });
      mockDb._configureSelectResult([ent]);

      const issues = await accessNoPaymentDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(0);
    });

    it('should NOT detect for non-billing_retry events', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'renewal',
        status: 'success',
      }) as CanonicalEvent;

      const issues = await accessNoPaymentDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(0);
    });

    it('should NOT detect for successful billing_retry events', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'billing_retry',
        status: 'success',
      }) as CanonicalEvent;

      const issues = await accessNoPaymentDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(0);
    });

    it('should NOT detect when no productId', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId: null,
        eventType: 'billing_retry',
        status: 'failed',
      }) as CanonicalEvent;

      const issues = await accessNoPaymentDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(0);
    });

    it('should include evidence with event and entitlement details', async () => {
      const event = createTestCanonicalEvent(orgId, {
        id: 'anp-evidence-event',
        userId,
        productId,
        eventType: 'billing_retry',
        status: 'failed',
        eventTime: new Date('2025-01-15T12:00:00Z'),
      }) as CanonicalEvent;

      const ent = createTestEntitlement(orgId, userId, productId, {
        id: 'anp-evidence-ent',
        state: 'active',
      });
      mockDb._configureSelectResult([ent]);

      const issues = await accessNoPaymentDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues[0].evidence).toMatchObject({
        eventId: 'anp-evidence-event',
        entitlementId: 'anp-evidence-ent',
        entitlementState: 'active',
      });
    });
  });

  describe('scheduledScan', () => {
    it('should have a scheduledScan method', () => {
      expect(accessNoPaymentDetector.scheduledScan).toBeDefined();
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
