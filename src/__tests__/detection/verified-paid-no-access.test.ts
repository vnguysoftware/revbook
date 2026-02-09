import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifiedPaidNoAccessDetector } from '../../detection/detectors/verified-paid-no-access.js';
import { createTestEntitlement, resetUuidCounter } from '../helpers.js';

// Mock the tier helper
vi.mock('../../detection/tier.js', () => ({
  hasAccessCheckData: vi.fn(),
}));

import { hasAccessCheckData } from '../../detection/tier.js';

describe('VerifiedPaidNoAccessDetector', () => {
  const orgId = 'org_vpna_test';
  const userId = 'user_vpna_001';
  const productId = 'product_vpna_001';
  let mockDb: any;

  beforeEach(() => {
    resetUuidCounter();
    mockDb = createDetectorMockDb();
    vi.mocked(hasAccessCheckData).mockResolvedValue(true);
  });

  describe('metadata', () => {
    it('should have correct detector id', () => {
      expect(verifiedPaidNoAccessDetector.id).toBe('verified_paid_no_access');
    });

    it('should have name and description', () => {
      expect(verifiedPaidNoAccessDetector.name).toBe('Paid But No Access');
      expect(verifiedPaidNoAccessDetector.description).toBeTruthy();
    });
  });

  describe('checkEvent', () => {
    it('should always return empty (scheduled scan only)', async () => {
      const issues = await verifiedPaidNoAccessDetector.checkEvent(mockDb, orgId, userId, {} as any);
      expect(issues).toHaveLength(0);
    });
  });

  describe('scheduledScan', () => {
    it('should return empty when org has no access-check data', async () => {
      vi.mocked(hasAccessCheckData).mockResolvedValue(false);

      const issues = await verifiedPaidNoAccessDetector.scheduledScan!(mockDb, orgId);
      expect(issues).toHaveLength(0);
    });

    it('should detect when active entitlement has hasAccess=false', async () => {
      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'active',
      });

      // First call: entitlements query returns active entitlements
      // Second call: access checks query returns hasAccess=false
      let callCount = 0;
      mockDb._configureSelectSequence([
        [ent], // active entitlements
        [{ id: 'check-1', orgId, userId, hasAccess: false, reportedAt: new Date() }], // latest access check
      ]);

      const issues = await verifiedPaidNoAccessDetector.scheduledScan!(mockDb, orgId);

      expect(issues).toHaveLength(1);
      expect(issues[0].issueType).toBe('verified_paid_no_access');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].confidence).toBe(0.95);
      expect(issues[0].detectionTier).toBe('app_verified');
    });

    it('should NOT detect when active entitlement has hasAccess=true', async () => {
      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'active',
      });

      mockDb._configureSelectSequence([
        [ent], // active entitlements
        [{ id: 'check-1', orgId, userId, hasAccess: true, reportedAt: new Date() }], // latest access check
      ]);

      const issues = await verifiedPaidNoAccessDetector.scheduledScan!(mockDb, orgId);

      expect(issues).toHaveLength(0);
    });

    it('should NOT detect when no access check exists for user', async () => {
      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'active',
      });

      mockDb._configureSelectSequence([
        [ent], // active entitlements
        [], // no access check
      ]);

      const issues = await verifiedPaidNoAccessDetector.scheduledScan!(mockDb, orgId);

      expect(issues).toHaveLength(0);
    });
  });
});

function createDetectorMockDb() {
  let selectResults: any[][] = [];
  let callIndex = 0;

  const chainable: any = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => {
      const result = selectResults[callIndex] || [];
      callIndex++;
      return Promise.resolve(result);
    }),
    // For queries without limit (returns iterable)
    then: vi.fn().mockImplementation((resolve: any) => {
      const result = selectResults[callIndex] || [];
      callIndex++;
      resolve(result);
    }),

    _configureSelectSequence(results: any[][]) {
      selectResults = results;
      callIndex = 0;
    },
  };

  return chainable;
}
