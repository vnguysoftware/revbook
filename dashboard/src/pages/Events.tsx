import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { fetcher } from '../lib/api';
import { formatCents, formatDate, timeAgo } from '../lib/format';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { SkeletonTable } from '../components/ui/Skeleton';
import {
  Activity,
  Zap,
  Shield,
  RefreshCw,
  ExternalLink,
  Calendar,
} from 'lucide-react';

interface Event {
  id: string;
  source: string;
  eventType: string;
  sourceEventType: string | null;
  eventTime: string;
  status: string;
  amountCents: number | null;
  currency: string | null;
  userId: string | null;
  environment: string;
  ingestedAt: string;
}

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

const DATE_PRESETS = [
  { value: '', label: 'All Time' },
  { value: '1', label: 'Last 24h' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
];

export function EventsPage() {
  useEffect(() => { document.title = 'Events - RevBack'; }, []);

  const [source, setSource] = useState('');
  const [dateRange, setDateRange] = useState('');

  // Stable SWR key: round startDate to the start of day so it doesn't change on every render
  const startDateParam = useMemo(() => {
    if (!dateRange) return '';
    const start = new Date();
    start.setDate(start.getDate() - parseInt(dateRange));
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }, [dateRange]);

  const params = new URLSearchParams({ limit: '100' });
  if (source) params.set('source', source);
  if (startDateParam) params.set('startDate', startDateParam);

  const { data, isLoading, error, mutate } = useSWR<{ events: Event[] }>(
    `/dashboard/events?${params}`,
    fetcher,
    { refreshInterval: 10000 },
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Events"
        subtitle="Real-time stream of billing events across all platforms"
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

      {/* Source Filters */}
      <div className="flex items-center gap-2 mb-6">
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

        {data?.events && (
          <span className="ml-auto text-xs text-gray-400">
            {data.events.length} events{dateRange ? ` in last ${dateRange}d` : ' loaded'}
          </span>
        )}
      </div>

      {/* Loading */}
      {isLoading && <SkeletonTable rows={8} />}

      {/* Error */}
      {error && <ErrorState message="Failed to load events" onRetry={() => mutate()} />}

      {/* Empty */}
      {!isLoading && !error && (!data?.events || data.events.length === 0) && (
        <Card>
          <EmptyState
            icon={Activity}
            title="No events yet"
            description="Connect a billing source to start receiving and processing events"
          />
        </Card>
      )}

      {/* Events Table */}
      {!isLoading && !error && data?.events && data.events.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Source</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Event Type</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Status</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Amount</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">User</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.events.map((event) => (
                  <tr key={event.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded bg-gray-50 border border-gray-200 flex items-center justify-center">
                          {sourceIcons[event.source] || <Activity size={12} className="text-gray-400" />}
                        </div>
                        <span className="text-sm font-medium text-gray-900 capitalize">
                          {sourceLabels[event.source] || event.source}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div>
                        <span className="font-mono text-xs font-medium text-gray-900">
                          {event.eventType.replace(/_/g, ' ')}
                        </span>
                        {event.sourceEventType && (
                          <p className="text-[10px] text-gray-400 font-mono mt-0.5">
                            {event.sourceEventType}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <Badge
                        variant={
                          event.status === 'success' ? 'success' :
                          event.status === 'failed' ? 'critical' :
                          'neutral'
                        }
                        size="sm"
                      >
                        {event.status}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      {event.amountCents != null ? (
                        <span className="text-sm font-medium text-gray-900">
                          {formatCents(event.amountCents, event.currency || 'USD')}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">--</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {event.userId ? (
                        <Link
                          to={`/users/${event.userId}`}
                          className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-mono transition-colors"
                        >
                          {event.userId.slice(0, 8)}
                          <ExternalLink size={10} />
                        </Link>
                      ) : (
                        <span className="text-xs text-gray-300">--</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div>
                        <p className="text-xs text-gray-500">{timeAgo(event.eventTime)}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{formatDate(event.eventTime)}</p>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
