// ---------------------------------------------------------------------------
// Detector category definitions (Section F of ui-design-spec)
// ---------------------------------------------------------------------------

export const DETECTOR_CATEGORIES: Record<string, {
  label: string;
  icon: string;
  color: string;
  detectors: string[];
}> = {
  integration_health: {
    label: 'Integration Health',
    icon: 'Wifi',
    color: 'slate',
    detectors: ['webhook_delivery_gap', 'data_freshness'],
  },
  cross_platform: {
    label: 'Cross-Platform Intelligence',
    icon: 'GitCompare',
    color: 'violet',
    detectors: ['duplicate_billing', 'cross_platform_conflict'],
  },
  revenue_protection: {
    label: 'Revenue Protection',
    icon: 'ShieldAlert',
    color: 'amber',
    detectors: ['unrevoked_refund', 'renewal_anomaly'],
  },
  verified: {
    label: 'Verified Issues',
    icon: 'BadgeCheck',
    color: 'emerald',
    detectors: ['verified_paid_no_access', 'verified_access_no_payment'],
  },
};

export type DetectorCategoryKey = 'integration_health' | 'cross_platform' | 'revenue_protection' | 'verified';

// ---------------------------------------------------------------------------
// Detector metadata
// ---------------------------------------------------------------------------

export const DETECTOR_META: Record<string, {
  category: DetectorCategoryKey;
  scope: 'per_user' | 'aggregate';
  tier: 1 | 2;
  defaultSeverity: 'critical' | 'warning' | 'info';
  recommendedAction: string;
}> = {
  webhook_delivery_gap: {
    category: 'integration_health',
    scope: 'aggregate',
    tier: 1,
    defaultSeverity: 'warning',
    recommendedAction: 'Verify webhook endpoint URL and signing secret in your provider\'s developer dashboard.',
  },
  stale_subscription: {
    category: 'integration_health',
    scope: 'aggregate',
    tier: 1,
    defaultSeverity: 'warning',
    recommendedAction: 'Re-sync subscription data from your billing provider — records may be stale.',
  },
  duplicate_subscription: {
    category: 'cross_platform',
    scope: 'per_user',
    tier: 1,
    defaultSeverity: 'critical',
    recommendedAction: 'User is being charged on two platforms. Cancel the duplicate and refund the overlap.',
  },
  cross_platform_mismatch: {
    category: 'cross_platform',
    scope: 'per_user',
    tier: 1,
    defaultSeverity: 'warning',
    recommendedAction: 'Subscription status differs between platforms — check both dashboards and sync.',
  },
  refund_not_revoked: {
    category: 'revenue_protection',
    scope: 'per_user',
    tier: 1,
    defaultSeverity: 'warning',
    recommendedAction: 'Refund processed but user still has access. Revoke access and check refund webhook handler.',
  },
  unusual_renewal_pattern: {
    category: 'revenue_protection',
    scope: 'aggregate',
    tier: 1,
    defaultSeverity: 'warning',
    recommendedAction: 'Renewal rate dropped — check failed payment logs for patterns.',
  },
  verified_paid_no_access: {
    category: 'verified',
    scope: 'per_user',
    tier: 2,
    defaultSeverity: 'critical',
    recommendedAction: 'Customer is paying but locked out. Restore access and check your webhook handler.',
  },
  verified_access_no_payment: {
    category: 'verified',
    scope: 'per_user',
    tier: 2,
    defaultSeverity: 'warning',
    recommendedAction: 'User has access without a payment. Verify if intentional or revoke.',
  },
  // Seed data / legacy detector IDs
  payment_without_entitlement: {
    category: 'verified',
    scope: 'per_user',
    tier: 1,
    defaultSeverity: 'critical',
    recommendedAction: 'Payment succeeded but access wasn\'t granted. Check your webhook handler for errors.',
  },
  entitlement_without_payment: {
    category: 'verified',
    scope: 'per_user',
    tier: 1,
    defaultSeverity: 'warning',
    recommendedAction: 'Active subscription but no recent payment. Check billing provider for actual status.',
  },
  silent_renewal_failure: {
    category: 'revenue_protection',
    scope: 'per_user',
    tier: 1,
    defaultSeverity: 'warning',
    recommendedAction: 'No renewal event received after billing period. Check payment method in provider dashboard.',
  },
  trial_no_conversion: {
    category: 'revenue_protection',
    scope: 'per_user',
    tier: 1,
    defaultSeverity: 'info',
    recommendedAction: 'Trial ended with no conversion event. Consider a follow-up if user was engaged.',
  },
  // Backend detector IDs
  unrevoked_refund: {
    category: 'revenue_protection',
    scope: 'per_user',
    tier: 1,
    defaultSeverity: 'warning',
    recommendedAction: 'Refund processed but user still has access. Revoke and check refund webhook handler.',
  },
  duplicate_billing: {
    category: 'cross_platform',
    scope: 'per_user',
    tier: 1,
    defaultSeverity: 'critical',
    recommendedAction: 'User is being charged on two platforms. Cancel the duplicate and refund the overlap.',
  },
  cross_platform_conflict: {
    category: 'cross_platform',
    scope: 'per_user',
    tier: 1,
    defaultSeverity: 'warning',
    recommendedAction: 'Subscription status differs between platforms — check both dashboards and sync.',
  },
  renewal_anomaly: {
    category: 'revenue_protection',
    scope: 'aggregate',
    tier: 1,
    defaultSeverity: 'warning',
    recommendedAction: 'Renewal rate dropped — check failed payment logs for patterns.',
  },
  data_freshness: {
    category: 'integration_health',
    scope: 'aggregate',
    tier: 1,
    defaultSeverity: 'warning',
    recommendedAction: 'Many subscriptions have no recent events — webhooks may be silently failing. Re-sync.',
  },
};

