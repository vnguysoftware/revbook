import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crossPlatformMismatchDetector } from '../../detection/detectors/cross-platform-mismatch.js';
import { createTestCanonicalEvent, createTestEntitlement, resetUuidCounter } from '../helpers.js';
import type { CanonicalEvent } from '../../models/types.js';

describe('CrossPlatformMismatchDetector', () => {
  const orgId = 'org_cpm_test';
  const userId = 'user_cpm_001';
  const productId = 'product_cpm_001';
  let mockDb: any;

  beforeEach(() => {
    resetUuidCounter();
    mockDb = createDetectorMockDb();
  });

  describe('metadata', () => {
    it('should have correct detector id', () => {
      expect(crossPlatformMismatchDetector.id).toBe('cross_platform_mismatch');
    });
  });

  describe('checkEvent', () => {
    it('should detect mismatch when one platform is active and another is expired', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'renewal',
        status: 'success',
      }) as CanonicalEvent;

      const entStripe = createTestEntitlement(orgId, userId, productId, {
        id: 'ent-stripe',
        source: 'stripe',
        state: 'active',
        updatedAt: new Date(),
      });
      const entApple = createTestEntitlement(orgId, userId, productId, {
        id: 'ent-apple',
        source: 'apple',
        state: 'expired',
        updatedAt: new Date(),
      });

      // The detector queries all user entitlements and groups by product
      mockDb._configureWhereResult([entStripe, entApple]);

      const issues = await crossPlatformMismatchDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues.some(i => i.issueType === 'cross_platform_mismatch')).toBe(true);
      const mismatch = issues.find(i => i.issueType === 'cross_platform_mismatch')!;
      expect(mismatch.severity).toBe('critical');
      expect(mismatch.confidence).toBe(0.85);
      expect(mismatch.userId).toBe(userId);
    });

    it('should detect duplicate active subscriptions', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'renewal',
        status: 'success',
      }) as CanonicalEvent;

      const entStripe = createTestEntitlement(orgId, userId, productId, {
        id: 'ent-stripe-dup',
        source: 'stripe',
        state: 'active',
        updatedAt: new Date(),
      });
      const entApple = createTestEntitlement(orgId, userId, productId, {
        id: 'ent-apple-dup',
        source: 'apple',
        state: 'active',
        updatedAt: new Date(),
      });

      mockDb._configureWhereResult([entStripe, entApple]);

      const issues = await crossPlatformMismatchDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues.some(i => i.issueType === 'duplicate_subscription')).toBe(true);
      const dup = issues.find(i => i.issueType === 'duplicate_subscription')!;
      expect(dup.severity).toBe('warning');
    });

    it('should NOT detect issues when only one platform exists', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'renewal',
        status: 'success',
      }) as CanonicalEvent;

      const entStripe = createTestEntitlement(orgId, userId, productId, {
        source: 'stripe',
        state: 'active',
      });

      mockDb._configureWhereResult([entStripe]);

      const issues = await crossPlatformMismatchDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(0);
    });

    it('should NOT detect issues when all platforms have same category of state', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'renewal',
        status: 'success',
      }) as CanonicalEvent;

      const entStripe = createTestEntitlement(orgId, userId, productId, {
        source: 'stripe',
        state: 'expired',
      });
      const entApple = createTestEntitlement(orgId, userId, productId, {
        source: 'apple',
        state: 'expired',
      });

      mockDb._configureWhereResult([entStripe, entApple]);

      const issues = await crossPlatformMismatchDetector.checkEvent(mockDb, orgId, userId, event);

      // No mismatch, no duplicate active
      expect(issues.filter(i => i.issueType === 'cross_platform_mismatch')).toHaveLength(0);
      expect(issues.filter(i => i.issueType === 'duplicate_subscription')).toHaveLength(0);
    });

    it('should include evidence with all platform states', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'renewal',
        status: 'success',
      }) as CanonicalEvent;

      const entStripe = createTestEntitlement(orgId, userId, productId, {
        id: 'ent-stripe-ev',
        source: 'stripe',
        state: 'active',
        updatedAt: new Date('2025-01-15T12:00:00Z'),
      });
      const entApple = createTestEntitlement(orgId, userId, productId, {
        id: 'ent-apple-ev',
        source: 'apple',
        state: 'revoked',
        updatedAt: new Date('2025-01-14T12:00:00Z'),
      });

      mockDb._configureWhereResult([entStripe, entApple]);

      const issues = await crossPlatformMismatchDetector.checkEvent(mockDb, orgId, userId, event);

      const mismatch = issues.find(i => i.issueType === 'cross_platform_mismatch')!;
      expect(mismatch.evidence.productId).toBe(productId);
      expect((mismatch.evidence.states as any[]).length).toBe(2);
    });

    it('should handle multiple products independently', async () => {
      const event = createTestCanonicalEvent(orgId, {
        userId,
        productId,
        eventType: 'renewal',
        status: 'success',
      }) as CanonicalEvent;

      const product2 = 'product_cpm_002';

      // Product 1: mismatched
      const ent1Stripe = createTestEntitlement(orgId, userId, productId, {
        source: 'stripe',
        state: 'active',
        updatedAt: new Date(),
      });
      const ent1Apple = createTestEntitlement(orgId, userId, productId, {
        source: 'apple',
        state: 'expired',
        updatedAt: new Date(),
      });
      // Product 2: both active (duplicate)
      const ent2Stripe = createTestEntitlement(orgId, userId, product2, {
        source: 'stripe',
        state: 'active',
        updatedAt: new Date(),
      });
      const ent2Apple = createTestEntitlement(orgId, userId, product2, {
        source: 'apple',
        state: 'active',
        updatedAt: new Date(),
      });

      mockDb._configureWhereResult([ent1Stripe, ent1Apple, ent2Stripe, ent2Apple]);

      const issues = await crossPlatformMismatchDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues.some(i => i.issueType === 'cross_platform_mismatch')).toBe(true);
      expect(issues.some(i => i.issueType === 'duplicate_subscription')).toBe(true);
    });
  });
});

function createDetectorMockDb() {
  let whereResult: any[] = [];

  const chainable: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockImplementation(() => Promise.resolve(whereResult)),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    catch: vi.fn().mockReturnThis(),

    _configureWhereResult(data: any[]) {
      whereResult = data;
    },
  };

  return chainable;
}
