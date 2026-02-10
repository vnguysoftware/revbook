import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { fetcher, apiFetch } from '../lib/api';
import { formatCents, formatDate, timeAgo, severityDot } from '../lib/format';
import {
  ISSUE_TYPE_LABELS,
  DETECTOR_META,
  DETECTOR_CATEGORIES,
  getIssueCategory,
  getDetectorMeta,
} from '../lib/constants';
import { Badge } from '../components/ui/Badge';
import { Card, CardHeader } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { ErrorState } from '../components/ui/ErrorState';
import { Skeleton } from '../components/ui/Skeleton';
import {
  CheckCircle,
  XCircle,
  Eye,
  ExternalLink,
  Clock,
  User,
  AlertTriangle,
  Sparkles,
  Loader2,
  ArrowRight,
  Copy,
  Check,
  Shield,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  BadgeCheck,
  BarChart3,
  Wifi,
  GitCompare,
  ShieldAlert,
} from 'lucide-react';

interface Issue {
  id: string;
  issueType: string;
  severity: string;
  status: string;
  title: string;
  description: string;
  estimatedRevenueCents: number | null;
  confidence: number | null;
  userId: string | null;
  detectorId: string;
  detectionTier: string | null;
  evidence: Record<string, any>;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const RECOMMENDED_ACTION_TEXT: Record<string, string> = {
  webhook_delivery_gap:
    'Your billing provider stopped sending event notifications (webhooks) to your server. Without these, your app won\'t know about new payments, cancellations, or refunds. Open your provider\'s developer dashboard (e.g., Stripe > Developers > Webhooks) and verify the endpoint URL and signing secret are correct.',
  stale_subscription:
    'These subscriptions haven\'t received any billing events (payments, renewals, cancellations) in over 35 days. This usually means webhooks are silently failing, so your records are out of date. Trigger a data re-sync from your billing provider\'s API to refresh their actual status.',
  duplicate_subscription:
    'This user is being charged on two platforms at once (e.g., both Stripe and Apple) for the same product. They\'re paying double. Cancel the subscription on the platform they\'re not actively using and issue a prorated refund for the overlap period.',
  cross_platform_mismatch:
    'This user\'s subscription shows as active on one platform but expired on another. This mismatch means your app may be granting or denying access incorrectly. Check both platform dashboards to determine their true subscription status and update the incorrect one.',
  refund_not_revoked:
    'A refund was processed in your billing provider, but your app still shows this user as having access. When a refund occurs, your backend needs to revoke the user\'s access. Check your webhook handler for refund/chargeback events and ensure it updates the user\'s access accordingly.',
  unusual_renewal_pattern:
    'Fewer subscriptions renewed this period than expected based on your historical average. This could indicate expired payment methods across a cohort, a recent pricing change causing drop-off, or a billing provider issue. Check your failed payment logs in the provider dashboard for patterns.',
  verified_paid_no_access:
    'URGENT: This customer is paying but your app is not granting them access. This means your backend received the payment webhook but didn\'t update the user\'s access rights. Check your webhook handler to ensure it grants access after a successful payment, and restore this user\'s access immediately.',
  verified_access_no_payment:
    'This user has access to your product but doesn\'t have an active paid subscription. Check whether this is intentional (e.g., a comp or team account). If not, your backend may be granting access without verifying payment status. Revoke access if unauthorized and review your access-granting logic.',
  // Seed data / legacy detector IDs
  payment_without_entitlement:
    'Stripe (or your billing provider) confirmed a successful payment, but your app\'s backend didn\'t grant the user access. This typically happens when your webhook handler receives the payment event but fails to update the user\'s access rights. Check your server logs for errors around the time of this payment, and verify your webhook endpoint is processing payment_intent.succeeded (Stripe) or similar events correctly.',
  entitlement_without_payment:
    'Your app shows this user as having an active subscription, but no recent payment has been recorded from the billing provider. A renewal webhook may have been missed or failed silently. Check the user\'s payment history directly in your billing provider\'s dashboard (e.g., Stripe > Customers) to see if their status differs from what your app shows.',
  silent_renewal_failure:
    'This subscription\'s billing period ended, but no renewal event was received. The user\'s payment may have failed without your app being notified. Check their payment method status in your billing provider\'s dashboard and look for any failed charge attempts.',
  trial_no_conversion:
    'This user\'s trial ended but your app received no conversion or cancellation event. They may be in limbo — neither paying nor explicitly churned. Review whether they intended to convert, and consider a targeted follow-up if they showed engagement during the trial.',
  // Backend detector IDs
  unrevoked_refund:
    'A refund was processed in your billing provider, but your app still grants this user access. Your backend needs to listen for refund events (e.g., Stripe\'s charge.refunded webhook) and revoke the user\'s access when one is received. Update this user\'s access immediately.',
  duplicate_billing:
    'This user has active paid subscriptions on multiple platforms (e.g., both Stripe and Apple) for the same product — they\'re being charged twice. Cancel the duplicate on the platform they\'re not actively using and issue a prorated refund for the overlap.',
  cross_platform_conflict:
    'This user\'s subscription status differs between billing platforms — for example, active in Stripe but expired in Apple. Your app may be showing inconsistent behavior depending on which platform it checks. Compare both dashboards to find the correct status and update the out-of-sync platform.',
  renewal_anomaly:
    'The rate of successful subscription renewals dropped significantly compared to your recent average. This often signals a wave of expired payment methods, a pricing change impact, or a billing provider issue. Review failed payment logs in your provider dashboard to identify the pattern.',
  data_freshness:
    'A significant number of active subscriptions haven\'t generated any billing events recently. This usually means webhooks are being lost — your billing provider is sending them, but your server isn\'t receiving or processing them. Check your webhook endpoint health and trigger a data re-sync from the provider\'s API.',
};

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  integration_health: Wifi,
  cross_platform: GitCompare,
  revenue_protection: ShieldAlert,
  verified: BadgeCheck,
};

