import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { fetcher } from '../lib/api';
import { formatCents } from '../lib/format';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { PageHeader } from '../components/ui/PageHeader';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';
import { SkeletonCard } from '../components/ui/Skeleton';
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Lightbulb,
  BarChart3,
  Activity,
  Shield,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Brain,
  Target,
} from 'lucide-react';
import clsx from 'clsx';

interface Metric {
  name: string;
  current: number;
  previous: number;
  change: number;
}

interface Insight {
  title: string;
  description: string;
  category: 'trend' | 'anomaly' | 'recommendation' | 'performance';
  severity: 'info' | 'warning' | 'critical';
  metric?: Metric;
}

interface InsightsResponse {
  insights: Insight[];
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  aiEnabled: boolean;
}

interface DetectorHealth {
  detectorId: string;
  totalDetected: number;
  resolved: number;
  dismissed: number;
  open: number;
  acknowledged: number;
  truePositiveRate: number;
  falsePositiveRate: number;
  avgConfidence: number;
}

interface HealthResponse {
  detectors: DetectorHealth[];
  overallTruePositiveRate: number;
  totalIssues: number;
  totalActioned: number;
}

interface IncidentCluster {
  id: string;
  title: string;
  summary: string;
  issueType: string;
  severity: 'critical' | 'warning' | 'info';
  issueCount: number;
  affectedUsers: number;
  totalRevenueCents: number;
  timeWindowStart: string;
  timeWindowEnd: string;
  source: string | null;
}

interface IncidentsResponse {
  incidents: IncidentCluster[];
  count: number;
  aiEnabled: boolean;
}

const categoryIcons = {
  trend: TrendingUp,
  anomaly: AlertTriangle,
  recommendation: Lightbulb,
  performance: BarChart3,
};

const categoryLabels = {
  trend: 'Trend',
  anomaly: 'Anomaly',
  recommendation: 'Recommendation',
  performance: 'Performance',
};

