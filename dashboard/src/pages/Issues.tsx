import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import useSWR, { mutate as globalMutate } from 'swr';
import { fetcher, apiFetch } from '../lib/api';
import { formatCents, timeAgo, severityDot } from '../lib/format';
import { Badge } from '../components/ui/Badge';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { SkeletonRow } from '../components/ui/Skeleton';
import {
  AlertTriangle,
  CheckCircle,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Filter,
  CheckSquare,
  Square,
  Eye,
  XCircle,
  Loader2,
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
  evidence: Record<string, unknown>;
  createdAt: string;
}

interface IssuesResponse {
  issues: Issue[];
  pagination: { limit: number; offset: number; count: number };
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

const STATUS_TABS = [
  { value: 'open', label: 'Open', icon: AlertTriangle },
  { value: 'acknowledged', label: 'Acknowledged', icon: Eye },
  { value: 'resolved', label: 'Resolved', icon: CheckCircle },
  { value: 'dismissed', label: 'Dismissed', icon: XCircle },
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest First' },
  { value: 'revenue', label: 'Revenue Impact' },
  { value: 'severity', label: 'Severity' },
];

const PAGE_SIZE = 20;

export function IssuesPage() {
  useEffect(() => { document.title = 'Issues - RevBack'; }, []);

  const [status, setStatus] = useState('open');
  const [severity, setSeverity] = useState<string>('');
  const [issueType, setIssueType] = useState<string>('');
  const [sortBy, setSortBy] = useState('newest');
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  const params = new URLSearchParams({
    status,
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
  });
  if (severity) params.set('severity', severity);
  if (issueType) params.set('issueType', issueType);

  const queryKey = `/issues?${params}`;
  const { data, isLoading, error, mutate } = useSWR<IssuesResponse>(
    queryKey,
    fetcher,
    { refreshInterval: 15000 },
  );

  // Reset page and selection when filters change
  useEffect(() => {
    setPage(0);
    setSelectedIds(new Set());
  }, [status, severity, issueType]);

  const totalPages = data ? Math.ceil(data.pagination.count / PAGE_SIZE) : 0;
  const allSelected = data?.issues && data.issues.length > 0 && data.issues.every(i => selectedIds.has(i.id));

  function toggleAll() {
    if (!data?.issues) return;
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(data.issues.map(i => i.id)));
    }
  }

  function toggleOne(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkAction(action: 'acknowledge' | 'resolve' | 'dismiss') {
    if (selectedIds.size === 0) return;
    setBulkActionLoading(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map(id =>
          apiFetch(`/issues/${id}/${action}`, { method: 'POST' }),
        ),
      );
      setSelectedIds(new Set());
      mutate();
    } catch (err) {
      // silently ignore individual errors
    } finally {
      setBulkActionLoading(false);
    }
  }

  // Sort issues client-side
  const sortedIssues = data?.issues ? [...data.issues].sort((a, b) => {
    if (sortBy === 'revenue') {
      return (b.estimatedRevenueCents || 0) - (a.estimatedRevenueCents || 0);
    }
    if (sortBy === 'severity') {
      const order: Record<string, number> = { critical: 0, warning: 1, info: 2 };
      return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  }) : [];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Issues"
        subtitle={`${data?.pagination.count ?? 0} ${status} issues detected`}
      />

      {/* Status Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
        <div className="flex bg-gray-100 rounded-lg p-1 gap-0.5">
          {STATUS_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.value}
                onClick={() => setStatus(tab.value)}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-all ${
                  status === tab.value
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon size={13} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-1">
          <div className="relative">
            <Filter size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="pl-8 pr-8 py-2 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-600 appearance-none cursor-pointer hover:border-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            >
              <option value="">All severities</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </select>
          </div>

          <select
            value={issueType}
            onChange={(e) => setIssueType(e.target.value)}
            className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-600 appearance-none cursor-pointer hover:border-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          >
            <option value="">All types</option>
            {Object.entries(ISSUE_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>

          <div className="ml-auto flex items-center gap-1">
            <ArrowUpDown size={13} className="text-gray-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-2 py-2 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-600 appearance-none cursor-pointer hover:border-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            >
              {SORT_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Bulk Actions */}
      {selectedIds.size > 0 && (
        <div className="mb-4 flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-sm font-medium text-blue-800">
            {selectedIds.size} selected
          </span>
          <div className="flex gap-2">
            {status === 'open' && (
              <>
                <button
                  onClick={() => handleBulkAction('acknowledge')}
                  disabled={bulkActionLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 transition-colors disabled:opacity-50"
                >
                  {bulkActionLoading ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
                  Acknowledge
                </button>
                <button
                  onClick={() => handleBulkAction('resolve')}
                  disabled={bulkActionLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  {bulkActionLoading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                  Resolve
                </button>
                <button
                  onClick={() => handleBulkAction('dismiss')}
                  disabled={bulkActionLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  {bulkActionLoading ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                  Dismiss
                </button>
              </>
            )}
          </div>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
        </div>
      )}

      {/* Error */}
      {error && (
        <ErrorState message="Failed to load issues" onRetry={() => mutate()} />
      )}

      {/* Empty State */}
      {!isLoading && !error && sortedIssues.length === 0 && (
        <EmptyState
          icon={CheckCircle}
          title={`No ${status} issues`}
          description={
            status === 'open'
              ? 'Your billing looks healthy. We are continuously monitoring for issues.'
              : `No ${status} issues found. Try a different filter.`
          }
        />
      )}

      {/* Issue List */}
      {!isLoading && !error && sortedIssues.length > 0 && (
        <>
          {/* Select all header */}
          <div className="flex items-center gap-3 px-4 py-2 text-xs text-gray-500 font-medium mb-1">
            <button onClick={toggleAll} className="hover:text-gray-700 transition-colors">
              {allSelected ? (
                <CheckSquare size={16} className="text-brand-600" />
              ) : (
                <Square size={16} />
              )}
            </button>
            <span className="flex-1">Issue</span>
            <span className="w-24 text-right">Impact</span>
            <span className="w-24 text-right">Time</span>
          </div>

          <div className="space-y-2">
            {sortedIssues.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                selected={selectedIds.has(issue.id)}
                onToggle={() => toggleOne(issue.id)}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200">
              <p className="text-sm text-gray-500">
                Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, data!.pagination.count)} of {data!.pagination.count}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  const pageNum = totalPages <= 5 ? i : Math.max(0, Math.min(page - 2, totalPages - 5)) + i;
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
                        page === pageNum
                          ? 'bg-gray-900 text-white'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {pageNum + 1}
                    </button>
                  );
                })}
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function IssueRow({
  issue,
  selected,
  onToggle,
}: {
  issue: Issue;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-3 bg-white rounded-lg border p-4 transition-all ${
        selected
          ? 'border-brand-500 bg-brand-50/30 shadow-sm'
          : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
      }`}
    >
      <button
        onClick={(e) => { e.preventDefault(); onToggle(); }}
        className="flex-shrink-0 hover:opacity-80 transition-opacity"
      >
        {selected ? (
          <CheckSquare size={16} className="text-brand-600" />
        ) : (
          <Square size={16} className="text-gray-300" />
        )}
      </button>

      <Link
        to={`/issues/${issue.id}`}
        className="flex items-center gap-3 flex-1 min-w-0"
      >
        {/* Severity dot */}
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${severityDot(issue.severity)}`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={issue.severity as any} size="sm">{issue.severity}</Badge>
            <span className="text-xs text-gray-400 font-mono">
              {ISSUE_TYPE_LABELS[issue.issueType] || issue.issueType}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-gray-900 truncate">{issue.title}</h3>
          <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{issue.description}</p>
        </div>

        <div className="text-right flex-shrink-0 w-24">
          {issue.estimatedRevenueCents != null && issue.estimatedRevenueCents > 0 && (
            <p className="text-sm font-bold text-red-600">{formatCents(issue.estimatedRevenueCents)}</p>
          )}
          {issue.confidence != null && (
            <p className="text-[10px] text-gray-400 mt-0.5">
              {Math.round(issue.confidence * 100)}% confidence
            </p>
          )}
        </div>

        <div className="text-right flex-shrink-0 w-24">
          <p className="text-xs text-gray-400">{timeAgo(issue.createdAt)}</p>
        </div>
      </Link>
    </div>
  );
}
