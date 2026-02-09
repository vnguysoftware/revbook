import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifiedAccessNoPaymentDetector } from '../../detection/detectors/verified-access-no-payment.js';
import { createTestEntitlement, resetUuidCounter } from '../helpers.js';

// Mock the tier helper
vi.mock('../../detection/tier.js', () => ({
  hasAccessCheckData: vi.fn(),
}));

import { hasAccessCheckData } from '../../detection/tier.js';

describe('VerifiedAccessNoPaymentDetector', () => {
  const orgId = 'org_vanp_test';
  const userId = 'user_vanp_001';
  const productId = 'product_vanp_001';
  let mockDb: any;

  beforeEach(() => {
    resetUuidCounter();
    mockDb = createDetectorMockDb();
    vi.mocked(hasAccessCheckData).mockResolvedValue(true);
  });

  describe('metadata', () => {
    it('should have correct detector id', () => {
      expect(verifiedAccessNoPaymentDetector.id).toBe('verified_access_no_payment');
    });

    it('should have name and description', () => {
      expect(verifiedAccessNoPaymentDetector.name).toBe('Access Without Payment');
      expect(verifiedAccessNoPaymentDetector.description).toBeTruthy();
    });
  });

  describe('checkEvent', () => {
    it('should always return empty (scheduled scan only)', async () => {
      const issues = await verifiedAccessNoPaymentDetector.checkEvent(mockDb, orgId, userId, {} as any);
      expect(issues).toHaveLength(0);
    });
  });

  describe('scheduledScan', () => {
    it('should return empty when org has no access-check data', async () => {
      vi.mocked(hasAccessCheckData).mockResolvedValue(false);

      const issues = await verifiedAccessNoPaymentDetector.scheduledScan!(mockDb, orgId);
      expect(issues).toHaveLength(0);
    });

    it('should detect when hasAccess=true but entitlement is expired', async () => {
      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'expired',
      });

      mockDb._configureSelectSequence([
        // access checks with hasAccess=true
        [{ id: 'check-1', orgId, userId, hasAccess: true, reportedAt: new Date() }],
        // entitlements for that user
        [ent],
      ]);

      const issues = await verifiedAccessNoPaymentDetector.scheduledScan!(mockDb, orgId);

      expect(issues).toHaveLength(1);
      expect(issues[0].issueType).toBe('verified_access_no_payment');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].confidence).toBe(0.95);
      expect(issues[0].detectionTier).toBe('app_verified');
    });

    it('should NOT detect when hasAccess=true and entitlement is active', async () => {
      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'active',
      });

      mockDb._configureSelectSequence([
        [{ id: 'check-1', orgId, userId, hasAccess: true, reportedAt: new Date() }],
        [ent],
      ]);

      const issues = await verifiedAccessNoPaymentDetector.scheduledScan!(mockDb, orgId);

      expect(issues).toHaveLength(0);
    });

    it('should NOT detect when access check user has no resolved userId', async () => {
      mockDb._configureSelectSequence([
        [{ id: 'check-1', orgId, userId: null, hasAccess: true, reportedAt: new Date() }],
      ]);

      const issues = await verifiedAccessNoPaymentDetector.scheduledScan!(mockDb, orgId);

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