// Human-readable labels for common evidence field names
const EVIDENCE_KEY_LABELS: Record<string, string> = {
  adjustedImpact: 'Adjusted Impact',
  estimatedImpact: 'Estimated Impact',
  estimatedRevenueCents: 'Estimated Revenue',
  revenueAtRiskCents: 'Revenue at Risk',
  revenueCents: 'Revenue',
  gapDuration: 'Gap Duration',
  gap_duration: 'Gap Duration',
  missedWebhooks: 'Missed Webhooks',
  missed_webhooks: 'Missed Webhooks',
  estimatedMissed: 'Estimated Missed',
  staleCount: 'Stale Count',
  stale_count: 'Stale Count',
  totalCount: 'Total Count',
  total_count: 'Total Count',
  affectedCount: 'Affected Count',
  lastWebhookAt: 'Last Webhook',
  last_webhook_at: 'Last Webhook',
  currentRate: 'Current Rate',
  baselineRate: 'Baseline Rate',
  entitlementState: 'Subscription State',
  subscriptionStatus: 'Subscription Status',
  paymentStatus: 'Payment Status',
  detectorId: 'Detector',
  issueType: 'Issue Type',
  userId: 'User ID',
  stripeCustomerId: 'Stripe Customer',
  stripeSubscriptionId: 'Stripe Subscription',
  productId: 'Product',
  refundAmount: 'Refund Amount',
  refundAmountCents: 'Refund Amount',
  lastPaymentAmount: 'Last Payment',
  expectedPaymentAmount: 'Expected Payment',
  subscriptionAmount: 'Subscription Amount',
  potentialMonthlyRevenue: 'Potential Monthly Revenue',
};

// Keys whose numeric values represent cents and should be formatted as currency
const CENTS_KEYS = new Set([
  'adjustedImpact',
  'estimatedImpact',
  'estimatedRevenueCents',
  'revenueAtRiskCents',
  'revenueCents',
  'refundAmount',
  'refundAmountCents',
  'amount',
  'amountCents',
]);

