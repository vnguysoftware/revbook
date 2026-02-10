/**
 * Detector metadata: maps issueType to enrichment fields.
 *
 * These are derived at the API layer (not stored in DB) so that
 * changes to copy/categorization don't require a migration.
 *
 * Extracted as a shared module so both the REST API and webhook/MCP
 * layers can enrich issues consistently.
 */
export const DETECTOR_META: Record<string, {
  category: string;
  scope: 'per_user' | 'aggregate';
  recommendedAction: string;
}> = {
  webhook_delivery_gap: {
    category: 'integration_health',
    scope: 'aggregate',
    recommendedAction: 'Check your webhook endpoint configuration for this billing source. Verify the signing secret matches. Check the provider status page for outages.',
  },
  duplicate_billing: {
    category: 'cross_platform',
    scope: 'per_user',
    recommendedAction: 'Review this user and cancel/refund the duplicate subscription on one platform. Consider adding cross-platform subscription checks to your purchase flow.',
  },
  unrevoked_refund: {
    category: 'revenue_protection',
    scope: 'per_user',
    recommendedAction: 'Check whether your app automatically revokes access after refunds. If not, manually revoke this user\'s access. For chargebacks, immediate revocation strengthens your dispute response.',
  },
  cross_platform_conflict: {
    category: 'cross_platform',
    scope: 'per_user',
    recommendedAction: 'Verify whether this user should still have access. Check if the cancellation/expiration on one platform was intentional or indicates a sync issue.',
  },
  renewal_anomaly: {
    category: 'integration_health',
    scope: 'aggregate',
    recommendedAction: 'Check your webhook configuration for this billing source. Verify server notification URLs. Check the provider status page for outages or increased involuntary churn.',
  },
  data_freshness: {
    category: 'integration_health',
    scope: 'aggregate',
    recommendedAction: 'Re-register your server notification URL for this billing source. Verify delivery with a test subscription. A large percentage of stale subscriptions indicates systematic webhook failure.',
  },
  verified_paid_no_access: {
    category: 'access_verification',
    scope: 'per_user',
    recommendedAction: 'Check your provisioning system for this user. The issue may be in your entitlement check logic, a caching problem, or a feature flag misconfiguration.',
  },
  verified_access_no_payment: {
    category: 'access_verification',
    scope: 'per_user',
    recommendedAction: 'Check your access control logic. This user may be exploiting a caching bug, using a hardcoded bypass, or their access was not properly revoked.',
  },
  // Legacy types that may still exist in the database
  refund_not_revoked: {
    category: 'revenue_protection',
    scope: 'per_user',
    recommendedAction: 'Check whether your app automatically revokes access after refunds.',
  },
  cross_platform_mismatch: {
    category: 'cross_platform',
    scope: 'per_user',
    recommendedAction: 'Verify the user\'s subscription state across platforms.',
  },
  duplicate_subscription: {
    category: 'cross_platform',
    scope: 'per_user',
    recommendedAction: 'Cancel/refund the duplicate subscription on one platform.',
  },
  payment_without_entitlement: {
    category: 'internal',
    scope: 'per_user',
    recommendedAction: 'Internal data consistency issue. Auto-reconciliation should handle this.',
  },
  entitlement_without_payment: {
    category: 'internal',
    scope: 'per_user',
    recommendedAction: 'Internal data consistency issue. Auto-reconciliation should handle this.',
  },
  silent_renewal_failure: {
    category: 'integration_health',
    scope: 'per_user',
    recommendedAction: 'Check webhook delivery for this billing source.',
  },
  trial_no_conversion: {
    category: 'analytics',
    scope: 'per_user',
    recommendedAction: 'Review trial conversion rates on the analytics dashboard.',
  },
  stale_subscription: {
    category: 'integration_health',
    scope: 'per_user',
    recommendedAction: 'Check webhook delivery for this billing source.',
  },
};

export const CATEGORY_ISSUE_TYPES: Record<string, string[]> = {
  integration_health: ['webhook_delivery_gap', 'renewal_anomaly', 'data_freshness', 'silent_renewal_failure', 'stale_subscription'],
  cross_platform: ['duplicate_billing', 'cross_platform_conflict', 'cross_platform_mismatch', 'duplicate_subscription'],
  revenue_protection: ['unrevoked_refund', 'refund_not_revoked'],
  access_verification: ['verified_paid_no_access', 'verified_access_no_payment'],
};

/**
 * Enrich an issue with detector metadata for API responses and webhooks.
 */
export function enrichIssue(issue: any) {
  const meta = DETECTOR_META[issue.issueType];
  return {
    ...issue,
    category: meta?.category || 'unknown',
    scope: meta?.scope || 'per_user',
    recommendedAction: meta?.recommendedAction || null,
  };
}

/**
 * Get enrichment data for a specific issue type (for webhook payloads).
 */
export function enrichIssueForWebhook(issueType: string): { category: string; recommendedAction: string } {
  const meta = DETECTOR_META[issueType];
  return {
    category: meta?.category || 'unknown',
    recommendedAction: meta?.recommendedAction || '',
  };
}
