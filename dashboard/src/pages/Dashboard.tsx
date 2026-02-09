import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { fetcher } from '../lib/api';
import { formatCents, formatNumber, timeAgo, severityDot } from '../lib/format';
import {
  ISSUE_TYPE_LABELS,
  DETECTOR_CATEGORIES,
  DETECTOR_META,
  getIssueCategory,
  type DetectorCategoryKey,
} from '../lib/constants';
import { KPICard } from '../components/ui/KPICard';
import { Card, CardHeader } from '../components/ui/Card';
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
  Wifi,
  GitCompare,
  ShieldAlert,
  BadgeCheck,
  Lock,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// Per-category computed data
interface CategoryData {
  openIssues: number;
  criticalIssues: number;
  revenueAtRiskCents: number;
  detectors: Record<string, { openIssues: number; maxSeverity: string; revenueCents: number }>;
}

// ---------------------------------------------------------------------------
// Icon map for categories
// ---------------------------------------------------------------------------

const CATEGORY_ICONS: Record<string, React.FC<{ size?: number; className?: string }>> = {
  Wifi,
  GitCompare,
  ShieldAlert,
  BadgeCheck,
};

// ---------------------------------------------------------------------------
// Color utilities per category
// ---------------------------------------------------------------------------

const CATEGORY_COLOR_CLASSES: Record<string, { icon: string; bg: string; border: string }> = {
  slate: { icon: 'text-slate-600', bg: 'bg-slate-100', border: 'border-slate-200' },
  violet: { icon: 'text-violet-600', bg: 'bg-violet-100', border: 'border-violet-200' },
  amber: { icon: 'text-amber-600', bg: 'bg-amber-100', border: 'border-amber-200' },
  emerald: { icon: 'text-emerald-600', bg: 'bg-emerald-100', border: 'border-emerald-200' },
};