export function InsightsPage() {
  useEffect(() => { document.title = 'AI Insights - RevBack'; }, []);

  const [period, setPeriod] = useState<'daily' | 'weekly'>('daily');
  const [expandedInsight, setExpandedInsight] = useState<number | null>(null);

  const { data: insightsData, isLoading: insightsLoading, error: insightsError, mutate: mutateInsights } = useSWR<InsightsResponse>(
    `/insights?period=${period}`,
    fetcher,
    { refreshInterval: 300000 },
  );

  const { data: healthData, isLoading: healthLoading } = useSWR<HealthResponse>(
    '/detectors/health',
    fetcher,
  );

  const { data: incidentsData, isLoading: incidentsLoading } = useSWR<IncidentsResponse>(
    '/issues/incidents',
    fetcher,
    { refreshInterval: 120000 },
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <PageHeader
        title="AI Insights"
        subtitle="Intelligent analysis of your billing health and detected issues"
        actions={
          <div className="flex items-center gap-3">
            {insightsData && (
              <Badge variant={insightsData.aiEnabled ? 'success' : 'neutral'}>
                <Sparkles size={12} />
                {insightsData.aiEnabled ? 'AI Enhanced' : 'Rule-based'}
              </Badge>
            )}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              <button
                onClick={() => setPeriod('daily')}
                className={clsx(
                  'px-3.5 py-2 text-xs font-medium transition-all',
                  period === 'daily' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
                )}
              >
                Daily
              </button>
              <button
                onClick={() => setPeriod('weekly')}
                className={clsx(
                  'px-3.5 py-2 text-xs font-medium transition-all',
                  period === 'weekly' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
                )}
              >
                Weekly
              </button>
            </div>
          </div>
        }
      />

      {/* AI Banner */}
      {(!insightsData?.aiEnabled) && !insightsLoading && (
        <div className="bg-gradient-to-br from-sidebar via-sidebar-light to-brand-900 rounded-xl p-6 mb-8 text-white">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
              <Brain size={24} className="text-brand-500" />
            </div>
            <div>
              <h2 className="text-lg font-bold mb-1">Enable AI-Powered Analysis</h2>
              <p className="text-gray-400 text-sm leading-relaxed max-w-lg">
                Get deeper insights with AI analysis including churn prediction, anomaly detection,
                and personalized recommendations to optimize your subscription revenue.
              </p>
              <p className="mt-3 text-xs text-gray-400">
                AI-powered analysis will be available once enabled for your account.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Active Incidents */}
      {!incidentsLoading && incidentsData && incidentsData.incidents.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            Active Incidents
          </h2>
          <div className="space-y-3">
            {incidentsData.incidents.map((incident) => (
              <Card key={incident.id} className={clsx(
                'border-l-4',
                incident.severity === 'critical' ? 'border-l-red-500 bg-red-50/30' :
                incident.severity === 'warning' ? 'border-l-amber-500 bg-amber-50/30' :
                'border-l-blue-500 bg-blue-50/30',
              )}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <Badge variant={incident.severity as any} dot>{incident.severity}</Badge>
                      {incident.source && (
                        <Badge variant="neutral">{incident.source}</Badge>
                      )}
                    </div>
                    <h3 className="font-semibold text-gray-900">{incident.title}</h3>
                    <p className="text-sm text-gray-600 mt-1 leading-relaxed">{incident.summary}</p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-6">
                    <p className="text-3xl font-bold text-gray-900">{incident.issueCount}</p>
                    <p className="text-xs text-gray-500">issues</p>
                  </div>
                </div>
                <div className="flex gap-4 mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Target size={12} /> {incident.affectedUsers} users affected
                  </span>
                  {incident.totalRevenueCents > 0 && (
                    <span className="font-medium text-red-600">
                      {formatCents(incident.totalRevenueCents)} revenue impact
                    </span>
                  )}
                  <span>
                    {new Date(incident.timeWindowStart).toLocaleTimeString()} - {new Date(incident.timeWindowEnd).toLocaleTimeString()}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Insights */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Billing Health Insights</h2>

        {insightsLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : insightsError ? (
          <ErrorState message="Failed to load insights" onRetry={() => mutateInsights()} />
        ) : !insightsData || insightsData.insights.length === 0 ? (
          <Card className="bg-green-50/50 border-green-200">
            <div className="flex flex-col items-center py-6">
              <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mb-3">
                <Shield size={24} className="text-green-600" />
              </div>
              <p className="text-green-900 font-semibold mb-1">All Clear</p>
              <p className="text-sm text-green-700">No notable insights for this period. Your billing health looks good.</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {insightsData.insights.map((insight, idx) => {
              const Icon = categoryIcons[insight.category];
              const isExpanded = expandedInsight === idx;

              return (
                <Card
                  key={idx}
                  hover
                  className={clsx(
                    'border-l-4',
                    insight.severity === 'critical' ? 'border-l-red-500' :
                    insight.severity === 'warning' ? 'border-l-amber-500' :
                    'border-l-blue-500',
                  )}
                >
                  <div
                    className="cursor-pointer"
                    onClick={() => setExpandedInsight(isExpanded ? null : idx)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className={clsx(
                          'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
                          insight.severity === 'critical' ? 'bg-red-50 text-red-600' :
                          insight.severity === 'warning' ? 'bg-amber-50 text-amber-600' :
                          'bg-blue-50 text-blue-600',
                        )}>
                          <Icon size={18} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant={insight.severity as any} size="sm">
                              {categoryLabels[insight.category]}
                            </Badge>
                          </div>
                          <h3 className="font-medium text-gray-900">{insight.title}</h3>
                          {isExpanded && (
                            <p className="text-sm text-gray-600 mt-2 leading-relaxed">{insight.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {insight.metric && (
                          <div className="text-right">
                            <div className="flex items-center gap-1">
                              {insight.metric.change > 0 ? (
                                <TrendingUp size={14} className="text-red-500" />
                              ) : (
                                <TrendingDown size={14} className="text-green-500" />
                              )}
                              <span
                                className={clsx(
                                  'text-sm font-bold',
                                  insight.metric.change > 0 ? 'text-red-600' : 'text-green-600',
                                )}
                              >
                                {insight.metric.change > 0 ? '+' : ''}
                                {Math.round(insight.metric.change)}%
                              </span>
                            </div>
                          </div>
                        )}
                        {isExpanded ? (
                          <ChevronUp size={16} className="text-gray-400" />
                        ) : (
                          <ChevronDown size={16} className="text-gray-400" />
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Detector Health */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Shield size={18} className="text-green-600" />
          Detector Accuracy
        </h2>

        {healthLoading ? (
          <SkeletonCard />
        ) : !healthData || healthData.detectors.length === 0 ? (
          <Card>
            <EmptyState
              icon={Activity}
              title="No detector data yet"
              description="Issues need to be resolved or dismissed to build accuracy metrics"
            />
          </Card>
        ) : (
          <>
            {/* Summary stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <Card>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Overall TP Rate</p>
                <p className="text-3xl font-bold text-gray-900">
                  {Math.round(healthData.overallTruePositiveRate * 100)}%
                </p>
                <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2">
                  <div
                    className="h-1.5 rounded-full bg-green-500 transition-all duration-500"
                    style={{ width: `${Math.round(healthData.overallTruePositiveRate * 100)}%` }}
                  />
                </div>
              </Card>
              <Card>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Total Issues</p>
                <p className="text-3xl font-bold text-gray-900">{healthData.totalIssues}</p>
              </Card>
              <Card>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Actioned</p>
                <p className="text-3xl font-bold text-gray-900">{healthData.totalActioned}</p>
              </Card>
            </div>

            {/* Detector table */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Detector</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Detected</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Resolved</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Dismissed</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">TP Rate</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Avg Confidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {healthData.detectors.map((d) => (
                      <tr key={d.detectorId} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3">
                          <span className="font-medium text-gray-900">{d.detectorId}</span>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600">{d.totalDetected}</td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-green-600 font-medium">{d.resolved}</span>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-400">{d.dismissed}</td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className={clsx(
                              'font-bold',
                              d.truePositiveRate >= 0.8
                                ? 'text-green-600'
                                : d.truePositiveRate >= 0.5
                                ? 'text-amber-600'
                                : d.truePositiveRate > 0
                                ? 'text-red-600'
                                : 'text-gray-400',
                            )}
                          >
                            {d.resolved + d.dismissed > 0
                              ? `${Math.round(d.truePositiveRate * 100)}%`
                              : '--'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600">
                          {d.avgConfidence > 0 ? `${Math.round(d.avgConfidence * 100)}%` : '--'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
