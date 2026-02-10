import { useState, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { fetcher } from '../lib/api';
import { formatDate, timeAgo } from '../lib/format';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { PageHeader } from '../components/ui/PageHeader';
import { KPICard } from '../components/ui/KPICard';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { SkeletonTable } from '../components/ui/Skeleton';
import {
  Activity,
  Zap,
  Shield,
  RefreshCw,
  FileText,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  X,
  Percent,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────

interface WebhookLog {
  id: string;
  source: string;
  processingStatus: string;
  eventType: string | null;
  externalEventId: string | null;
  errorMessage: string | null;
  createdAt: string;
  processedAt: string | null;
}

interface WebhookLogDetail {
  id: string;
  source: string;
  processingStatus: string;
  eventType: string | null;
  externalEventId: string | null;
  httpStatus: number | null;
  errorMessage: string | null;
  rawHeaders: Record<string, string> | null;
  rawBody: string | null;
  createdAt: string;
  processedAt: string | null;
}

interface WebhookStats {
  total: number;
  last24h: {
    total: number;
    processed: number;
    failed: number;
    skipped: number;
    received: number;
    queued: number;
    failureRate: number;
  };
  bySource: Array<{ source: string; count: number }>;
}

// ─── Constants ─────────────────────────────────────────────────────

const sourceIcons: Record<string, React.ReactNode> = {
  stripe: <Zap size={14} className="text-purple-600" />,
  apple: <Shield size={14} className="text-gray-700" />,
  google: <Activity size={14} className="text-green-600" />,
  recurly: <RefreshCw size={14} className="text-blue-600" />,
};

const sourceLabels: Record<string, string> = {
  stripe: 'Stripe',
  apple: 'Apple',
  google: 'Google Play',
  recurly: 'Recurly',
};

const statusConfig: Record<string, { variant: 'success' | 'critical' | 'warning' | 'neutral'; label: string }> = {
  processed: { variant: 'success', label: 'Processed' },
  failed: { variant: 'critical', label: 'Failed' },
  skipped: { variant: 'warning', label: 'Skipped' },
  received: { variant: 'neutral', label: 'Received' },
  queued: { variant: 'neutral', label: 'Queued' },
};

const DATE_PRESETS = [
  { value: '', label: 'All Time' },
  { value: '1', label: 'Last 24h' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
];

const PAGE_SIZE = 25;

// ─── Component ─────────────────────────────────────────────────────

export function WebhookLogsPage() {
  useEffect(() => { document.title = 'Webhook Logs - RevBack'; }, []);

  const [source, setSource] = useState('');
  const [status, setStatus] = useState('');
  const [dateRange, setDateRange] = useState('');
  const [page, setPage] = useState(0);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  // Build stable date param
  const dateParams = useMemo(() => {
    if (!dateRange) return {};
    const from = new Date();
    from.setDate(from.getDate() - parseInt(dateRange));
    from.setHours(0, 0, 0, 0);
    return { from: from.toISOString() };
  }, [dateRange]);

  // Build query params
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
  });
  if (source) params.set('source', source);
  if (status) params.set('status', status);
  if (dateParams.from) params.set('from', dateParams.from);

  // Fetch logs list
  const { data, isLoading, error, mutate } = useSWR<{
    logs: WebhookLog[];
    pagination: { limit: number; offset: number; count: number };
  }>(`/webhook-logs?${params}`, fetcher, { refreshInterval: 10000 });

  // Fetch stats
  const { data: statsData } = useSWR<WebhookStats>(
    '/webhook-logs/stats',
    fetcher,
    { refreshInterval: 30000 },
  );

  // Fetch detail for selected log
  const { data: detailData } = useSWR<{ log: WebhookLogDetail }>(
    selectedLogId ? `/webhook-logs/${selectedLogId}` : null,
    fetcher,
  );

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [source, status, dateRange]);

  const totalPages = data ? Math.ceil(data.pagination.count / PAGE_SIZE) : 0;
  const stats = statsData?.last24h;
  const successRate = stats && stats.total > 0
    ? Math.round(((stats.total - stats.failed) / stats.total) * 100 * 10) / 10
    : 100;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Webhook Logs"
        subtitle="Monitor incoming webhook deliveries and debug integration issues"
        actions={
          <button
            onClick={() => mutate()}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        }
      />

      {/* Stats KPI Bar */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KPICard
            icon={<FileText size={16} className="text-gray-600" />}
            label="Total (24h)"
            value={String(stats.total)}
            sublabel="Webhooks received"
            variant="neutral"
          />
          <KPICard
            icon={<CheckCircle size={16} className="text-green-600" />}
            label="Processed"
            value={String(stats.processed)}
            sublabel="Successfully processed"
            variant="success"
          />
          <KPICard
            icon={<XCircle size={16} className="text-red-600" />}
            label="Failed"
            value={String(stats.failed)}
            sublabel="Processing errors"
            variant={stats.failed > 0 ? 'danger' : 'neutral'}
          />
          <KPICard
            icon={<Percent size={16} className="text-blue-600" />}
            label="Success Rate"
            value={`${successRate}%`}
            sublabel="Last 24 hours"
            variant={successRate >= 99 ? 'success' : successRate >= 95 ? 'warning' : 'danger'}
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {[
          { value: '', label: 'All Sources', icon: null },
          { value: 'stripe', label: 'Stripe', icon: <Zap size={13} className="text-purple-600" /> },
          { value: 'apple', label: 'Apple', icon: <Shield size={13} className="text-gray-700" /> },
          { value: 'google', label: 'Google', icon: <Activity size={13} className="text-green-600" /> },
          { value: 'recurly', label: 'Recurly', icon: <RefreshCw size={13} className="text-blue-600" /> },
        ].map((s) => (
          <button
            key={s.value}
            onClick={() => setSource(s.value)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border transition-all ${
              source === s.value
                ? 'bg-gray-900 text-white border-gray-900 shadow-sm'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-gray-300'
            }`}
          >
            {s.icon}
            {s.label}
          </button>
        ))}

        <div className="w-px h-5 bg-gray-200 mx-1" />

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="appearance-none px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-gray-300 cursor-pointer transition-all"
        >
          <option value="">All Statuses</option>
          <option value="processed">Processed</option>
          <option value="failed">Failed</option>
          <option value="skipped">Skipped</option>
          <option value="received">Received</option>
          <option value="queued">Queued</option>
        </select>

        <div className="w-px h-5 bg-gray-200 mx-1" />

        <div className="relative">
          <Calendar size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="appearance-none pl-7 pr-7 py-2 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-gray-300 cursor-pointer transition-all"
          >
            {DATE_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        {data?.logs && (
          <span className="ml-auto text-xs text-gray-400">
            {data.pagination.count} webhook{data.pagination.count !== 1 ? 's' : ''}{dateRange ? ` in last ${dateRange}d` : ' total'}
          </span>
        )}
      </div>

      {/* Loading */}
      {isLoading && <SkeletonTable rows={8} />}

      {/* Error */}
      {error && <ErrorState message="Failed to load webhook logs" onRetry={() => mutate()} />}

      {/* Empty */}
      {!isLoading && !error && (!data?.logs || data.logs.length === 0) && (
        <Card>
          <EmptyState
            icon={FileText}
            title="No webhook logs"
            description="No webhook deliveries found. Connect a billing source and send a test webhook to see logs here."
          />
        </Card>
      )}

      {/* Webhook Logs Table */}
      {!isLoading && !error && data?.logs && data.logs.length > 0 && (
        <>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Time</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Source</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Event Type</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Status</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.logs.map((log) => {
                    const sc = statusConfig[log.processingStatus] || { variant: 'neutral' as const, label: log.processingStatus };
                    return (
                      <tr
                        key={log.id}
                        onClick={() => setSelectedLogId(log.id)}
                        className="hover:bg-gray-50/50 transition-colors cursor-pointer"
                      >
                        <td className="py-3 px-4">
                          <div>
                            <p className="text-xs text-gray-500">{timeAgo(log.createdAt)}</p>
                            <p className="text-[10px] text-gray-400 mt-0.5">{formatDate(log.createdAt)}</p>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded bg-gray-50 border border-gray-200 flex items-center justify-center">
                              {sourceIcons[log.source] || <Activity size={12} className="text-gray-400" />}
                            </div>
                            <span className="text-sm font-medium text-gray-900 capitalize">
                              {sourceLabels[log.source] || log.source}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          {log.eventType ? (
                            <span className="font-mono text-xs font-medium text-gray-900">
                              {log.eventType}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">--</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant={sc.variant} size="sm" dot>
                            {sc.label}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          {log.errorMessage ? (
                            <span className="text-xs text-red-600 line-clamp-1 max-w-[200px]" title={log.errorMessage}>
                              {log.errorMessage}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">--</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200">
              <p className="text-sm text-gray-500">
                Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, data.pagination.count)} of {data.pagination.count}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
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
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
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

      {/* Detail Modal */}
      {selectedLogId && (
        <WebhookDetailModal
          log={detailData?.log || null}
          onClose={() => setSelectedLogId(null)}
        />
      )}
    </div>
  );
}

// ─── Detail Modal ──────────────────────────────────────────────────

function WebhookDetailModal({
  log,
  onClose,
}: {
  log: WebhookLogDetail | null;
  onClose: () => void;
}) {
  // Close on escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Webhook Detail</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {!log ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-200 border-t-gray-600" />
            </div>
          ) : (
            <div className="space-y-5">
              {/* Overview */}
              <div className="grid grid-cols-2 gap-4">
                <DetailField label="Source" value={sourceLabels[log.source] || log.source} />
                <DetailField label="Status">
                  <Badge
                    variant={(statusConfig[log.processingStatus] || { variant: 'neutral' as const }).variant}
                    size="sm"
                    dot
                  >
                    {(statusConfig[log.processingStatus] || { label: log.processingStatus }).label}
                  </Badge>
                </DetailField>
                <DetailField label="Event Type" value={log.eventType || '--'} mono />
                <DetailField label="External Event ID" value={log.externalEventId || '--'} mono />
                <DetailField label="Received" value={log.createdAt ? formatDate(log.createdAt) : '--'} />
                <DetailField label="Processed" value={log.processedAt ? formatDate(log.processedAt) : '--'} />
                {log.httpStatus != null && (
                  <DetailField label="HTTP Status" value={String(log.httpStatus)} />
                )}
              </div>

              {/* Error Message */}
              {log.errorMessage && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Error Message
                  </h3>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-sm text-red-700 font-mono whitespace-pre-wrap break-all">
                      {log.errorMessage}
                    </p>
                  </div>
                </div>
              )}

              {/* Raw Headers */}
              {log.rawHeaders && Object.keys(log.rawHeaders).length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Request Headers
                  </h3>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto">
                    <pre className="text-xs text-gray-700 font-mono whitespace-pre-wrap break-all">
                      {JSON.stringify(log.rawHeaders, null, 2)}
                    </pre>
                  </div>
                </div>
              )}

              {/* Raw Body */}
              {log.rawBody && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Request Body
                  </h3>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto max-h-64 overflow-y-auto">
                    <pre className="text-xs text-gray-700 font-mono whitespace-pre-wrap break-all">
                      {formatBody(log.rawBody)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Helper Components ─────────────────────────────────────────────

function DetailField({
  label,
  value,
  mono,
  children,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      {children || (
        <p className={`text-sm text-gray-900 ${mono ? 'font-mono' : ''}`}>{value}</p>
      )}
    </div>
  );
}

function formatBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