function formatEvidenceKey(key: string): string {
  if (EVIDENCE_KEY_LABELS[key]) return EVIDENCE_KEY_LABELS[key];
  // Fall back to humanizing the raw key
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

function formatEvidenceValue(key: string, value: unknown): string {
  if (value == null) return '--';
  if (typeof value === 'number' &&
      (CENTS_KEYS.has(key) || /amount|impact|revenue|cents|price/i.test(key))) {
    return formatCents(value);
  }
  return String(value);
}

const STRIPE_ID_PREFIXES: Record<string, string> = {
  'sub_': 'https://dashboard.stripe.com/subscriptions/',
  'cus_': 'https://dashboard.stripe.com/customers/',
  'ch_': 'https://dashboard.stripe.com/payments/',
  'py_': 'https://dashboard.stripe.com/payments/',
  'in_': 'https://dashboard.stripe.com/invoices/',
  're_': 'https://dashboard.stripe.com/refunds/',
};

function getStripeUrl(value: string): string | null {
  for (const [prefix, baseUrl] of Object.entries(STRIPE_ID_PREFIXES)) {
    if (value.startsWith(prefix)) {
      return baseUrl + value;
    }
  }
  return null;
}

function getProviderUrl(value: string): string | null {
  // Stripe IDs
  const stripeUrl = getStripeUrl(value);
  if (stripeUrl) return stripeUrl;

  // Recurly UUIDs (format: hex-hex-hex-hex-hex)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    // Recurly UUIDs are generic, so we can't auto-link without context.
    // But the key names in evidence will tell us the object type.
    return null;
  }

  return null;
}

