import type { Issue } from '../models/types.js';
import { getEnv } from '../config/env.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('alert-pagerduty');

const PAGERDUTY_EVENTS_URL = 'https://events.pagerduty.com/v2/enqueue';

/**
 * Map RevBack severity to PagerDuty severity.
 * PagerDuty supports: critical, error, warning, info.
 */
function mapSeverity(severity: string): 'critical' | 'error' | 'warning' | 'info' {
  switch (severity) {
    case 'critical':
      return 'critical';
    case 'warning':
      return 'warning';
    case 'info':
      return 'info';
    default:
      return 'warning';
  }
}

/**
 * Build a PagerDuty Events API v2 trigger payload.
 */
function buildTriggerPayload(routingKey: string, issue: Issue, dashboardUrl: string) {
  const revenueImpact = issue.estimatedRevenueCents
    ? `$${(issue.estimatedRevenueCents / 100).toFixed(2)}`
    : 'Unknown';
  const confidence = issue.confidence
    ? `${Math.round(issue.confidence * 100)}%`
    : 'N/A';
  const issueUrl = `${dashboardUrl}/issues/${issue.id}`;

  return {
    routing_key: routingKey,
    event_action: 'trigger' as const,
    dedup_key: issue.id,
    payload: {
      summary: `[RevBack] ${issue.severity.toUpperCase()}: ${issue.title}`,
      source: 'revback',
      severity: mapSeverity(issue.severity),
      timestamp: new Date(issue.createdAt).toISOString(),
      component: issue.issueType,
      custom_details: {
        issue_id: issue.id,
        issue_type: issue.issueType,
        description: issue.description,
        revenue_impact: revenueImpact,
        confidence,
        dashboard_url: issueUrl,
      },
    },
    links: [
      {
        href: issueUrl,
        text: 'View in RevBack Dashboard',
      },
    ],
  };
}

/**
 * Send an issue alert to PagerDuty via Events API v2.
 */
export async function sendPagerDutyAlert(
  routingKey: string,
  issue: Issue,
): Promise<{ success: boolean; error?: string }> {
  try {
    const env = getEnv();
    const payload = buildTriggerPayload(routingKey, issue, env.DASHBOARD_URL);

    const response = await fetch(PAGERDUTY_EVENTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      log.warn({ status: response.status, body, issueId: issue.id }, 'PagerDuty trigger failed');
      return { success: false, error: `PagerDuty returned ${response.status}: ${body}` };
    }

    log.info({ issueId: issue.id, dedupKey: issue.id }, 'PagerDuty alert sent');
    return { success: true };
  } catch (err: any) {
    log.error({ err, issueId: issue.id }, 'PagerDuty alert delivery error');
    return { success: false, error: err.message };
  }
}

/**
 * Send a resolve event to PagerDuty for a previously triggered alert.
 */
export async function sendPagerDutyResolve(
  routingKey: string,
  dedupKey: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const payload = {
      routing_key: routingKey,
      event_action: 'resolve' as const,
      dedup_key: dedupKey,
    };

    const response = await fetch(PAGERDUTY_EVENTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      log.warn({ status: response.status, body, dedupKey }, 'PagerDuty resolve failed');
      return { success: false, error: `PagerDuty returned ${response.status}: ${body}` };
    }

    log.info({ dedupKey }, 'PagerDuty resolve sent');
    return { success: true };
  } catch (err: any) {
    log.error({ err, dedupKey }, 'PagerDuty resolve delivery error');
    return { success: false, error: err.message };
  }
}

/**
 * Send a test trigger event to PagerDuty to verify the routing key.
 */
export async function sendPagerDutyTestAlert(
  routingKey: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const payload = {
      routing_key: routingKey,
      event_action: 'trigger' as const,
      dedup_key: 'revback-test-alert',
      payload: {
        summary: '[RevBack] Test Alert - Your PagerDuty integration is working correctly',
        source: 'revback',
        severity: 'info' as const,
        timestamp: new Date().toISOString(),
        component: 'test',
        custom_details: {
          message: 'This is a test event to verify your PagerDuty integration. You will receive alerts here when billing issues are detected.',
        },
      },
    };

    const response = await fetch(PAGERDUTY_EVENTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      log.warn({ status: response.status, body }, 'PagerDuty test alert failed');
      return { success: false, error: `PagerDuty returned ${response.status}: ${body}` };
    }

    log.info('PagerDuty test alert sent');
    return { success: true };
  } catch (err: any) {
    log.error({ err }, 'PagerDuty test alert delivery error');
    return { success: false, error: err.message };
  }
}