// ---------------------------------------------------------------------------
// DashboardPage
// ---------------------------------------------------------------------------

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
  const { data: trendData } = useSWR<{ trend: Array<{ date: string; severity: string; count: number; revenue: string | null }> }>(
    '/dashboard/trends/issues?days=14',
    fetcher,
    { refreshInterval: 60000 },
  );

  const hasError = summaryError || revenueError || healthError;
  const isLoading = !summary && !summaryError;

  // Compute category-level data from existing byType data
  const categoryData = useMemo(() => {
    const result: Record<DetectorCategoryKey, CategoryData> = {
      integration_health: { openIssues: 0, criticalIssues: 0, revenueAtRiskCents: 0, detectors: {} },
      cross_platform: { openIssues: 0, criticalIssues: 0, revenueAtRiskCents: 0, detectors: {} },
      revenue_protection: { openIssues: 0, criticalIssues: 0, revenueAtRiskCents: 0, detectors: {} },
      verified: { openIssues: 0, criticalIssues: 0, revenueAtRiskCents: 0, detectors: {} },
    };

    // Initialize all detectors with zero counts
    for (const [catKey, cat] of Object.entries(DETECTOR_CATEGORIES)) {
      for (const detector of cat.detectors) {
        result[catKey as DetectorCategoryKey].detectors[detector] = {
          openIssues: 0,
          maxSeverity: 'info',
          revenueCents: 0,
        };
      }
    }

    // Fill from summary byType (issue counts)
    if (summary?.byType) {
      for (const item of summary.byType) {
        const catKey = getIssueCategory(item.issueType);
        const cat = result[catKey];
        cat.openIssues += item.count;
        // Determine the actual detector key for the category
        const detectorKey = Object.keys(cat.detectors).find(d =>
          d === item.issueType || DETECTOR_META[d]?.category === catKey
        );
        if (detectorKey && cat.detectors[detectorKey]) {
          cat.detectors[detectorKey].openIssues += item.count;
        }
      }
    }

    // Fill from revenue byType (revenue + severity hints)
    if (revenue?.byType) {
      for (const item of revenue.byType) {
        const catKey = getIssueCategory(item.issueType);
        const cat = result[catKey];
        const rev = Number(item.totalRevenueCents) || 0;
        cat.revenueAtRiskCents += rev;

        const detectorKey = Object.keys(cat.detectors).find(d =>
          d === item.issueType || DETECTOR_META[d]?.category === catKey
        );
        if (detectorKey && cat.detectors[detectorKey]) {
          cat.detectors[detectorKey].revenueCents += rev;
          // Use detector default severity as a proxy since we don't have per-issue severity here
          const meta = DETECTOR_META[detectorKey];
          if (meta && cat.detectors[detectorKey].openIssues > 0) {
            cat.detectors[detectorKey].maxSeverity = meta.defaultSeverity;
            if (meta.defaultSeverity === 'critical') {
              cat.criticalIssues += cat.detectors[detectorKey].openIssues;
            }
          }
        }
      }
    }

    return result;
  }, [summary, revenue]);

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

  // Compute daily trend from severity-level data
  const dailyTrend = useMemo(() => {
    if (!trendData?.trend) return [];
    const byDay: Record<string, { date: string; critical: number; warning: number; info: number; total: number }> = {};
    for (const entry of trendData.trend) {
      const d = entry.date;
      if (!byDay[d]) byDay[d] = { date: d, critical: 0, warning: 0, info: 0, total: 0 };
      const sev = entry.severity as 'critical' | 'warning' | 'info';
      if (sev in byDay[d]) byDay[d][sev] += entry.count;
      byDay[d].total += entry.count;
    }
    // Fill in missing days in last 14 days
    const result: typeof byDay[string][] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      result.push(byDay[key] || { date: key, critical: 0, warning: 0, info: 0, total: 0 });
    }
    return result;
  }, [trendData]);

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
            value={revenue?.saved.totalCents ? formatCents(revenue.saved.totalCents) : '--'}
            sublabel={
              revenue?.saved.totalCents
                ? `${revenue.saved.issueCount} issues resolved`
                : 'Resolve issues to start tracking savings'
            }
            variant={revenue?.saved.totalCents ? 'success' : 'neutral'}
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
        {/* Issue Trend (14 days) */}
        <Card className="lg:col-span-1">
          <CardHeader title="Issue Trend" subtitle="New issues over the last 14 days" />
          {dailyTrend.length > 0 ? (() => {
            const maxTotal = Math.max(...dailyTrend.map(d => d.total), 1);
            const barMaxPx = 96; // max bar height in pixels
            return (
              <div>
                {/* Bar chart */}
                <div className="flex items-end gap-[3px] mb-3" style={{ height: `${barMaxPx + 8}px` }}>
                  {dailyTrend.map((day) => {
                    const barPx = Math.max(Math.round((day.total / maxTotal) * barMaxPx), day.total > 0 ? 4 : 2);
                    const dayLabel = new Date(day.date + 'T12:00:00').toLocaleDateString('en', { weekday: 'short' });
                    // Pick the dominant severity color for the bar
                    const barColor = day.critical > 0 && day.critical >= day.warning ? 'bg-red-400' :
                      day.warning > 0 ? 'bg-amber-400' :
                      day.total > 0 ? 'bg-blue-400' : 'bg-gray-200';
                    return (
                      <div
                        key={day.date}
                        className={`flex-1 rounded-sm ${barColor} transition-all duration-500`}
                        style={{ height: `${barPx}px` }}
                        title={`${dayLabel}: ${day.total} issues`}
                      />
                    );
                  })}
                </div>

                {/* Date labels */}
                <div className="flex justify-between text-[10px] text-gray-400 mb-3">
                  <span>{new Date(dailyTrend[0].date + 'T12:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span>
                  <span>{new Date(dailyTrend[dailyTrend.length - 1].date + 'T12:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span>
                </div>

                {/* Summary legend */}
                <div className="space-y-1.5">
                  {revenue?.bySeverity?.map((s) => {
                    const pct = totalSeverityIssues > 0 ? Math.round((s.issueCount / totalSeverityIssues) * 100) : 0;
                    return (
                      <div key={s.severity} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${severityDot(s.severity)}`} />
                          <span className="text-xs capitalize text-gray-600">{s.severity}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-gray-900">{s.issueCount}</span>
                          <span className="text-xs text-gray-400">{pct}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })() : (
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

      {/* Row 3: Category Health Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {/* Integration Health (special) */}
        <IntegrationHealthCard data={categoryData.integration_health} />

        {/* Cross-Platform Intelligence */}
        <CategoryHealthCard
          categoryKey="cross_platform"
          data={categoryData.cross_platform}
        />

        {/* Revenue Protection */}
        <CategoryHealthCard
          categoryKey="revenue_protection"
          data={categoryData.revenue_protection}
        />

        {/* Verified Issues (special upsell) */}
        <VerifiedIssuesCard data={categoryData.verified} sdkConnected={false} />
      </div>

      {/* Row 4: Subscriber Health (full-width horizontal bar) */}
      <SubscriberHealthBar health={health} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CategoryHealthCard
// ---------------------------------------------------------------------------

function CategoryHealthCard({
  categoryKey,
  data,
}: {
  categoryKey: DetectorCategoryKey;
  data: CategoryData;
}) {
  const category = DETECTOR_CATEGORIES[categoryKey];
  const colors = CATEGORY_COLOR_CLASSES[category.color];
  const Icon = CATEGORY_ICONS[category.icon];

  const hasCritical = data.criticalIssues > 0;
  const hasWarning = data.openIssues > 0 && !hasCritical;
  const isClear = data.openIssues === 0;

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {Icon && (
            <div className={`w-7 h-7 rounded-lg ${colors.bg} flex items-center justify-center`}>
              <Icon size={14} className={colors.icon} />
            </div>
          )}
          <span className="text-sm font-semibold text-gray-900">{category.label}</span>
        </div>
        <CountBadge count={data.openIssues} hasCritical={hasCritical} hasWarning={hasWarning} />
      </div>

      {/* Metric */}
      <div className="mb-3">
        <span className="text-2xl font-bold text-gray-900">{data.openIssues}</span>
        <span className="text-xs text-gray-500 ml-1">open issues</span>
        {data.revenueAtRiskCents > 0 && (
          <p className="text-xs text-gray-500">
            {formatCents(data.revenueAtRiskCents)} at risk
          </p>
        )}
      </div>

      {/* Detector list */}
      <div className="space-y-1.5">
        {category.detectors.map((detector) => {
          const detData = data.detectors[detector];
          const label = ISSUE_TYPE_LABELS[detector] || detector.replace(/_/g, ' ');
          const count = detData?.openIssues || 0;
          const severity = detData?.maxSeverity || 'info';

          return (
            <div key={detector} className="flex items-center justify-between">
              <span className="text-xs text-gray-600">{label}</span>
              {count > 0 ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-gray-900">{count}</span>
                  <span className={`w-1.5 h-1.5 rounded-full ${severityDot(severity)}`} />
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <CheckCircle size={12} className="text-green-400" />
                  <span className="text-xs text-green-600">Clear</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// IntegrationHealthCard (special)
// ---------------------------------------------------------------------------

function IntegrationHealthCard({ data }: { data: CategoryData }) {
  const category = DETECTOR_CATEGORIES.integration_health;
  const colors = CATEGORY_COLOR_CLASSES[category.color];

  const hasCritical = data.criticalIssues > 0;
  const hasWarning = data.openIssues > 0 && !hasCritical;

  // Static provider data (would come from API in production)
  const providers = [
    { name: 'Stripe', status: 'healthy' as const, lastWebhook: '5m ago', icon: Zap, iconColor: 'text-purple-600' },
    { name: 'Apple', status: 'stale' as const, lastWebhook: '2h ago', icon: Shield, iconColor: 'text-gray-700' },
    { name: 'Google', status: 'disconnected' as const, lastWebhook: undefined, icon: Activity, iconColor: 'text-green-600' },
  ];

  const statusDotColor = {
    healthy: 'bg-green-500',
    stale: 'bg-amber-500',
    disconnected: 'bg-gray-300',
  };

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-lg ${colors.bg} flex items-center justify-center`}>
            <Wifi size={14} className={colors.icon} />
          </div>
          <span className="text-sm font-semibold text-gray-900">{category.label}</span>
        </div>
        <CountBadge count={data.openIssues} hasCritical={hasCritical} hasWarning={hasWarning} />
      </div>

      {/* Provider status rows */}
      <div className="space-y-1.5 mb-3">
        {providers.map((p) => {
          const ProviderIcon = p.icon;
          return (
            <div key={p.name} className="flex items-center gap-2 py-1.5">
              <span className={`w-2 h-2 rounded-full ${statusDotColor[p.status]}`} />
              <ProviderIcon size={12} className={p.iconColor} />
              <span className="text-xs font-medium text-gray-700">{p.name}</span>
              <span className="text-xs text-gray-400 ml-auto">
                {p.lastWebhook || 'Not connected'}
              </span>
            </div>
          );
        })}
      </div>

      {/* Detector summary */}
      <div className="space-y-1.5 pt-2 border-t border-gray-100">
        {category.detectors.map((detector) => {
          const detData = data.detectors[detector];
          const label = ISSUE_TYPE_LABELS[detector] || detector.replace(/_/g, ' ');
          const count = detData?.openIssues || 0;
          const severity = detData?.maxSeverity || 'info';

          return (
            <div key={detector} className="flex items-center justify-between">
              <span className="text-xs text-gray-600">{label}</span>
              {count > 0 ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-gray-900">{count}</span>
                  <span className={`w-1.5 h-1.5 rounded-full ${severityDot(severity)}`} />
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <CheckCircle size={12} className="text-green-400" />
                  <span className="text-xs text-green-600">Clear</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Stale data warning banner */}
      {(data.detectors['stale_subscription']?.openIssues || 0) > 0 && (
        <div className="mt-2 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <p className="text-xs text-amber-700">
            Stale billing data detected. Review and trigger a re-sync.
          </p>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// VerifiedIssuesCard (special upsell / Tier 2)
// ---------------------------------------------------------------------------

function VerifiedIssuesCard({
  data,
  sdkConnected,
}: {
  data: CategoryData;
  sdkConnected: boolean;
}) {
  const category = DETECTOR_CATEGORIES.verified;
  const colors = CATEGORY_COLOR_CLASSES[category.color];

  if (!sdkConnected) {
    return (
      <Card className="border-dashed border-gray-300">
        {/* Header with Lock icon */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center">
              <Lock size={14} className="text-gray-400" />
            </div>
            <span className="text-sm font-semibold text-gray-900">{category.label}</span>
          </div>
        </div>

        {/* Upsell content */}
        <div className="flex flex-col items-center py-4">
          <BadgeCheck size={32} className="text-gray-300" />
          <p className="text-sm font-semibold text-gray-700 mt-2">Unlock Verified Detection</p>
          <p className="text-xs text-gray-500 mt-1 text-center">
            Confirm real user access with our SDK
          </p>

          {/* Preview metrics (faded) */}
          <div className="mt-4 bg-gray-50 rounded-lg p-3 w-full space-y-2">
            <div className="flex items-center justify-between opacity-50">
              <span className="text-xs text-gray-400">Paid But No Access</span>
              <span className="text-xs text-gray-400">--</span>
            </div>
            <div className="flex items-center justify-between opacity-50">
              <span className="text-xs text-gray-400">Access Without Payment</span>
              <span className="text-xs text-gray-400">--</span>
            </div>
          </div>

          {/* CTA */}
          <Link
            to="/connect-app"
            className="mt-3 text-xs font-medium text-brand-600 hover:text-brand-700 flex items-center gap-1 transition-colors"
          >
            Set up SDK integration <ArrowRight size={12} />
          </Link>
        </div>
      </Card>
    );
  }

  // SDK connected: render like a normal category card with emerald accent
  const hasCritical = data.criticalIssues > 0;
  const hasWarning = data.openIssues > 0 && !hasCritical;

  return (
    <Card className="border-t-2 border-t-emerald-500">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-lg ${colors.bg} flex items-center justify-center`}>
            <BadgeCheck size={14} className={colors.icon} />
          </div>
          <span className="text-sm font-semibold text-gray-900">{category.label}</span>
        </div>
        <CountBadge count={data.openIssues} hasCritical={hasCritical} hasWarning={hasWarning} />
      </div>

      {/* Metric */}
      <div className="mb-3">
        <span className="text-2xl font-bold text-gray-900">{data.openIssues}</span>
        <span className="text-xs text-gray-500 ml-1">open issues</span>
        {data.revenueAtRiskCents > 0 && (
          <p className="text-xs text-gray-500">
            {formatCents(data.revenueAtRiskCents)} at risk
          </p>
        )}
      </div>

      {/* Detector list with BadgeCheck icons */}
      <div className="space-y-1.5">
        {category.detectors.map((detector) => {
          const detData = data.detectors[detector];
          const label = ISSUE_TYPE_LABELS[detector] || detector.replace(/_/g, ' ');
          const count = detData?.openIssues || 0;
          const severity = detData?.maxSeverity || 'info';

          return (
            <div key={detector} className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <BadgeCheck size={12} className="text-emerald-500" />
                <span className="text-xs text-gray-600">{label}</span>
              </div>
              {count > 0 ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-gray-900">{count}</span>
                  <span className={`w-1.5 h-1.5 rounded-full ${severityDot(severity)}`} />
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <CheckCircle size={12} className="text-green-400" />
                  <span className="text-xs text-green-600">Clear</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// CountBadge (issue count circle in card headers)
// ---------------------------------------------------------------------------

function CountBadge({
  count,
  hasCritical,
  hasWarning,
}: {
  count: number;
  hasCritical: boolean;
  hasWarning: boolean;
}) {
  if (count === 0) {
    return (
      <span className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center">
        <CheckCircle size={12} className="text-green-700" />
      </span>
    );
  }

  const bg = hasCritical ? 'bg-red-100 text-red-700' : hasWarning ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700';

  return (
    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${bg}`}>
      {count}
    </span>
  );
}

// ---------------------------------------------------------------------------
// SubscriberHealthBar (full-width horizontal bar)
// ---------------------------------------------------------------------------

const STATE_COLORS: Record<string, string> = {
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

const STATE_LABELS: Record<string, string> = {
  active: 'Active',
  inactive: 'Inactive',
  trial: 'Trial',
  grace_period: 'Grace Period',
  billing_retry: 'Payment Retry',
  past_due: 'Past Due',
  expired: 'Expired',
  revoked: 'Revoked',
  paused: 'Paused',
  canceled: 'Canceled',
  on_hold: 'On Hold',
  refunded: 'Refunded',
};

function SubscriberHealthBar({ health }: { health: HealthData | undefined }) {
  if (!health?.byState || health.byState.length === 0) {
    return (
      <Card>
        <CardHeader
          title="Subscription Status Breakdown"
          subtitle="How your subscribers are distributed across all platforms"
        />
        <div className="flex flex-col items-center py-6">
          <Activity size={24} className="text-gray-300 mb-2" />
          <p className="text-sm text-gray-400">Connect a billing source</p>
          <p className="text-xs text-gray-400 mt-0.5">to start tracking subscriptions</p>
        </div>
      </Card>
    );
  }

  const total = health.totalUsers || 1;

  return (
    <Card>
      <CardHeader
        title="Subscription Status Breakdown"
        subtitle="How your subscribers are distributed across all platforms"
      />

      {/* Stacked horizontal bar */}
      <div className="h-4 rounded-full flex overflow-hidden bg-gray-100">
        {health.byState.map((s) => {
          const pct = (s.count / total) * 100;
          if (pct < 0.5) return null;
          return (
            <div
              key={s.state}
              className={`${STATE_COLORS[s.state] || 'bg-gray-400'} transition-all duration-700`}
              style={{ width: `${pct}%` }}
              title={`${STATE_LABELS[s.state] || s.state.replace(/_/g, ' ')}: ${formatNumber(s.count)} (${Math.round(pct)}%)`}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3">
        {health.byState.map((s) => {
          const pct = Math.round((s.count / total) * 100);
          return (
            <div key={s.state} className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${STATE_COLORS[s.state] || 'bg-gray-400'}`} />
              <span className="text-xs text-gray-700">{STATE_LABELS[s.state] || s.state.replace(/_/g, ' ')}</span>
              <span className="text-xs text-gray-400">{formatNumber(s.count)}</span>
              <span className="text-xs text-gray-400">({pct}%)</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
