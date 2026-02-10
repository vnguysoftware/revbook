import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildWebhookPayload } from '../../alerts/webhook.js';
import type { Issue } from '../../models/types.js';

const mockIssue: Issue = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  orgId: '550e8400-e29b-41d4-a716-446655440001',
  userId: '550e8400-e29b-41d4-a716-446655440002',
  issueType: 'duplicate_billing',
  severity: 'critical',
  status: 'open',
  title: 'Duplicate billing on Stripe and Apple',
  description: 'User is paying for the same subscription on both platforms.',
  estimatedRevenueCents: 1499,
  confidence: 0.95,
  detectorId: 'duplicate_billing',
  detectionTier: 'billing_only',
  evidence: { stripeSubId: 'sub_123', appleSubId: 'txn_456' },
  resolvedAt: null,
  resolvedBy: null,
  resolution: null,
  createdAt: new Date('2026-02-01T10:00:00Z'),
  updatedAt: new Date('2026-02-01T10:00:00Z'),
};

describe('webhook payload builder', () => {
  it('builds a complete webhook payload', () => {
    const payload = buildWebhookPayload(mockIssue, 'issue.created');

    expect(payload.id).toMatch(/^evt_/);
    expect(payload.eventType).toBe('issue.created');
    expect(payload.apiVersion).toBe('2026-02-01');
    expect(payload.timestamp).toBeTruthy();
    expect(payload.data.issue).toBeDefined();
    expect(payload.data.issue.id).toBe(mockIssue.id);
    expect(payload.data.issue.issueType).toBe('duplicate_billing');
    expect(payload.data.issue.severity).toBe('critical');
    expect(payload.data.issue.category).toBe('cross_platform');
    expect(payload.data.issue.recommendedAction).toContain('cancel/refund');
  });

  it('enriches issue with detector metadata', () => {
    const payload = buildWebhookPayload(mockIssue, 'issue.created');

    expect(payload.data.issue.category).toBe('cross_platform');
    expect(payload.data.issue.recommendedAction).toContain('duplicate subscription');
  });

  it('handles different event types', () => {
    const created = buildWebhookPayload(mockIssue, 'issue.created');
    const resolved = buildWebhookPayload(mockIssue, 'issue.resolved');
    const dismissed = buildWebhookPayload(mockIssue, 'issue.dismissed');
    const acknowledged = buildWebhookPayload(mockIssue, 'issue.acknowledged');

    expect(created.eventType).toBe('issue.created');
    expect(resolved.eventType).toBe('issue.resolved');
    expect(dismissed.eventType).toBe('issue.dismissed');
    expect(acknowledged.eventType).toBe('issue.acknowledged');
  });

  it('includes all required issue fields', () => {
    const payload = buildWebhookPayload(mockIssue, 'issue.created');
    const issue = payload.data.issue;

    expect(issue.id).toBeTruthy();
    expect(issue.orgId).toBeTruthy();
    expect(issue.issueType).toBeTruthy();
    expect(issue.severity).toBeTruthy();
    expect(issue.status).toBeTruthy();
    expect(issue.title).toBeTruthy();
    expect(issue.description).toBeTruthy();
    expect(issue.evidence).toBeDefined();
    expect(issue.category).toBeTruthy();
    expect(issue.recommendedAction).toBeTruthy();
  });

  it('generates unique event IDs', () => {
    const p1 = buildWebhookPayload(mockIssue, 'issue.created');
    const p2 = buildWebhookPayload(mockIssue, 'issue.created');

    expect(p1.id).not.toBe(p2.id);
  });
});
