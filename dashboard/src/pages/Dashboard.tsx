import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { fetcher } from '../lib/api';
import { formatCents, formatNumber, timeAgo, severityDot } from '../lib/format';
import { KPICard } from '../components/ui/KPICard';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { SkeletonKPI, SkeletonCard } from '../components/ui/Skeleton';
import { ErrorState } from '../components/ui/ErrorState';
import {
  AlertTriangle,
  DollarSign,
  Shield,
  Users,
  ArrowRight,
  CheckCircle,
  Clock,
  AlertCircle,
  Zap,
  Activity,
} from 'lucide-react';

interface Summary {
  open: number;
  critical: number;
  revenueAtRiskCents: number;
  byType: Array<{ issueType: string; count: number; revenue: string | null }>;
}

interface RevenueImpact {
  atRisk: { totalCents: number; issueCount: number };
  bySeverity: Array<{ severity: string; totalRevenueCents: string | null; issueCount: number }>;
  byType: Array<{ issueType: string; totalRevenueCents: string | null; issueCount: number }>;
  saved: { totalCents: number; issueCount: number };
}

interface HealthData {
  totalUsers: number;
  byState: Array<{ state: string; count: number }>;
  bySource: Array<{ source: string; state: string; count: number }>;
}

interface Issue {
  id: string;
  issueType: string;
  severity: string;
  status: string;
  title: string;
  description: string;
  estimatedRevenueCents: number | null;
  createdAt: string;
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

export function DashboardPage() {
  useEffect(() => { document.title = 'Dashboard - RevBack'; }, []);

  const { data: summary, error: summaryError, mutate: mutateSummary } = useSWR<Summary>(
    '/issues/summary',
    fetcher,
    { refreshInterval: 30000 },
  );
  const { data: revenue, error: revenueError, mutate: mutateRevenue } = useSWR<RevenueImpact>(
    '/dashboard/revenue-impact',
    fetcher,
    { refreshInterval: 30000 },
  );
  const { data: health, error: healthError } = useSWR<HealthData>(
    '/dashboard/entitlement-health',
    fetcher,
    { refreshInterval: 60000 },
  );
  const { data: recentIssuesData } = useSWR<{ issues: Issue[] }>(
    '/issues?status=open&limit=5',
    fetcher,
    { refreshInterval: 15000 },
  );

  const hasError = summaryError || revenueError || healthError;
  const isLoading = !summary && !summaryError;

  if (hasError) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <ErrorState
          message="Failed to load dashboard data. Please check your connection and try again."
          onRetry={() => { mutateSummary(); mutateRevenue(); }}
        />
      </div>
    );
  }

  // Compute total for severity chart
  const totalSeverityIssues = revenue?.bySeverity.reduce((acc, s) => acc + s.issueCount, 0) || 0;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">
          Real-time overview of your subscription billing health
        </p>
      </div>

      {/* KPI Cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonKPI key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <KPICard
            icon={<DollarSign className="text-red-600" size={18} />}
            label="Revenue at Risk"
            value={formatCents(revenue?.atRisk.totalCents)}
            sublabel={`${summary?.open || 0} open issues affecting revenue`}
            variant="danger"
            trend={{ direction: 'up', value: '12% vs last week', positive: false }}
          />
          <KPICard
            icon={<AlertTriangle className="text-red-600" size={18} />}
            label="Critical Issues"
            value={formatNumber(summary?.critical || 0)}
            sublabel="Require immediate attention"
            variant="danger"
            trend={
              (summary?.critical || 0) > 0
                ? { direction: 'up', value: `${summary?.critical} new`, positive: false }
                : { direction: 'flat', value: 'No change', positive: true }
            }
          />
          <KPICard
            icon={<Shield className="text-green-600" size={18} />}
            label="Revenue Saved"
            value={formatCents(revenue?.saved.totalCents)}
            sublabel={`${revenue?.saved.issueCount || 0} issues resolved`}
            variant="success"
            trend={{ direction: 'up', value: '8% vs last week', positive: true }}
          />
          <KPICard
            icon={<Users className="text-gray-600" size={18} />}
            label="Active Subscribers"
            value={formatNumber(health?.totalUsers || 0)}
            sublabel="Across all connected platforms"
            variant="neutral"
            trend={{ direction: 'up', value: '3% growth', positive: true }}
          />
        </div>
      )}

      {/* Middle Section: Severity Chart + Recent Issues */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Issue Severity Breakdown */}
        <Card className="lg:col-span-1">
          <CardHeader title="Issue Severity" subtitle="Distribution of open issues" />
          {revenue?.bySeverity && revenue.bySeverity.length > 0 ? (
            <div className="space-y-4">
              {/* Donut-style visual using CSS */}
              <div className="flex justify-center mb-4">
                <div className="relative w-32 h-32">
                  <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                    {(() => {
                      let offset = 0;
                      const colors: Record<string, string> = {
                        critical: '#ef4444',
                        warning: '#f59e0b',
                        info: '#3b82f6',
                      };
                      return revenue.bySeverity.map((s) => {
                        const pct = totalSeverityIssues > 0
                          ? (s.issueCount / totalSeverityIssues) * 100
                          : 0;
                        const strokeDasharray = `${pct} ${100 - pct}`;
                        const el = (
                          <circle
                            key={s.severity}
                            cx="18"
                            cy="18"
                            r="15.9155"
                            fill="none"
                            stroke={colors[s.severity] || '#9ca3af'}
                            strokeWidth="3"
                            strokeDasharray={strokeDasharray}
                            strokeDashoffset={-offset}
                            strokeLinecap="round"
                          />
                        );
                        offset += pct;
                        return el;
                      });
                    })()}
                    {totalSeverityIssues === 0 && (
                      <circle
                        cx="18"
                        cy="18"
                        r="15.9155"
                        fill="none"
                        stroke="#e5e7eb"
                        strokeWidth="3"
                      />
                    )}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold text-gray-900">{totalSeverityIssues}</span>
                    <span className="text-xs text-gray-500">Total</span>
                  </div>
                </div>
              </div>

              {/* Legend + bars */}
              {revenue.bySeverity.map((s) => {
                const pct = totalSeverityIssues > 0
                  ? Math.round((s.issueCount / totalSeverityIssues) * 100)
                  : 0;
                return (
                  <div key={s.severity}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${severityDot(s.severity)}`} />
                        <span className="text-sm font-medium capitalize text-gray-700">{s.severity}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900">{s.issueCount}</span>
                        <span className="text-xs text-gray-400">{pct}%</span>
                      </div>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full transition-all duration-700 ${severityDot(s.severity)}`}
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center py-8">
              <CheckCircle size={32} className="text-green-400 mb-2" />
              <p className="text-sm text-gray-400">No issues detected</p>
            </div>
          )}
        </Card>

        {/* Recent Issues */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent Issues"
            subtitle="Latest detected billing problems"
            action={
              <Link
                to="/issues"
                className="text-xs font-medium text-brand-600 hover:text-brand-700 flex items-center gap-1 transition-colors"
              >
                View all <ArrowRight size={12} />
              </Link>
            }
          />
          {recentIssuesData?.issues && recentIssuesData.issues.length > 0 ? (
            <div className="space-y-1">
              {recentIssuesData.issues.slice(0, 5).map((issue) => (
                <Link
                  key={issue.id}
                  to={`/issues/${issue.id}`}
                  className="flex items-center gap-3 p-3 -mx-1 rounded-lg hover:bg-gray-50 transition-colors group"
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${severityDot(issue.severity)}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate group-hover:text-brand-600 transition-colors">
                      {issue.title}
                    </p>
                    <p className="text-xs text-gray-500">
                      {ISSUE_TYPE_LABELS[issue.issueType] || issue.issueType}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {issue.estimatedRevenueCents != null && issue.estimatedRevenueCents > 0 && (
                      <p className="text-sm font-semibold text-red-600">
                        {formatCents(issue.estimatedRevenueCents)}
                      </p>
                    )}
                    <p className="text-xs text-gray-400">{timeAgo(issue.createdAt)}</p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center py-8">
              <CheckCircle size={32} className="text-green-400 mb-2" />
              <p className="text-sm text-gray-500 font-medium">All clear</p>
              <p className="text-xs text-gray-400 mt-0.5">No open issues detected</p>
            </div>
          )}
        </Card>
      </div>

      {/* Bottom Section: Integration Health + Issue Types + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Integration Health */}
        <Card>
          <CardHeader title="Integration Health" subtitle="Connected billing platforms" />
          <div className="space-y-3">
            <IntegrationStatusRow
              name="Stripe"
              icon="stripe"
              connected={true}
              lastWebhook="5 minutes ago"
              status="healthy"
            />
            <IntegrationStatusRow
              name="Apple App Store"
              icon="apple"
              connected={true}
              lastWebhook="2 hours ago"
              status="stale"
              warning="No webhooks in 2h"
            />
            <IntegrationStatusRow
              name="Google Play"
              icon="google"
              connected={false}
              status="disconnected"
            />
          </div>
        </Card>

        {/* Issues by Type */}
        <Card>
          <CardHeader title="Issues by Type" subtitle="Breakdown by detection category" />
          {revenue?.byType && revenue.byType.length > 0 ? (
            <div className="space-y-2.5">
              {revenue.byType.map((t) => (
                <div key={t.issueType} className="flex items-center justify-between py-1.5">
                  <span className="text-sm text-gray-700">
                    {ISSUE_TYPE_LABELS[t.issueType] || t.issueType.replace(/_/g, ' ')}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-gray-900">{t.issueCount}</span>
                    <span className="text-xs text-gray-400 w-16 text-right">
                      {formatCents(Number(t.totalRevenueCents))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-6">No issues detected yet</p>
          )}
        </Card>

        {/* Entitlement Health / Activity */}
        <Card>
          <CardHeader title="Subscriber Health" subtitle="Entitlement state distribution" />
          {health?.byState && health.byState.length > 0 ? (
            <div className="space-y-2.5">
              {health.byState.map((s) => {
                const total = health.totalUsers || 1;
                const pct = Math.round((s.count / total) * 100);
                const stateColors: Record<string, string> = {
                  active: 'bg-green-500',
                  trial: 'bg-blue-500',
                  grace_period: 'bg-amber-400',
                  billing_retry: 'bg-amber-500',
                  past_due: 'bg-orange-500',
                  expired: 'bg-red-400',
                  revoked: 'bg-red-600',
                  paused: 'bg-gray-400',
                  canceled: 'bg-gray-500',
                };
                return (
                  <div key={s.state}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-700 capitalize">{s.state.replace(/_/g, ' ')}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{formatNumber(s.count)}</span>
                        <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
                      </div>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full transition-all duration-700 ${stateColors[s.state] || 'bg-gray-400'}`}
                        style={{ width: `${Math.max(pct, 1)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center py-6">
              <Activity size={24} className="text-gray-300 mb-2" />
              <p className="text-sm text-gray-400">Connect a billing source</p>
              <p className="text-xs text-gray-400 mt-0.5">to start tracking entitlements</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function IntegrationStatusRow({
  name,
  icon,
  connected,
  lastWebhook,
  status,
  warning,
}: {
  name: string;
  icon: string;
  connected: boolean;
  lastWebhook?: string;
  status: 'healthy' | 'stale' | 'disconnected';
  warning?: string;
}) {
  const sourceEmoji: Record<string, string> = {
    stripe: '',
    apple: '',
    google: '',
  };

  const statusConfig = {
    healthy: { color: 'bg-green-500', label: 'Healthy', icon: CheckCircle, iconColor: 'text-green-500' },
    stale: { color: 'bg-amber-500', label: 'Stale', icon: AlertCircle, iconColor: 'text-amber-500' },
    disconnected: { color: 'bg-gray-300', label: 'Not connected', icon: Clock, iconColor: 'text-gray-400' },
  }[status];

  const StatusIcon = statusConfig.icon;

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50/80 border border-gray-100">
      <div className="w-9 h-9 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-lg shadow-sm">
        {icon === 'stripe' ? (
          <Zap size={16} className="text-purple-600" />
        ) : icon === 'apple' ? (
          <Shield size={16} className="text-gray-700" />
        ) : (
          <Activity size={16} className="text-green-600" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">{name}</span>
          <span className={`w-2 h-2 rounded-full ${statusConfig.color}`} />
        </div>
        {connected ? (
          <p className="text-xs text-gray-500">
            Last webhook: {lastWebhook}
            {warning && <span className="text-amber-600 ml-1 font-medium"> -- {warning}</span>}
          </p>
        ) : (
          <p className="text-xs text-gray-400">Not configured</p>
        )}
      </div>
      {connected && (
        <StatusIcon size={16} className={statusConfig.iconColor} />
      )}
    </div>
  );
}