export function IssueDetailPage() {
  const { issueId } = useParams<{ issueId: string }>();
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [copiedEvidence, setCopiedEvidence] = useState(false);

  useEffect(() => { document.title = 'Issue Detail - RevBack'; }, []);

  const { data, isLoading, error: fetchError, mutate: mutateIssue } = useSWR<{ issue: Issue }>(
    `/issues/${issueId}`,
    fetcher,
  );

  const issue = data?.issue;

  async function handleAction(action: 'acknowledge' | 'resolve' | 'dismiss') {
    setActionLoading(true);
    try {
      await apiFetch(`/issues/${issueId}/${action}`, { method: 'POST' });
      mutate(`/issues/${issueId}`);
      mutateIssue();
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  }

  function copyEvidence() {
    if (!issue) return;
    navigator.clipboard.writeText(JSON.stringify(issue.evidence, null, 2));
    setCopiedEvidence(true);
    setTimeout(() => setCopiedEvidence(false), 2000);
  }

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Skeleton className="h-4 w-32 mb-4" />
        <Skeleton className="h-8 w-64 mb-6" />
        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <ErrorState message="Failed to load issue details" onRetry={() => mutateIssue()} />
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <ErrorState message="Issue not found" />
      </div>
    );
  }

  const evidenceEntries = Object.entries(issue.evidence).filter(([key]) => key !== 'raw');

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <PageHeader
        title=""
        breadcrumbs={[
          { label: 'Issues', to: '/issues' },
          { label: issue.title },
        ]}
      />

      {/* Issue Header Card */}
      <Card padding="lg" className="mb-6">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-3">
              <Badge variant={issue.severity as any} dot>{issue.severity}</Badge>
              <Badge variant={issue.status as any}>{issue.status}</Badge>
              <CategoryBadge issueType={issue.issueType} />
              <span className="text-xs text-gray-400 font-mono">
                {ISSUE_TYPE_LABELS[issue.issueType] || issue.issueType}
              </span>
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">{issue.title}</h1>
            <p className="text-sm text-gray-600 leading-relaxed">{issue.description}</p>
            {issue.detectionTier === 'app_verified' && (
              <div className="flex items-center gap-3 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg mt-3">
                <BadgeCheck size={18} className="text-emerald-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-emerald-800">Verified by App Integration</p>
                  <p className="text-xs text-emerald-600">
                    Your app confirmed this user's access state at {formatDate(issue.updatedAt)}
                  </p>
                </div>
                {issue.confidence != null && (
                  <span className="text-sm font-bold text-emerald-700 flex-shrink-0">
                    {Math.round(issue.confidence * 100)}% confidence
                  </span>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-4 text-xs text-gray-500 mt-4 pt-4 border-t border-gray-100">
              <span className="flex items-center gap-1.5">
                <Clock size={13} /> Detected {formatDate(issue.createdAt)}
              </span>
              {issue.updatedAt !== issue.createdAt && (
                <span className="flex items-center gap-1.5">
                  <Clock size={13} /> Updated {timeAgo(issue.updatedAt)}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <Shield size={13} /> Detector: {ISSUE_TYPE_LABELS[issue.detectorId] || ISSUE_TYPE_LABELS[issue.issueType] || issue.detectorId}
              </span>
              {issue.confidence != null && (
                <span className="flex items-center gap-1.5">
                  <AlertTriangle size={13} /> {Math.round(issue.confidence * 100)}% confidence
                </span>
              )}
            </div>
          </div>

          {/* Revenue Impact */}
          {issue.estimatedRevenueCents != null && issue.estimatedRevenueCents > 0 && (
            <div className="text-right ml-6 flex-shrink-0">
              <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">Revenue Impact</p>
              <p className="text-3xl font-bold text-red-600">
                {formatCents(issue.estimatedRevenueCents)}
              </p>
              <p className="text-xs text-red-500 mt-0.5">at risk</p>
            </div>
          )}
        </div>

        {/* Actions */}
        {issue.status === 'open' && (
          <div className="flex gap-2 mt-6 pt-5 border-t border-gray-100">
            {confirmAction ? (
              <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 flex-1">
                <AlertTriangle size={16} className="text-amber-600 flex-shrink-0" />
                <span className="text-sm text-amber-800">
                  Are you sure you want to <strong>{confirmAction}</strong> this issue?
                </span>
                <div className="ml-auto flex gap-2">
                  <button
                    onClick={() => handleAction(confirmAction as any)}
                    disabled={actionLoading}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
                  >
                    {actionLoading ? <Loader2 size={12} className="animate-spin" /> : 'Confirm'}
                  </button>
                  <button
                    onClick={() => setConfirmAction(null)}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-white border border-amber-200 text-amber-700 hover:bg-amber-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  onClick={() => setConfirmAction('acknowledge')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                >
                  <Eye size={15} /> Acknowledge
                </button>
                <button
                  onClick={() => setConfirmAction('resolve')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
                >
                  <CheckCircle size={15} /> Resolve
                </button>
                <button
                  onClick={() => setConfirmAction('dismiss')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-gray-50 text-gray-500 hover:bg-gray-100 border border-gray-200 transition-colors"
                >
                  <XCircle size={15} /> Dismiss
                </button>
              </>
            )}
          </div>
        )}

        {/* Resolution display */}
        {issue.resolution && (
          <div className="mt-5 pt-5 border-t border-gray-100">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle size={14} className="text-green-600" />
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Resolution</p>
            </div>
            <p className="text-sm text-gray-700">{issue.resolution}</p>
            {issue.resolvedAt && (
              <p className="text-xs text-gray-400 mt-1">Resolved {formatDate(issue.resolvedAt)}</p>
            )}
          </div>
        )}
      </Card>

      {/* Recommended Action */}
      <RecommendedActionCard
        issue={issue}
        onAcknowledge={() => setConfirmAction('acknowledge')}
      />

      <AiInvestigationSection issueId={issueId!} />

      {/* Evidence */}
      <Card padding="lg" className="mb-6">
        <CardHeader
          title="Evidence"
          subtitle="Data collected by the detector"
          action={
            <button
              onClick={copyEvidence}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            >
              {copiedEvidence ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
              {copiedEvidence ? 'Copied' : 'Copy JSON'}
            </button>
          }
        />

        {/* Structured evidence fields */}
        {evidenceEntries.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            {evidenceEntries.map(([key, value]) => {
              if (typeof value === 'object' && value !== null) return null;
              const label = formatEvidenceKey(key);
              const display = formatEvidenceValue(key, value);
              const stripeUrl = typeof value === 'string' ? getStripeUrl(value) : null;
              return (
                <div key={key} className="flex items-baseline justify-between p-3 rounded-lg bg-gray-50 border border-gray-100">
                  <span className="text-xs font-medium text-gray-500 capitalize">
                    {label}
                  </span>
                  {stripeUrl ? (
                    <a
                      href={stripeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium font-mono text-brand-600 hover:text-brand-700 transition-colors"
                    >
                      {display}
                      <ExternalLink size={12} className="flex-shrink-0" />
                    </a>
                  ) : (
                    <span className="text-sm font-medium text-gray-900 font-mono">
                      {display}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Raw JSON */}
        <div className="relative">
          <pre className="text-xs text-gray-600 bg-gray-900 text-gray-300 rounded-lg p-4 overflow-x-auto max-h-80 font-mono leading-relaxed">
            {JSON.stringify(issue.evidence, null, 2)}
          </pre>
        </div>
      </Card>

      {/* Event Timeline from evidence */}
      {issue.evidence.events && Array.isArray(issue.evidence.events) && (
        <Card padding="lg" className="mb-6">
          <CardHeader title="Related Events" subtitle="Timeline of events related to this issue" />
          <div className="relative">
            <div className="absolute left-4 top-2 bottom-2 w-px bg-gray-200" />
            {(issue.evidence.events as any[]).map((event: any, i: number) => (
              <div key={i} className="flex gap-4 pb-4 relative">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs flex-shrink-0 z-10 ${
                  event.status === 'success' ? 'bg-green-100 text-green-700' :
                  event.status === 'failed' ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  <Clock size={14} />
                </div>
                <div className="flex-1 bg-gray-50 rounded-lg p-3 border border-gray-100">
                  <p className="text-sm font-medium text-gray-900">
                    {event.type || event.eventType || 'Event'}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {event.time || event.eventTime || event.date || ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Affected User (per-user) or Affected Scope (aggregate) */}
      {issue.userId ? (
        <Card padding="md" className="mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                <User size={18} className="text-gray-500" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Affected User</p>
                <p className="text-xs text-gray-500 font-mono">{issue.userId.slice(0, 16)}...</p>
              </div>
            </div>
            <Link
              to={`/users/${issue.userId}`}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-brand-600 hover:text-brand-700 bg-brand-50 rounded-lg hover:bg-brand-100 transition-colors"
            >
              <ExternalLink size={14} />
              View Profile
            </Link>
          </div>
        </Card>
      ) : (
        <AffectedScopeCard issue={issue} />
      )}

      {/* Related Issues Placeholder */}
      <Card padding="lg">
        <CardHeader title="Related Issues" subtitle="Similar issues detected for this user or product" />
        <div className="flex flex-col items-center py-6">
          <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-2">
            <ArrowRight size={16} className="text-gray-400" />
          </div>
          <p className="text-sm text-gray-400">No related issues found</p>
        </div>
      </Card>
    </div>
  );
}

// ─── AI Investigation Section ───────────────────────────────────────

interface Investigation {
  rootCause: string;
  impact: string;
  recommendation: string;
  confidence: number;
  reasoning: string;
  relatedIssueIds: string[];
  generatedAt: string;
}

interface InvestigationResponse {
  available: boolean;
  investigation?: Investigation;
  cached?: boolean;
  status?: string;
  message?: string;
}

function AiInvestigationSection({ issueId }: { issueId: string }) {
  const [showReasoning, setShowReasoning] = useState(false);

  const { data, isLoading, error } = useSWR<InvestigationResponse, Error>(
    `/issues/${issueId}/investigation`,
    fetcher,
    {
      refreshInterval: 5000,
      revalidateOnFocus: false,
    },
  );

  const investigation = data?.investigation;

  // Hide the entire section when AI investigation is not available or errored
  if (error || (data && !data.available && !investigation)) {
    return null;
  }

  // Hide while loading (no skeleton/spinner for an optional feature)
  if (isLoading) {
    return null;
  }

  return (
    <Card padding="lg" className="mb-6">
      <CardHeader
        title="AI Investigation"
        subtitle="Automated root cause analysis"
        action={
          <Badge variant="info">
            <Sparkles size={12} />
            AI-Powered
          </Badge>
        }
      />

      {data?.status === 'processing' ? (
        <div className="bg-gradient-to-br from-gray-50 to-blue-50/30 rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <Loader2 size={16} className="animate-spin text-blue-500" />
            AI investigation is being generated. This usually takes 10-30 seconds...
          </div>
        </div>
      ) : investigation ? (
        <div className="space-y-4">
          {/* Confidence bar */}
          <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-3 border border-gray-100">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Confidence</span>
            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  investigation.confidence >= 0.8
                    ? 'bg-green-500'
                    : investigation.confidence >= 0.5
                    ? 'bg-amber-500'
                    : 'bg-red-500'
                }`}
                style={{ width: `${investigation.confidence * 100}%` }}
              />
            </div>
            <span className="text-sm font-bold text-gray-700">
              {Math.round(investigation.confidence * 100)}%
            </span>
            {data?.cached && (
              <span className="text-xs text-gray-400">(cached)</span>
            )}
          </div>

          {/* Main findings */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Root Cause</p>
              <p className="text-sm text-gray-800 leading-relaxed">{investigation.rootCause}</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Impact</p>
              <p className="text-sm text-gray-800 leading-relaxed">{investigation.impact}</p>
            </div>
            <div className="bg-white rounded-lg border border-blue-200 p-4 bg-blue-50/30">
              <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-2">Recommendation</p>
              <p className="text-sm text-gray-800 leading-relaxed">{investigation.recommendation}</p>
            </div>
          </div>

          {/* Related issues */}
          {investigation.relatedIssueIds.length > 0 && (
            <div className="bg-gray-50 rounded-lg border border-gray-100 p-3">
              <p className="text-xs font-medium text-gray-500 mb-2">Related Issues</p>
              <div className="flex flex-wrap gap-1.5">
                {investigation.relatedIssueIds.map((id) => (
                  <Link
                    key={id}
                    to={`/issues/${id}`}
                    className="text-xs font-mono bg-white border border-gray-200 rounded px-2 py-1 text-blue-600 hover:bg-blue-50 transition-colors"
                  >
                    {id.slice(0, 8)}...
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Full reasoning (collapsible) */}
          {investigation.reasoning && (
            <div>
              <button
                onClick={() => setShowReasoning(!showReasoning)}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
              >
                {showReasoning ? 'Hide' : 'Show'} full reasoning
                {showReasoning ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
              </button>
              {showReasoning && (
                <div className="mt-2 bg-gray-50 rounded-lg border border-gray-100 p-4">
                  <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">
                    {investigation.reasoning}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Generation time */}
          <p className="text-xs text-gray-400">
            Generated {investigation.generatedAt ? timeAgo(investigation.generatedAt) : 'unknown'}
          </p>
        </div>
      ) : null}
    </Card>
  );
}

// ─── Affected Scope Card (for aggregate issues) ─────────────────────

// ─── Category Badge ─────────────────────────────────────────────────

function CategoryBadge({ issueType }: { issueType: string }) {
  const catKey = getIssueCategory(issueType);
  const cat = DETECTOR_CATEGORIES[catKey];
  const CatIcon = CATEGORY_ICONS[catKey];
  return (
    <Badge variant={cat.color as any}>
      {CatIcon && <CatIcon size={12} />}
      {cat.label}
    </Badge>
  );
}

// ─── Recommended Action Card ────────────────────────────────────────

function RecommendedActionCard({ issue, onAcknowledge }: { issue: Issue; onAcknowledge: () => void }) {
  const meta = getDetectorMeta(issue.issueType);
  const actionText = RECOMMENDED_ACTION_TEXT[issue.issueType] || meta?.recommendedAction || '';

  const isPerUser = meta?.scope === 'per_user';

  return (
    <Card padding="md" className="mb-6 border-l-4 border-l-brand-500 bg-gradient-to-r from-brand-50/30 to-white">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center flex-shrink-0">
          <Lightbulb size={20} className="text-brand-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-wider">Recommended Action</p>
          <p className="text-sm text-gray-800 mt-1 leading-relaxed">{actionText}</p>
          <div className="flex items-center gap-3 mt-3">
            {isPerUser && issue.userId ? (
              <Link
                to={`/users/${issue.userId}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 transition-colors"
              >
                View User Profile <ArrowRight size={12} />
              </Link>
            ) : (
              <Link
                to={`/issues?type=${issue.issueType}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 transition-colors"
              >
                View Affected Issues <ArrowRight size={12} />
              </Link>
            )}
            {issue.status === 'open' && (
              <button
                onClick={onAcknowledge}
                className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
              >
                Mark as Acknowledged
              </button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─── Affected Scope Card (for aggregate issues) ─────────────────────

function AffectedScopeCard({ issue }: { issue: Issue }) {
  const evidence = issue.evidence as Record<string, any>;

  if (issue.issueType === 'webhook_delivery_gap') {
    const gapDuration = evidence.gapDuration || evidence.gap_duration || 'Unknown';
    const missedWebhooks = evidence.missedWebhooks || evidence.missed_webhooks || evidence.estimatedMissed || '~N/A';
    const provider = evidence.provider || evidence.source || 'Unknown';
    const lastWebhook = evidence.lastWebhookAt || evidence.last_webhook_at || null;
    return (
      <Card padding="lg" className="mb-6">
        <CardHeader title="Affected Scope" subtitle="System-wide impact assessment" />
        <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
          <Wifi size={18} className="text-slate-500" />
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900 capitalize">{provider}</p>
            <p className="text-xs text-gray-500">
              {lastWebhook ? `Last webhook: ${timeAgo(lastWebhook)}` : 'No recent webhooks'}
            </p>
          </div>
          <span className="w-2 h-2 rounded-full bg-red-500" title="Gap detected" />
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
            <p className="text-xs font-medium text-gray-500">Gap Duration</p>
            <p className="text-lg font-bold text-gray-900">{gapDuration}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
            <p className="text-xs font-medium text-gray-500">Missed Webhooks (est.)</p>
            <p className="text-lg font-bold text-gray-900">{missedWebhooks}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
            <p className="text-xs font-medium text-gray-500">Revenue at Risk</p>
            <p className="text-lg font-bold text-red-600">
              {issue.estimatedRevenueCents != null ? formatCents(issue.estimatedRevenueCents) : 'N/A'}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  if (issue.issueType === 'stale_subscription') {
    const staleCount = evidence.staleCount || evidence.stale_count || 0;
    const totalCount = evidence.totalCount || evidence.total_count || 0;
    const staleRate = totalCount > 0 ? (staleCount / totalCount) * 100 : 0;
    const rateColor = staleRate > 10 ? 'text-red-600' : staleRate > 5 ? 'text-amber-600' : 'text-green-600';
    return (
      <Card padding="lg" className="mb-6">
        <CardHeader title="Affected Scope" subtitle="System-wide impact assessment" />
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
            <p className="text-xs font-medium text-gray-500">Stale Subscriptions</p>
            <p className="text-lg font-bold text-gray-900">{staleCount}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
            <p className="text-xs font-medium text-gray-500">Total Monitored</p>
            <p className="text-lg font-bold text-gray-900">{totalCount}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
            <p className="text-xs font-medium text-gray-500">Stale Rate</p>
            <p className={`text-lg font-bold ${rateColor}`}>{staleRate.toFixed(1)}%</p>
          </div>
        </div>
      </Card>
    );
  }

  if (issue.issueType === 'unusual_renewal_pattern') {
    const currentRate = evidence.currentRate || evidence.current_rate || 0;
    const baselineRate = evidence.baselineRate || evidence.baseline_rate || 0;
    const drop = currentRate - baselineRate;
    return (
      <Card padding="lg" className="mb-6">
        <CardHeader title="Affected Scope" subtitle="System-wide impact assessment" />
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
            <p className="text-xs font-medium text-gray-500">Current Renewal Rate</p>
            <p className="text-2xl font-bold text-red-600">{(currentRate * 100).toFixed(0)}%</p>
            <p className="text-xs text-gray-400 mt-1">vs 30-day baseline</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
            <p className="text-xs font-medium text-gray-500">Baseline Renewal Rate</p>
            <p className="text-2xl font-bold text-gray-900">{(baselineRate * 100).toFixed(0)}%</p>
            <p className="text-xs text-gray-400 mt-1">30-day rolling average</p>
          </div>
        </div>
        {drop !== 0 && (
          <div className="mt-4 flex items-center gap-2 p-3 bg-red-50 rounded-lg border border-red-100">
            <BarChart3 size={18} className="text-red-500" />
            <span className="text-lg font-bold text-red-600">{(drop * 100).toFixed(0)}%</span>
            <span className="text-sm text-red-600">renewal rate drop detected</span>
          </div>
        )}
      </Card>
    );
  }

  // Generic aggregate fallback
  const provider = evidence.provider || evidence.source || null;
  return (
    <Card padding="lg" className="mb-6">
      <CardHeader title="Affected Scope" subtitle="System-wide impact assessment" />
      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
        <BarChart3 size={18} className="text-gray-500" />
        <div>
          <p className="text-sm font-medium text-gray-900">Aggregate Issue</p>
          <p className="text-xs text-gray-500">
            {provider ? `Affecting ${provider} integration` : 'Affects system-wide metrics'}
          </p>
        </div>
      </div>
      {issue.estimatedRevenueCents != null && issue.estimatedRevenueCents > 0 && (
        <div className="mt-3 bg-gray-50 rounded-lg p-3 border border-gray-100">
          <p className="text-xs font-medium text-gray-500">Estimated Revenue Impact</p>
          <p className="text-lg font-bold text-red-600">{formatCents(issue.estimatedRevenueCents)}</p>
        </div>
      )}
    </Card>
  );
}
