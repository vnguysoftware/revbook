import { describe, it, expect, vi, beforeEach } from 'vitest';
import { webhookGapDetector } from '../../detection/detectors/webhook-gap.js';
import { createTestBillingConnection, createTestCanonicalEvent, resetUuidCounter } from '../helpers.js';
import type { CanonicalEvent } from '../../models/types.js';

describe('WebhookGapDetector', () => {
  const orgId = 'org_wg_test';
  const userId = 'user_wg_001';

  beforeEach(() => {
    resetUuidCounter();
  });

  describe('metadata', () => {
    it('should have correct detector id', () => {
      expect(webhookGapDetector.id).toBe('webhook_delivery_gap');
    });
  });

  describe('checkEvent', () => {
    it('should always return empty array (scheduled-only detector)', async () => {
      const mockDb: any = {};
      const event = createTestCanonicalEvent(orgId) as CanonicalEvent;

      const issues = await webhookGapDetector.checkEvent(mockDb, orgId, userId, event);

      expect(issues).toHaveLength(0);
    });
  });

  describe('scheduledScan', () => {
    it('should detect critical gap for Stripe connection (>12 hours)', async () => {
      const thirteenHoursAgo = new Date(Date.now() - 13 * 60 * 60 * 1000);

      const conn = createTestBillingConnection(orgId, {
        source: 'stripe',
        isActive: true,
        lastWebhookAt: thirteenHoursAgo,
      });

      const mockDb: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => Promise.resolve([conn])),
      };

      const issues = await webhookGapDetector.scheduledScan!(mockDb, orgId);

      expect(issues).toHaveLength(1);
      expect(issues[0].issueType).toBe('webhook_delivery_gap');
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].confidence).toBe(0.90);
    });

    it('should detect warning gap for Stripe connection (>4 hours)', async () => {
      const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);

      const conn = createTestBillingConnection(orgId, {
        source: 'stripe',
        isActive: true,
        lastWebhookAt: fiveHoursAgo,
      });

      const mockDb: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => Promise.resolve([conn])),
      };

      const issues = await webhookGapDetector.scheduledScan!(mockDb, orgId);

      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].confidence).toBe(0.70);
    });

    it('should NOT detect for Stripe within normal window (<4 hours)', async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      const conn = createTestBillingConnection(orgId, {
        source: 'stripe',
        isActive: true,
        lastWebhookAt: twoHoursAgo,
      });

      const mockDb: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => Promise.resolve([conn])),
      };

      const issues = await webhookGapDetector.scheduledScan!(mockDb, orgId);

      expect(issues).toHaveLength(0);
    });

    it('should use different thresholds for Apple (12h warning, 48h critical)', async () => {
      const fifteenHoursAgo = new Date(Date.now() - 15 * 60 * 60 * 1000);

      const conn = createTestBillingConnection(orgId, {
        source: 'apple',
        isActive: true,
        lastWebhookAt: fifteenHoursAgo,
      });

      const mockDb: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => Promise.resolve([conn])),
      };

      const issues = await webhookGapDetector.scheduledScan!(mockDb, orgId);

      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning'); // 15h > 12h warning but < 48h critical
    });

    it('should detect critical gap for Apple (>48 hours)', async () => {
      const fiftyHoursAgo = new Date(Date.now() - 50 * 60 * 60 * 1000);

      const conn = createTestBillingConnection(orgId, {
        source: 'apple',
        isActive: true,
        lastWebhookAt: fiftyHoursAgo,
      });

      const mockDb: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => Promise.resolve([conn])),
      };

      const issues = await webhookGapDetector.scheduledScan!(mockDb, orgId);

      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
    });

    it('should detect critical issue when no webhooks ever received (>24h old connection)', async () => {
      const conn = createTestBillingConnection(orgId, {
        source: 'stripe',
        isActive: true,
        lastWebhookAt: null,
        createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000), // 48 hours old
      });

      const mockDb: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => Promise.resolve([conn])),
      };

      const issues = await webhookGapDetector.scheduledScan!(mockDb, orgId);

      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].confidence).toBe(0.95);
      expect(issues[0].title).toContain('No webhooks ever received');
    });

    it('should NOT flag new connections without webhooks (<24h old)', async () => {
      const conn = createTestBillingConnection(orgId, {
        source: 'stripe',
        isActive: true,
        lastWebhookAt: null,
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours old
      });

      const mockDb: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => Promise.resolve([conn])),
      };

      const issues = await webhookGapDetector.scheduledScan!(mockDb, orgId);

      expect(issues).toHaveLength(0);
    });

    it('should check all active connections', async () => {
      const recentWebhook = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1h ago
      const oldWebhook = new Date(Date.now() - 20 * 60 * 60 * 1000); // 20h ago

      const stripeConn = createTestBillingConnection(orgId, {
        source: 'stripe',
        isActive: true,
        lastWebhookAt: recentWebhook,
      });
      const appleConn = createTestBillingConnection(orgId, {
        source: 'apple',
        isActive: true,
        lastWebhookAt: oldWebhook,
      });

      const mockDb: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => Promise.resolve([stripeConn, appleConn])),
      };

      const issues = await webhookGapDetector.scheduledScan!(mockDb, orgId);

      // Stripe is fine (1h < 4h warning), Apple triggers warning (20h > 12h)
      expect(issues).toHaveLength(1);
      expect(issues[0].evidence.source).toBe('apple');
    });

    it('should include evidence with connection details', async () => {
      const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);

      const conn = createTestBillingConnection(orgId, {
        id: 'wg-evidence-conn',
        source: 'stripe',
        isActive: true,
        lastWebhookAt: fiveHoursAgo,
      });

      const mockDb: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => Promise.resolve([conn])),
      };

      const issues = await webhookGapDetector.scheduledScan!(mockDb, orgId);

      expect(issues[0].evidence).toMatchObject({
        source: 'stripe',
        connectionId: 'wg-evidence-conn',
        threshold: 4,
      });
    });

    it('should return empty when no connections exist', async () => {
      const mockDb: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => Promise.resolve([])),
      };

      const issues = await webhookGapDetector.scheduledScan!(mockDb, orgId);

      expect(issues).toHaveLength(0);
    });
  });
});
