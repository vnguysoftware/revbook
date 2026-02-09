import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { fetcher } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { Badge } from '../components/ui/Badge';
import {
  DETECTOR_CATEGORIES,
  DETECTOR_META,
  ISSUE_TYPE_FILTER_OPTIONS,
  type DetectorCategoryKey,
} from '../lib/constants';
import {
  Radar,
  User,
  BarChart3,
  Wifi,
  GitCompare,
  ShieldAlert,
  BadgeCheck,
  Lock,
  CheckCircle,
} from 'lucide-react';
import clsx from 'clsx';

// Map icon name strings from constants to actual lucide components
const categoryIconMap: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Wifi,
  GitCompare,
  ShieldAlert,
  BadgeCheck,
};

// Detector descriptions from the design spec Section D
const DETECTOR_DESCRIPTIONS: Record<string, string> = {
  webhook_delivery_gap:
    'Alerts when no webhooks are received from a billing provider for an unusual period. Catches webhook endpoint failures, provider outages, and misconfigured signing secrets before they cause data gaps.',
  stale_subscription:
    'Detects when a significant portion of subscriptions have not generated any billing events recently. Indicates silent churn, webhook delivery issues, or data sync problems across your subscriber base.',
  duplicate_subscription:
    'Identifies users paying for the same product on multiple platforms simultaneously. Common when users subscribe via both the App Store and your website. Each duplicate represents direct revenue leakage.',
  cross_platform_mismatch:
    'Finds users whose subscription state differs between platforms -- for example, active on Stripe but expired on Apple. Indicates failed cancellation propagation or sync delays between systems.',
  refund_not_revoked:
    'Detects when a refund or chargeback is processed but the user\'s access is not revoked. The user continues using the product for free until manually caught.',
  unusual_renewal_pattern:
    'Monitors renewal rates against a rolling baseline and alerts when rates drop significantly. Early warning for payment processing issues, pricing problems, or payment method expiry waves.',
  verified_paid_no_access:
    'Confirms with your app\'s SDK that a paying user genuinely cannot access the product. Higher confidence than webhook-only detection because it verifies the actual user experience.',
  verified_access_no_payment:
    'Confirms with your app\'s SDK that a non-paying user has unauthorized access. Catches provisioning bugs, revocation failures, and access control bypasses that webhooks alone cannot detect.',
};

// Color mappings for category backgrounds and text
const categoryBgColor: Record<string, string> = {
  slate: 'bg-slate-100',
  violet: 'bg-violet-100',
  amber: 'bg-amber-100',
  emerald: 'bg-emerald-100',
};

const categoryTextColor: Record<string, string> = {
  slate: 'text-slate-600',
  violet: 'text-violet-600',
  amber: 'text-amber-600',
  emerald: 'text-emerald-600',
};

// Severity colors for the count circle
const severityBgColor: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  warning: 'bg-amber-100 text-amber-700',
  info: 'bg-blue-100 text-blue-700',
};

interface IssuesResponse {
  issues: Array<{ issueType: string; status: string }>;
  total: number;
}

