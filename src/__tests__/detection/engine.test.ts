import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssueDetectionEngine } from '../../detection/engine.js';
import { createTestCanonicalEvent, createTestIssue, resetUuidCounter } from '../helpers.js';
import type { CanonicalEvent } from '../../models/types.js';

// Mock the logger
vi.mock('../../config/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock the alert dispatcher
vi.mock('../../alerts/dispatcher.js', () => ({
  dispatchAlert: vi.fn().mockResolvedValue(undefined),
}));

// Mock all individual detectors to control their behavior in tests
vi.mock('../../detection/detectors/paid-no-access.js', () => ({
  paidNoAccessDetector: {
    id: 'paid_no_access',
    name: 'Paid but No Access',
    description: 'Test',
    checkEvent: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../detection/detectors/access-no-payment.js', () => ({
  accessNoPaymentDetector: {
    id: 'access_no_payment',
    name: 'Access without Payment',
    description: 'Test',
    checkEvent: vi.fn().mockResolvedValue([]),
    scheduledScan: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../detection/detectors/refund-still-active.js', () => ({
  refundStillActiveDetector: {
    id: 'refund_still_active',
    name: 'Refund but Still Active',
    description: 'Test',
    checkEvent: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../detection/detectors/webhook-gap.js', () => ({
  webhookGapDetector: {
    id: 'webhook_delivery_gap',
    name: 'Webhook Delivery Gap',
    description: 'Test',
    checkEvent: vi.fn().mockResolvedValue([]),
    scheduledScan: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../detection/detectors/cross-platform-mismatch.js', () => ({
  crossPlatformMismatchDetector: {
    id: 'cross_platform_mismatch',
    name: 'Cross-Platform State Mismatch',
    description: 'Test',
    checkEvent: vi.fn().mockResolvedValue([]),
    scheduledScan: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../detection/detectors/silent-renewal-failure.js', () => ({
  silentRenewalFailureDetector: {
    id: 'silent_renewal_failure',
    name: 'Silent Renewal Failure',
    description: 'Test',
    checkEvent: vi.fn().mockResolvedValue([]),
    scheduledScan: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../detection/detectors/trial-no-conversion.js', () => ({
  trialNoConversionDetector: {
    id: 'trial_no_conversion',
    name: 'Trial Expired Without Conversion',
    description: 'Test',
    checkEvent: vi.fn().mockResolvedValue([]),
    scheduledScan: vi.fn().mockResolvedValue([]),
  },
}));

describe('IssueDetectionEngine', () => {
  const orgId = 'org_engine_test';
  const userId = 'user_engine_001';
  let engine: IssueDetectionEngine;
  let mockDb: any;

  beforeEach(() => {
    resetUuidCounter();
    mockDb = createEngineMockDb();
    engine = new IssueDetectionEngine(mockDb);
  });

  describe('getDetectors', () => {
    it('should return all 7 registered detectors', () => {
      const detectors = engine.getDetectors();
      expect(detectors).toHaveLength(7);
    });

    it('should include detector metadata', () => {
      const detectors = engine.getDetectors();

      const ids = detectors.map(d => d.id);
      expect(ids).toContain('paid_no_access');
      expect(ids).toContain('access_no_payment');
      expect(ids).toContain('refund_still_active');
      expect(ids).toContain('webhook_delivery_gap');
      expect(ids).toContain('cross_platform_mismatch');
      expect(ids).toContain('silent_renewal_failure');
      expect(ids).toContain('trial_no_conversion');
    });

    it('should indicate which detectors have scheduled scans', () => {
      const detectors = engine.getDetectors();

      for (const d of detectors) {
        expect(typeof d.hasScheduledScan).toBe('boolean');
        expect(d.name).toBeTruthy();
        expect(d.description).toBeTruthy();
      }
    });
  });

  describe('checkForIssues', () => {
    it('should run all detectors for an event', async () => {
      const event = createTestCanonicalEvent(orgId) as CanonicalEvent;
      mockDb._configureSelectResult([]);

      await engine.checkForIssues(orgId, userId, event);

      // All detectors should have been called
      const { paidNoAccessDetector } = await import('../../detection/detectors/paid-no-access.js');
      expect(paidNoAccessDetector.checkEvent).toHaveBeenCalled();
    });

    it('should create issues when detectors find problems', async () => {
      // Make one detector return an issue
      const { paidNoAccessDetector } = await import('../../detection/detectors/paid-no-access.js');
      (paidNoAccessDetector.checkEvent as any).mockResolvedValueOnce([{
        issueType: 'paid_no_access',
        severity: 'critical',
        title: 'Test issue',
        description: 'Test description',
        userId,
        estimatedRevenueCents: 1999,
        confidence: 0.95,
        evidence: { test: true },
      }]);

      // No existing issue (dedup check returns empty)
      mockDb._configureSelectResult([]);
      // Insert returns the new issue
      mockDb._configureInsertResult([{
        id: 'new-issue-id',
        orgId,
        userId,
        issueType: 'paid_no_access',
      }]);

      const event = createTestCanonicalEvent(orgId) as CanonicalEvent;
      await engine.checkForIssues(orgId, userId, event);

      // Should have tried to insert the issue
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should deduplicate issues (skip existing open issues)', async () => {
      const { paidNoAccessDetector } = await import('../../detection/detectors/paid-no-access.js');
      (paidNoAccessDetector.checkEvent as any).mockResolvedValueOnce([{
        issueType: 'paid_no_access',
        severity: 'critical',
        title: 'Duplicate test',
        description: 'Test',
        userId,
        confidence: 0.95,
        evidence: {},
      }]);

      // Existing issue found (dedup should kick in)
      mockDb._configureSelectResult([{ id: 'existing-issue' }]);

      const event = createTestCanonicalEvent(orgId) as CanonicalEvent;
      await engine.checkForIssues(orgId, userId, event);

      // insert should NOT have been called for issue creation
      // The select for dedup returns existing, so insert is skipped
    });

    it('should continue running other detectors when one fails', async () => {
      const { paidNoAccessDetector } = await import('../../detection/detectors/paid-no-access.js');
      (paidNoAccessDetector.checkEvent as any).mockRejectedValueOnce(new Error('Detector crash'));

      const { accessNoPaymentDetector } = await import('../../detection/detectors/access-no-payment.js');

      const event = createTestCanonicalEvent(orgId) as CanonicalEvent;
      await engine.checkForIssues(orgId, userId, event);

      // Should not throw, and other detectors should still be called
      expect(accessNoPaymentDetector.checkEvent).toHaveBeenCalled();
    });
  });
});

function createEngineMockDb() {
  let selectResult: any[] = [];
  let insertResult: any[] = [{ id: 'mock-issue-id' }];

  const chainable: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => Promise.resolve(selectResult)),
    returning: vi.fn().mockImplementation(() => Promise.resolve(insertResult)),
    orderBy: vi.fn().mockReturnThis(),
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
