import { eq, and, lt } from 'drizzle-orm';
import type { IssueDetector } from '../detector.js';
import type { CanonicalEvent, DetectedIssue } from '../../models/types.js';
import { billingConnections } from '../../models/schema.js';

/**
 * Detector: Webhook Delivery Gap
 *
 * This is a META-DETECTOR — it monitors the health of the integration
 * itself, not individual subscription issues.
 *
 * If we haven't received any webhooks from a billing source in N hours,
 * something is probably wrong with the webhook configuration, not the
 * subscriptions. This catches:
 *
 * - Webhook endpoint misconfiguration
 * - Webhook secret rotation that broke signature verification
 * - Apple/Google/Stripe outages
 * - Network issues between provider and our endpoint
 *
 * This is arguably the most important detector because without working
 * webhooks, ALL other detectors are blind.
 */
export const webhookGapDetector: IssueDetector = {
  id: 'webhook_delivery_gap',
  name: 'Webhook Delivery Gap',
  description: 'No webhooks received from a billing source in an unexpectedly long time',

  async checkEvent() {
    // This is a scheduled-only detector
    return [];
  },

  async scheduledScan(db, orgId) {
    const issues: DetectedIssue[] = [];
    const now = new Date();

    // Check all active billing connections
    const connections = await db
      .select()
      .from(billingConnections)
      .where(
        and(
          eq(billingConnections.orgId, orgId),
          eq(billingConnections.isActive, true),
        ),
      );

    for (const conn of connections) {
      if (!conn.lastWebhookAt) {
        // Never received a webhook — check if connection is old enough to be concerning
        const connectionAgeHours =
          (now.getTime() - conn.createdAt.getTime()) / (1000 * 60 * 60);

        if (connectionAgeHours > 24) {
          issues.push({
            issueType: 'webhook_delivery_gap',
            severity: 'critical',
            title: `No webhooks ever received from ${conn.source}`,
            description: `The ${conn.source} billing connection was set up ${Math.round(connectionAgeHours)} hours ago but no webhooks have been received. The webhook endpoint may be misconfigured.`,
            confidence: 0.95,
            evidence: {
              source: conn.source,
              connectionId: conn.id,
              connectionAge: `${Math.round(connectionAgeHours)} hours`,
              lastWebhookAt: null,
            },
          });
        }
        continue;
      }

      const hoursSinceLastWebhook =
        (now.getTime() - conn.lastWebhookAt.getTime()) / (1000 * 60 * 60);

      // Thresholds vary by source — Apple sends less frequently than Stripe
      const thresholds: Record<string, { warning: number; critical: number }> = {
        stripe: { warning: 4, critical: 12 },
        apple: { warning: 12, critical: 48 },
        google: { warning: 8, critical: 24 },
        recurly: { warning: 6, critical: 24 },
        braintree: { warning: 6, critical: 24 },
      };

      const threshold = thresholds[conn.source] || { warning: 6, critical: 24 };

      if (hoursSinceLastWebhook > threshold.critical) {
        issues.push({
          issueType: 'webhook_delivery_gap',
          severity: 'critical',
          title: `No ${conn.source} webhooks for ${Math.round(hoursSinceLastWebhook)} hours`,
          description: `Last webhook from ${conn.source} was ${Math.round(hoursSinceLastWebhook)} hours ago. This exceeds the critical threshold of ${threshold.critical} hours. Any billing events during this period may be lost. Check webhook configuration and provider status.`,
          confidence: 0.90,
          evidence: {
            source: conn.source,
            connectionId: conn.id,
            lastWebhookAt: conn.lastWebhookAt.toISOString(),
            hoursSinceLastWebhook: Math.round(hoursSinceLastWebhook),
            threshold: threshold.critical,
          },
        });
      } else if (hoursSinceLastWebhook > threshold.warning) {
        issues.push({
          issueType: 'webhook_delivery_gap',
          severity: 'warning',
          title: `${conn.source} webhook delivery may be delayed`,
          description: `Last webhook from ${conn.source} was ${Math.round(hoursSinceLastWebhook)} hours ago. This is longer than normal. Monitor for further delays.`,
          confidence: 0.70,
          evidence: {
            source: conn.source,
            connectionId: conn.id,
            lastWebhookAt: conn.lastWebhookAt.toISOString(),
            hoursSinceLastWebhook: Math.round(hoursSinceLastWebhook),
            threshold: threshold.warning,
          },
        });
      }
    }

    return issues;
  },
};