// ---------------------------------------------------------------------------
// Detector-to-category reverse mapping
// ---------------------------------------------------------------------------

export const DETECTOR_TO_CATEGORY: Record<string, DetectorCategoryKey> = Object.fromEntries(
  Object.entries(DETECTOR_CATEGORIES).flatMap(([catId, cat]) =>
    cat.detectors.map(d => [d, catId])
  )
) as Record<string, DetectorCategoryKey>;

// ---------------------------------------------------------------------------
// Issue type filter options (new 8-detector set for dropdowns)
// ---------------------------------------------------------------------------

// Filter dropdown options: one entry per unique label (uses canonical detector IDs)
export const ISSUE_TYPE_FILTER_OPTIONS: Record<string, string> = {
  webhook_delivery_gap: 'Webhook Delivery Gap',
  data_freshness: 'Missing Billing Updates',
  duplicate_billing: 'Duplicate Billing',
  cross_platform_conflict: 'Platform State Conflict',
  unrevoked_refund: 'Unrevoked Refund',
  renewal_anomaly: 'Renewal Rate Drop',
  verified_paid_no_access: 'Paid Without Access',
  verified_access_no_payment: 'Unpaid Access',
  payment_without_entitlement: 'Payment Not Provisioned',
  entitlement_without_payment: 'Expired Subscription Still Active',
  trial_no_conversion: 'Trial Not Converted',
};

// ---------------------------------------------------------------------------
// Full label lookup (includes legacy IDs for backward compatibility)
// ---------------------------------------------------------------------------

export const ISSUE_TYPE_LABELS: Record<string, string> = {
  ...ISSUE_TYPE_FILTER_OPTIONS,
  // Legacy and alternate detector IDs (for label lookups, not shown in dropdowns)
  stale_subscription: 'Missing Billing Updates',
  duplicate_subscription: 'Duplicate Billing',
  cross_platform_mismatch: 'Platform State Conflict',
  refund_not_revoked: 'Unrevoked Refund',
  unusual_renewal_pattern: 'Renewal Rate Drop',
  silent_renewal_failure: 'Renewal Rate Drop',
  paid_no_access: 'Paid Without Access',
  access_no_payment: 'Unpaid Access',
  refund_still_active: 'Unrevoked Refund',
};

// ---------------------------------------------------------------------------
// Category filter options (for category dropdown)
// ---------------------------------------------------------------------------

export const CATEGORY_FILTER_OPTIONS: Record<DetectorCategoryKey, string> = {
  integration_health: 'Integration Health',
  cross_platform: 'Cross-Platform Intelligence',
  revenue_protection: 'Revenue Protection',
  verified: 'Verified Issues',
};

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/** Returns the category key for a given issue/detector type. */
export function getIssueCategory(issueType: string): DetectorCategoryKey {
  if (issueType in DETECTOR_TO_CATEGORY) {
    return DETECTOR_TO_CATEGORY[issueType];
  }
  // Map legacy IDs to their modern equivalents
  const legacyMap: Record<string, string> = {
    paid_no_access: 'verified_paid_no_access',
    access_no_payment: 'verified_access_no_payment',
    payment_without_entitlement: 'verified_paid_no_access',
    entitlement_without_payment: 'verified_access_no_payment',
    refund_still_active: 'unrevoked_refund',
    refund_not_revoked: 'unrevoked_refund',
    silent_renewal_failure: 'renewal_anomaly',
    unusual_renewal_pattern: 'renewal_anomaly',
    cross_platform_mismatch: 'cross_platform_conflict',
    duplicate_subscription: 'duplicate_billing',
    stale_subscription: 'data_freshness',
    trial_no_conversion: 'renewal_anomaly',
  };
  const mapped = legacyMap[issueType];
  if (mapped && mapped in DETECTOR_TO_CATEGORY) {
    return DETECTOR_TO_CATEGORY[mapped];
  }
  return 'revenue_protection';
}

/** Returns detector metadata for a given issue type, or undefined if unknown. */
export function getDetectorMeta(issueType: string) {
  return DETECTOR_META[issueType] ?? null;
}

/** Returns true if the detector operates at aggregate/system scope rather than per-user. */
export function isAggregateIssue(issueType: string): boolean {
  const meta = DETECTOR_META[issueType];
  return meta?.scope === 'aggregate';
}