export function MonitorsPage() {
  useEffect(() => { document.title = 'What We Monitor - RevBack'; }, []);

  // Fetch open issues to get counts per detector type
  const { data: issuesData } = useSWR<IssuesResponse>(
    '/issues?status=open&limit=500',
    fetcher,
  );

  // Count open issues per detector type
  const issueCountsByType: Record<string, number> = {};
  if (issuesData?.issues) {
    for (const issue of issuesData.issues) {
      const t = issue.issueType;
      issueCountsByType[t] = (issueCountsByType[t] || 0) + 1;
    }
  }

  // Determine SDK connection status: assume not connected if no tier-2 issues exist
  // (In production this would come from an API endpoint)
  const sdkConnected = false;

  const categoryEntries = Object.entries(DETECTOR_CATEGORIES) as [
    DetectorCategoryKey,
    (typeof DETECTOR_CATEGORIES)[DetectorCategoryKey],
  ][];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title="What We Monitor"
        subtitle="RevBack continuously watches for these subscription and billing issues"
      />

      {/* SDK Connection Status Banner */}
      {!sdkConnected && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <BadgeCheck size={24} className="text-emerald-600" />
              <div>
                <p className="text-sm font-semibold text-emerald-800">
                  Unlock Verified Detection
                </p>
                <p className="text-xs text-emerald-600">
                  2 additional detectors available with SDK integration
                </p>
              </div>
            </div>
            <Link
              to="/connect-app"
              className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
            >
              Set Up SDK
            </Link>
          </div>
        </div>
      )}

      {/* Category Sections */}
      <div className="space-y-8">
        {categoryEntries.map(([catKey, cat]) => {
          const IconComponent = categoryIconMap[cat.icon];
          const openCount = cat.detectors.reduce(
            (sum, d) => sum + (issueCountsByType[d] || 0),
            0,
          );

          return (
            <section key={catKey}>
              {/* Category Header */}
              <div className="flex items-center gap-3 mb-4">
                <div
                  className={clsx(
                    'w-8 h-8 rounded-lg flex items-center justify-center',
                    categoryBgColor[cat.color],
                  )}
                >
                  {IconComponent && (
                    <IconComponent
                      size={16}
                      className={categoryTextColor[cat.color]}
                    />
                  )}
                </div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {cat.label}
                </h2>
                {openCount > 0 && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                    {openCount} open
                  </span>
                )}
                <div className="flex-1 h-px bg-gray-200 ml-2" />
              </div>

              {/* Detector Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {cat.detectors.map((detectorId) => {
                  const meta = DETECTOR_META[detectorId];
                  if (!meta) return null;
                  const count = issueCountsByType[detectorId] || 0;
                  const isTier2 = meta.tier === 2;
                  const isLocked = isTier2 && !sdkConnected;
                  const label =
                    ISSUE_TYPE_FILTER_OPTIONS[detectorId] || detectorId;

                  return (
                    <div
                      key={detectorId}
                      className={clsx(
                        'bg-white rounded-xl border p-5',
                        isLocked
                          ? 'border-dashed border-gray-300 opacity-75'
                          : count > 0
                          ? clsx(
                              'border-gray-200 border-l-4',
                              meta.defaultSeverity === 'critical'
                                ? 'border-l-red-500'
                                : meta.defaultSeverity === 'warning'
                                ? 'border-l-amber-500'
                                : 'border-l-blue-500',
                            )
                          : 'border-gray-200',
                      )}
                    >
                      {/* Header row */}
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">
                            {label}
                          </p>
                          <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-gray-500">
                            {meta.scope === 'per_user' ? (
                              <>
                                <User size={10} />
                                Per user
                              </>
                            ) : (
                              <>
                                <BarChart3 size={10} />
                                System-wide
                              </>
                            )}
                          </div>
                        </div>
                        <div>
                          {isLocked ? (
                            <Lock size={16} className="text-gray-400" />
                          ) : count > 0 ? (
                            <div
                              className={clsx(
                                'w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center',
                                severityBgColor[meta.defaultSeverity],
                              )}
                            >
                              {count}
                            </div>
                          ) : (
                            <CheckCircle
                              size={16}
                              className="text-green-400"
                            />
                          )}
                        </div>
                      </div>

                      {/* Description */}
                      <p className="mt-2 text-xs text-gray-600 leading-relaxed">
                        {DETECTOR_DESCRIPTIONS[detectorId]}
                      </p>

                      {/* Severity & action row */}
                      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
                        <Badge
                          variant={
                            meta.defaultSeverity as
                              | 'critical'
                              | 'warning'
                              | 'info'
                          }
                        >
                          {meta.defaultSeverity}
                        </Badge>
                        <div>
                          {isLocked ? (
                            <Link
                              to="/connect-app"
                              className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
                            >
                              Enable with SDK &rarr;
                            </Link>
                          ) : count > 0 ? (
                            <Link
                              to={`/issues?issueType=${detectorId}`}
                              className="text-xs font-medium text-brand-600 hover:text-brand-700"
                            >
                              View {count} issue{count !== 1 ? 's' : ''} &rarr;
                            </Link>
                          ) : (
                            <span className="text-xs text-gray-400">
                              No issues
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Tier 2 footer */}
                      {isLocked && (
                        <div className="mt-3 pt-3 border-t border-dashed border-gray-200 flex items-center gap-2">
                          <BadgeCheck
                            size={14}
                            className="text-emerald-500"
                          />
                          <span className="text-xs font-medium text-emerald-600">
                            Requires SDK integration
                          </span>
                          <span className="text-[10px] text-gray-400 ml-auto">
                            Higher confidence detection
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
