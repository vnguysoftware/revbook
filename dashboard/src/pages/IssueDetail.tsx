import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { fetcher, apiFetch } from '../lib/api';
import { formatCents, formatDate, timeAgo, severityDot } from '../lib/format';
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
  evidence: Record<string, unknown>;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const ISSUE_TYPE_LABELS: Record<string, string> = {
  paid_no_access: 'Paid but No Access',
  access_no_payment: 'Access without Payment',
  cross_platform_mismatch: 'Cross-Platform Mismatch',
  duplicate_subscription: 'Duplicate Subscription',
  refund_still_active: 'Refund Still Active',
  silent_renewal_failure: 'Silent Renewal Failure',
  trial_no_conversion: 'Trial Not Converted',
  webhook_delivery_gap: 'Webhook Gap',
};

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
              <span className="text-xs text-gray-400 font-mono">
                {ISSUE_TYPE_LABELS[issue.issueType] || issue.issueType}
              </span>
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">{issue.title}</h1>
            <p className="text-sm text-gray-600 leading-relaxed">{issue.description}</p>

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
                <Shield size={13} /> Detector: <code className="font-mono">{issue.detectorId}</code>
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
              return (
                <div key={key} className="flex items-baseline justify-between p-3 rounded-lg bg-gray-50 border border-gray-100">
                  <span className="text-xs font-medium text-gray-500 capitalize">
                    {key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')}
                  </span>
                  <span className="text-sm font-medium text-gray-900 font-mono">
                    {String(value)}
                  </span>
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

      {/* Affected User */}
      {issue.userId && (
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

function AiInvestigationSection({ issueId }: { issueId: string }): React.ReactElement {
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

      {isLoading ? (
        <div className="bg-gradient-to-br from-gray-50 to-blue-50/30 rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <Loader2 size={16} className="animate-spin text-blue-500" />
            Analyzing issue...
          </div>
        </div>
      ) : error ? (
        <div className="bg-red-50 rounded-lg border border-red-200 p-4 text-sm text-red-600">
          Failed to load AI investigation.
        </div>
      ) : data && !data.available ? (
        <div className="bg-gradient-to-br from-gray-50 to-blue-50/30 rounded-lg border border-gray-200 p-6">
          <div className="flex flex-col items-center text-center py-4">
            <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center mb-3">
              <Sparkles size={20} className="text-blue-600" />
            </div>
            <h4 className="text-sm font-semibold text-gray-900 mb-1">Root Cause Analysis</h4>
            <p className="text-sm text-gray-500 max-w-md mb-4">
              AI-powered investigation can analyze this issue, determine the root cause,
              assess impact, and recommend actions.
            </p>
            <div className="flex items-center gap-2 text-xs text-gray-400 bg-white rounded-lg border border-gray-200 px-4 py-2.5">
              <AlertTriangle size={14} className="text-amber-500" />
              <span>Set <code className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">ANTHROPIC_API_KEY</code> to enable</span>
            </div>
          </div>
        </div>
      ) : data?.status === 'processing' ? (
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
