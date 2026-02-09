import { describe, it, expect, vi, beforeEach } from 'vitest';
import { silentRenewalFailureDetector } from '../../detection/detectors/silent-renewal-failure.js';
import { createTestCanonicalEvent, createTestEntitlement, resetUuidCounter } from '../helpers.js';
import type { CanonicalEvent } from '../../models/types.js';

describe('SilentRenewalFailureDetector', () => {
  const orgId = 'org_srf_test';
  const userId = 'user_srf_001';
  const productId = 'product_srf_001';

  describe('metadata', () => {
    it('should have correct detector id', () => {
      expect(silentRenewalFailureDetector.id).toBe('silent_renewal_failure');
    });
  });

  describe('checkEvent', () => {
    it('should always return empty array (scheduled-only detector)', async () => {
      const mockDb: any = {};
      const event = createTestCanonicalEvent(orgId) as CanonicalEvent;

      const issues = await silentRenewalFailureDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(0);
    });
  });

  describe('scheduledScan', () => {
    it('should have a scheduledScan method', () => {
      expect(silentRenewalFailureDetector.scheduledScan).toBeDefined();
    });

    it('should detect when period ended hours ago with no renewal event', async () => {
      // Simulate period ending 3 hours ago
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'active',
        source: 'apple',
        currentPeriodEnd: threeHoursAgo,
        externalSubscriptionId: 'orig_txn_001',
      });

      let queryNum = 0;
      const mockDb: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => {
          queryNum++;
          if (queryNum === 1) {
            // First query: find candidate entitlements
            return Promise.resolve([ent]);
          }
          // Second query: check for recent events (none found)
          return mockDb;
        }),
        limit: vi.fn().mockImplementation(() => Promise.resolve([])),
      };

      const issues = await silentRenewalFailureDetector.scheduledScan!(mockDb, orgId);

      expect(issues).toHaveLength(1);
      expect(issues[0].issueType).toBe('silent_renewal_failure');
      expect(issues[0].userId).toBe(userId);
    });

    it('should NOT detect when recent renewal event exists', async () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'active',
        currentPeriodEnd: threeHoursAgo,
      });

      let queryNum = 0;
      const mockDb: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => {
          queryNum++;
          if (queryNum === 1) {
            return Promise.resolve([ent]);
          }
          return mockDb;
        }),
        // Renewal event found
        limit: vi.fn().mockImplementation(() => Promise.resolve([{ id: 'renewal-event' }])),
      };

      const issues = await silentRenewalFailureDetector.scheduledScan!(mockDb, orgId);

      expect(issues).toHaveLength(0);
    });

    it('should assign critical severity after 6 hours', async () => {
      const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000);

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'active',
        source: 'stripe',
        currentPeriodEnd: eightHoursAgo,
      });

      let queryNum = 0;
      const mockDb: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => {
          queryNum++;
          if (queryNum === 1) return Promise.resolve([ent]);
          return mockDb;
        }),
        limit: vi.fn().mockImplementation(() => Promise.resolve([])),
      };

      const issues = await silentRenewalFailureDetector.scheduledScan!(mockDb, orgId);

      expect(issues[0].severity).toBe('critical');
    });

    it('should assign warning severity before 6 hours', async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'active',
        source: 'stripe',
        currentPeriodEnd: twoHoursAgo,
      });

      let queryNum = 0;
      const mockDb: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => {
          queryNum++;
          if (queryNum === 1) return Promise.resolve([ent]);
          return mockDb;
        }),
        limit: vi.fn().mockImplementation(() => Promise.resolve([])),
      };

      const issues = await silentRenewalFailureDetector.scheduledScan!(mockDb, orgId);

      expect(issues[0].severity).toBe('warning');
    });

    it('should increase confidence with time', async () => {
      const tenHoursAgo = new Date(Date.now() - 10 * 60 * 60 * 1000);

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'active',
        currentPeriodEnd: tenHoursAgo,
      });

      let queryNum = 0;
      const mockDb: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => {
          queryNum++;
          if (queryNum === 1) return Promise.resolve([ent]);
          return mockDb;
        }),
        limit: vi.fn().mockImplementation(() => Promise.resolve([])),
      };

      const issues = await silentRenewalFailureDetector.scheduledScan!(mockDb, orgId);

      // Confidence = min(0.5 + hours * 0.05, 0.95)
      // At 10 hours: min(0.5 + 10*0.05, 0.95) = min(1.0, 0.95) = 0.95
      expect(issues[0].confidence).toBeLessThanOrEqual(0.95);
      expect(issues[0].confidence).toBeGreaterThan(0.5);
    });

    it('should skip entitlements without currentPeriodEnd', async () => {
      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'active',
        currentPeriodEnd: null,
      });

      let queryNum = 0;
      const mockDb: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => {
          queryNum++;
          if (queryNum === 1) return Promise.resolve([ent]);
          return mockDb;
        }),
        limit: vi.fn().mockImplementation(() => Promise.resolve([])),
      };

      const issues = await silentRenewalFailureDetector.scheduledScan!(mockDb, orgId);

      expect(issues).toHaveLength(0);
    });
  });
});
