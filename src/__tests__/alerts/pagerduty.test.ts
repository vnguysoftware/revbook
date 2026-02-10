import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Issue } from '../../models/types.js';

// Use vi.hoisted so mock functions survive mockReset: true
const mockFetch = vi.hoisted(() => vi.fn());
const mockGetEnv = vi.hoisted(() => vi.fn());

vi.mock('../../config/env.js', () => ({
  getEnv: mockGetEnv,
}));

// Stub global fetch
vi.stubGlobal('fetch', mockFetch);

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

const ROUTING_KEY = 'test-routing-key-abc123';

beforeEach(() => {
  mockGetEnv.mockReturnValue({
    DASHBOARD_URL: 'https://app.revback.dev',
  });
  mockFetch.mockResolvedValue({
    ok: true,
    status: 202,
    text: async () => '{"status":"success","dedup_key":"550e8400"}',
  });
});

describe('sendPagerDutyAlert', () => {
  it('sends a trigger event with correct payload structure', async () => {
    const { sendPagerDutyAlert } = await import('../../alerts/pagerduty.js');

    const result = await sendPagerDutyAlert(ROUTING_KEY, mockIssue);

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://events.pagerduty.com/v2/enqueue');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(options.body);
    expect(body.routing_key).toBe(ROUTING_KEY);
    expect(body.event_action).toBe('trigger');
  });

  it('uses issue.id as dedup_key', async () => {
    const { sendPagerDutyAlert } = await import('../../alerts/pagerduty.js');

    await sendPagerDutyAlert(ROUTING_KEY, mockIssue);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.dedup_key).toBe(mockIssue.id);
  });

  it('maps critical severity correctly', async () => {
    const { sendPagerDutyAlert } = await import('../../alerts/pagerduty.js');

    await sendPagerDutyAlert(ROUTING_KEY, mockIssue);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.payload.severity).toBe('critical');
  });

  it('maps warning severity correctly', async () => {
    const { sendPagerDutyAlert } = await import('../../alerts/pagerduty.js');

    const warningIssue = { ...mockIssue, severity: 'warning' as const };
    await sendPagerDutyAlert(ROUTING_KEY, warningIssue);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.payload.severity).toBe('warning');
  });

  it('maps info severity correctly', async () => {
    const { sendPagerDutyAlert } = await import('../../alerts/pagerduty.js');

    const infoIssue = { ...mockIssue, severity: 'info' as const };
    await sendPagerDutyAlert(ROUTING_KEY, infoIssue);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.payload.severity).toBe('info');
  });

  it('includes revenue impact and confidence in custom_details', async () => {
    const { sendPagerDutyAlert } = await import('../../alerts/pagerduty.js');

    await sendPagerDutyAlert(ROUTING_KEY, mockIssue);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.payload.custom_details.revenue_impact).toBe('$14.99');
    expect(body.payload.custom_details.confidence).toBe('95%');
  });

  it('includes dashboard link in links array', async () => {
    const { sendPagerDutyAlert } = await import('../../alerts/pagerduty.js');

    await sendPagerDutyAlert(ROUTING_KEY, mockIssue);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.links).toHaveLength(1);
    expect(body.links[0].href).toBe(`https://app.revback.dev/issues/${mockIssue.id}`);
    expect(body.links[0].text).toBe('View in RevBack Dashboard');
  });

  it('includes issue title in summary', async () => {
    const { sendPagerDutyAlert } = await import('../../alerts/pagerduty.js');

    await sendPagerDutyAlert(ROUTING_KEY, mockIssue);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.payload.summary).toContain('CRITICAL');
    expect(body.payload.summary).toContain(mockIssue.title);
  });

  it('returns error on non-200 response', async () => {
    const { sendPagerDutyAlert } = await import('../../alerts/pagerduty.js');

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => '{"status":"invalid event","message":"Event object is invalid"}',
    });

    const result = await sendPagerDutyAlert(ROUTING_KEY, mockIssue);

    expect(result.success).toBe(false);
    expect(result.error).toContain('PagerDuty returned 400');
  });

  it('handles network errors', async () => {
    const { sendPagerDutyAlert } = await import('../../alerts/pagerduty.js');

    mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

    const result = await sendPagerDutyAlert(ROUTING_KEY, mockIssue);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Network timeout');
  });

  it('handles unknown revenue impact', async () => {
    const { sendPagerDutyAlert } = await import('../../alerts/pagerduty.js');

    const noRevenueIssue = { ...mockIssue, estimatedRevenueCents: undefined };
    await sendPagerDutyAlert(ROUTING_KEY, noRevenueIssue);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.payload.custom_details.revenue_impact).toBe('Unknown');
  });
});

describe('sendPagerDutyResolve', () => {
  it('sends a resolve event with correct dedup_key', async () => {
    const { sendPagerDutyResolve } = await import('../../alerts/pagerduty.js');

    const result = await sendPagerDutyResolve(ROUTING_KEY, 'issue-123');

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledOnce();

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.routing_key).toBe(ROUTING_KEY);
    expect(body.event_action).toBe('resolve');
    expect(body.dedup_key).toBe('issue-123');
  });

  it('returns error on failure', async () => {
    const { sendPagerDutyResolve } = await import('../../alerts/pagerduty.js');

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'bad request',
    });

    const result = await sendPagerDutyResolve(ROUTING_KEY, 'issue-123');

    expect(result.success).toBe(false);
    expect(result.error).toContain('PagerDuty returned 400');
  });
});

describe('sendPagerDutyTestAlert', () => {
  it('sends a test trigger with info severity', async () => {
    const { sendPagerDutyTestAlert } = await import('../../alerts/pagerduty.js');

    const result = await sendPagerDutyTestAlert(ROUTING_KEY);

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledOnce();

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.routing_key).toBe(ROUTING_KEY);
    expect(body.event_action).toBe('trigger');
    expect(body.dedup_key).toBe('revback-test-alert');
    expect(body.payload.severity).toBe('info');
    expect(body.payload.summary).toContain('Test Alert');
    expect(body.payload.source).toBe('revback');
  });

  it('returns error on non-200 response', async () => {
    const { sendPagerDutyTestAlert } = await import('../../alerts/pagerduty.js');

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'forbidden',
    });

    const result = await sendPagerDutyTestAlert(ROUTING_KEY);

    expect(result.success).toBe(false);
    expect(result.error).toContain('PagerDuty returned 403');
  });

  it('handles network errors', async () => {
    const { sendPagerDutyTestAlert } = await import('../../alerts/pagerduty.js');

    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await sendPagerDutyTestAlert(ROUTING_KEY);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Connection refused');
  });
});
