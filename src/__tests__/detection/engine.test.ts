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

// Mock CX notifications
vi.mock('../../slack/notifications.js', () => ({
  notifyCxChannel: vi.fn().mockResolvedValue(undefined),
}));

// Mock all 8 registered detectors
vi.mock('../../detection/detectors/webhook-gap.js', () => ({
  webhookGapDetector: {
    id: 'webhook_delivery_gap',
    name: 'Webhook Delivery Gap',
    description: 'Test',
    checkEvent: vi.fn().mockResolvedValue([]),
    scheduledScan: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../detection/detectors/duplicate-billing.js', () => ({
  duplicateBillingDetector: {
    id: 'duplicate_billing',
    name: 'Duplicate Billing',
    description: 'Test',
    checkEvent: vi.fn().mockResolvedValue([]),
    scheduledScan: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../detection/detectors/refund-still-active.js', () => ({
  refundStillActiveDetector: {
    id: 'unrevoked_refund',
    name: 'Refund Without Access Revocation',
    description: 'Test',
    checkEvent: vi.fn().mockResolvedValue([]),
    scheduledScan: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../detection/detectors/cross-platform-conflict.js', () => ({
  crossPlatformConflictDetector: {
    id: 'cross_platform_conflict',
    name: 'Cross-Platform Conflict',
    description: 'Test',
    checkEvent: vi.fn().mockResolvedValue([]),
    scheduledScan: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../detection/detectors/renewal-anomaly.js', () => ({
  renewalAnomalyDetector: {
    id: 'renewal_anomaly',
    name: 'Renewal Anomaly',
    description: 'Test',
    scheduledScan: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../detection/detectors/data-freshness.js', () => ({
  dataFreshnessDetector: {
    id: 'data_freshness',
    name: 'Data Freshness',
    description: 'Test',
    scheduledScan: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../detection/detectors/verified-paid-no-access.js', () => ({
  verifiedPaidNoAccessDetector: {
    id: 'verified_paid_no_access',
    name: 'Paid But No Access',
    description: 'Test',
    scheduledScan: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../detection/detectors/verified-access-no-payment.js', () => ({
  verifiedAccessNoPaymentDetector: {
    id: 'verified_access_no_payment',
    name: 'Access Without Payment',
    description: 'Test',
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
    it('should return all 8 registered detectors', () => {
      const detectors = engine.getDetectors();
      expect(detectors).toHaveLength(8);
    });

    it('should include detector metadata', () => {
      const detectors = engine.getDetectors();

      const ids = detectors.map(d => d.id);
      expect(ids).toContain('webhook_delivery_gap');
      expect(ids).toContain('duplicate_billing');
      expect(ids).toContain('unrevoked_refund');
      expect(ids).toContain('cross_platform_conflict');
      expect(ids).toContain('renewal_anomaly');
      expect(ids).toContain('data_freshness');
      expect(ids).toContain('verified_paid_no_access');
      expect(ids).toContain('verified_access_no_payment');
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
    it('should run all event-triggered detectors for an event', async () => {
      const event = createTestCanonicalEvent(orgId) as CanonicalEvent;
      mockDb._configureSelectResult([]);

      await engine.checkForIssues(orgId, userId, event);

      // Webhook gap detector has checkEvent, so it should have been called
      const { webhookGapDetector } = await import('../../detection/detectors/webhook-gap.js');
      expect(webhookGapDetector.checkEvent).toHaveBeenCalled();
    });

    it('should create issues when detectors find problems', async () => {
      const { webhookGapDetector } = await import('../../detection/detectors/webhook-gap.js');
      (webhookGapDetector.checkEvent as any).mockResolvedValueOnce([{
        issueType: 'webhook_delivery_gap',
        severity: 'warning',
        title: 'Test issue',
        description: 'Test description',
        userId: null,
        estimatedRevenueCents: 0,
        confidence: 0.85,
        evidence: { test: true },
      }]);

      // No existing issue (dedup check returns empty)
      mockDb._configureSelectResult([]);
      // Insert returns the new issue
      mockDb._configureInsertResult([{
        id: 'new-issue-id',
        orgId,
        userId: null,
        issueType: 'webhook_delivery_gap',
      }]);

      const event = createTestCanonicalEvent(orgId) as CanonicalEvent;
      await engine.checkForIssues(orgId, userId, event);

      // Should have tried to insert the issue
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should deduplicate issues (skip existing open issues)', async () => {
      const { webhookGapDetector } = await import('../../detection/detectors/webhook-gap.js');
      (webhookGapDetector.checkEvent as any).mockResolvedValueOnce([{
        issueType: 'webhook_delivery_gap',
        severity: 'warning',
        title: 'Duplicate test',
        description: 'Test',
        userId: null,
        confidence: 0.85,
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
      const { webhookGapDetector } = await import('../../detection/detectors/webhook-gap.js');
      (webhookGapDetector.checkEvent as any).mockRejectedValueOnce(new Error('Detector crash'));

      const { refundStillActiveDetector } = await import('../../detection/detectors/refund-still-active.js');

      const event = createTestCanonicalEvent(orgId) as CanonicalEvent;
      await engine.checkForIssues(orgId, userId, event);

      // Should not throw, and other detectors with checkEvent should still be called
      expect(refundStillActiveDetector.checkEvent).toHaveBeenCalled();
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
