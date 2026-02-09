import { describe, it, expect, vi, beforeEach } from 'vitest';
import { trialNoConversionDetector } from '../../detection/detectors/trial-no-conversion.js';
import { createTestCanonicalEvent, createTestEntitlement, resetUuidCounter } from '../helpers.js';
import type { CanonicalEvent } from '../../models/types.js';

describe('TrialNoConversionDetector', () => {
  const orgId = 'org_tnc_test';
  const userId = 'user_tnc_001';
  const productId = 'product_tnc_001';

  describe('metadata', () => {
    it('should have correct detector id', () => {
      expect(trialNoConversionDetector.id).toBe('trial_no_conversion');
    });
  });

  describe('checkEvent', () => {
    it('should always return empty array (scheduled-only detector)', async () => {
      const mockDb: any = {};
      const event = createTestCanonicalEvent(orgId) as CanonicalEvent;

      const issues = await trialNoConversionDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(0);
    });
  });

  describe('scheduledScan', () => {
    it('should have a scheduledScan method', () => {
      expect(trialNoConversionDetector.scheduledScan).toBeDefined();
    });

    it('should detect trial expired without conversion', async () => {
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'trial',
        source: 'stripe',
        trialEnd: fourHoursAgo,
      });

      const mockDb: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => Promise.resolve([ent])),
      };

      const issues = await trialNoConversionDetector.scheduledScan!(mockDb, orgId);

      expect(issues).toHaveLength(1);
      expect(issues[0].issueType).toBe('trial_no_conversion');
      expect(issues[0].userId).toBe(userId);
    });

    it('should assign warning severity after 12 hours', async () => {
      const fifteenHoursAgo = new Date(Date.now() - 15 * 60 * 60 * 1000);

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'trial',
        trialEnd: fifteenHoursAgo,
      });

      const mockDb: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => Promise.resolve([ent])),
      };

      const issues = await trialNoConversionDetector.scheduledScan!(mockDb, orgId);

      expect(issues[0].severity).toBe('warning');
    });

    it('should assign info severity before 12 hours', async () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'trial',
        trialEnd: threeHoursAgo,
      });

      const mockDb: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => Promise.resolve([ent])),
      };

      const issues = await trialNoConversionDetector.scheduledScan!(mockDb, orgId);

      expect(issues[0].severity).toBe('info');
    });

    it('should calculate increasing confidence over time', async () => {
      const tenHoursAgo = new Date(Date.now() - 10 * 60 * 60 * 1000);

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'trial',
        trialEnd: tenHoursAgo,
      });

      const mockDb: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => Promise.resolve([ent])),
      };

      const issues = await trialNoConversionDetector.scheduledScan!(mockDb, orgId);

      // Confidence = min(0.6 + hours * 0.02, 0.90)
      // At 10 hours: min(0.6 + 10*0.02, 0.90) = min(0.8, 0.90) = 0.8
      expect(issues[0].confidence).toBeCloseTo(0.8, 1);
    });

    it('should cap confidence at 0.90', async () => {
      const fortyHoursAgo = new Date(Date.now() - 40 * 60 * 60 * 1000);

      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'trial',
        trialEnd: fortyHoursAgo,
      });

      const mockDb: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => Promise.resolve([ent])),
      };

      const issues = await trialNoConversionDetector.scheduledScan!(mockDb, orgId);

      expect(issues[0].confidence).toBeLessThanOrEqual(0.90);
    });

    it('should skip entitlements without trialEnd', async () => {
      const ent = createTestEntitlement(orgId, userId, productId, {
        state: 'trial',
        trialEnd: null,
      });

      const mockDb: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => Promise.resolve([ent])),
      };

      const issues = await trialNoConversionDetector.scheduledScan!(mockDb, orgId);

      expect(issues).toHaveLength(0);
    });

    it('should include evidence with entitlement details', async () => {
      const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);

      const ent = createTestEntitlement(orgId, userId, productId, {
        id: 'tnc-evidence-ent',
        state: 'trial',
        source: 'apple',
        trialEnd: fiveHoursAgo,
      });

      const mockDb: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => Promise.resolve([ent])),
      };

      const issues = await trialNoConversionDetector.scheduledScan!(mockDb, orgId);

      expect(issues[0].evidence).toMatchObject({
        entitlementId: 'tnc-evidence-ent',
        source: 'apple',
      });
      expect(issues[0].evidence.trialEnd).toBeDefined();
      expect(issues[0].evidence.hoursSinceTrialEnd).toBeCloseTo(5, 0);
    });
  });
});
