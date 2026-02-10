import { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import useSWR from 'swr';
import { fetcher } from '../lib/api';
import { formatCents, formatDate, timeAgo, stateColor, sourceIcon } from '../lib/format';
import { Badge } from '../components/ui/Badge';
import { Card, CardHeader } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { ErrorState } from '../components/ui/ErrorState';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import {
  User,
  Mail,
  Calendar,
  ExternalLink,
  Zap,
  Shield,
  Activity,
  CreditCard,
  AlertTriangle,
  CheckCircle,
  Clock,
} from 'lucide-react';

interface UserProfileData {
  user: { id: string; email: string | null; externalUserId: string | null; createdAt: string };
  identities: Array<{ source: string; externalId: string; idType: string }>;
  entitlements: Array<{
    id: string; source: string; state: string; productId: string;
    currentPeriodEnd: string | null; externalSubscriptionId: string | null;
  }>;
  openIssues: Array<{ id: string; title: string; severity: string; createdAt: string }>;
  recentEvents: Array<{
    id: string; source: string; eventType: string; eventTime: string;
    status: string; amountCents: number | null; currency: string | null;
  }>;
}

export function UserProfilePage() {
  const { userId } = useParams<{ userId: string }>();

  useEffect(() => { document.title = 'User Profile - RevBack'; }, []);

  const { data, isLoading, error, mutate } = useSWR<UserProfileData>(`/users/${userId}`, fetcher);

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Skeleton className="h-4 w-32 mb-4" />
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <Skeleton className="h-8 w-64 mb-3" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <ErrorState message="Failed to load user profile" onRetry={() => mutate()} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <ErrorState message="User not found" />
      </div>
    );
  }

  const { user, identities, entitlements, openIssues, recentEvents } = data;

  const sourceIcons: Record<string, React.ReactNode> = {
    stripe: <Zap size={14} className="text-purple-600" />,
    apple: <Shield size={14} className="text-gray-700" />,
    google: <Activity size={14} className="text-green-600" />,
    recurly: <CreditCard size={14} className="text-blue-600" />,
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <PageHeader
        title=""
        breadcrumbs={[
          { label: 'Users', to: '/users' },
          { label: user.email || user.externalUserId || user.id.slice(0, 12) },
        ]}
      />

      {/* User Header */}
      <Card padding="lg" className="mb-6">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white text-lg font-bold flex-shrink-0">
            {(user.email || user.externalUserId || user.id)[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-gray-900 mb-1">
              {user.email || user.externalUserId || user.id.slice(0, 16)}
            </h1>
            <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
              {user.email && (
                <span className="flex items-center gap-1.5">
                  <Mail size={13} /> {user.email}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <Calendar size={13} /> Member since {formatDate(user.createdAt)}
              </span>
              <span className="flex items-center gap-1.5 font-mono">
                ID: {user.id.slice(0, 8)}
              </span>
            </div>

            {/* Identities */}
            {identities.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {identities.map((id, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg font-mono"
                  >
                    {sourceIcons[id.source] || <CreditCard size={12} />}
                    <span className="text-gray-500">{id.idType}:</span>
                    <span className="text-gray-700">{id.externalId.length > 20 ? id.externalId.slice(0, 20) + '...' : id.externalId}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="flex gap-4 flex-shrink-0">
            <div className="text-center px-3">
              <p className="text-2xl font-bold text-gray-900">{entitlements.length}</p>
              <p className="text-xs text-gray-500">Subscriptions</p>
            </div>
            <div className="text-center px-3">
              <p className={`text-2xl font-bold ${openIssues.length > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {openIssues.length}
              </p>
              <p className="text-xs text-gray-500">Open Issues</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Open Issues */}
      {openIssues.length > 0 && (
        <Card padding="none" className="mb-6 border-red-200">
          <div className="px-5 py-4 border-b border-red-100 bg-red-50/50">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-600" />
              <h3 className="font-semibold text-red-900">Open Issues ({openIssues.length})</h3>
            </div>
          </div>
          <div className="divide-y divide-red-50">
            {openIssues.map((issue) => (
              <Link
                key={issue.id}
                to={`/issues/${issue.id}`}
                className="flex items-center gap-3 px-5 py-3 hover:bg-red-50/30 transition-colors"
              >
                <Badge variant={issue.severity as any} size="sm">{issue.severity}</Badge>
                <span className="text-sm font-medium text-gray-900 flex-1 truncate">{issue.title}</span>
                <span className="text-xs text-gray-400 flex-shrink-0">{timeAgo(issue.createdAt)}</span>
                <ExternalLink size={14} className="text-gray-300 flex-shrink-0" />
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Entitlements */}
      <Card padding="none" className="mb-6">
        <div className="px-5 py-4 border-b border-gray-100">
          <CardHeader title="Subscriptions" subtitle="Active entitlements and their current state" />
        </div>
        {entitlements.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={CreditCard}
              title="No subscriptions"
              description="No entitlements found for this user"
            />
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {entitlements.map((ent) => (
              <div key={ent.id} className="flex items-center justify-between px-5 py-4 hover:bg-gray-50/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center">
                    {sourceIcons[ent.source] || <CreditCard size={14} className="text-gray-400" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {ent.externalSubscriptionId || ent.productId.slice(0, 12)}
                    </p>
                    <p className="text-xs text-gray-500 capitalize">{ent.source}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`inline-block px-2.5 py-1 text-xs font-medium rounded-full ${stateColor(ent.state)}`}>
                    {ent.state.replace(/_/g, ' ')}
                  </span>
                  {ent.currentPeriodEnd && (
                    <p className="text-xs text-gray-400 mt-1">
                      Period ends {formatDate(ent.currentPeriodEnd)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Event Timeline */}
      <Card padding="lg">
        <CardHeader title="Event Timeline" subtitle="Recent billing events for this user" />
        {recentEvents.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No events"
            description="No billing events recorded for this user yet"
          />
        ) : (
          <div className="relative">
            <div className="absolute left-[15px] top-2 bottom-2 w-px bg-gray-200" />
            <div className="space-y-1">
              {recentEvents.map((event) => (
                <div key={event.id} className="flex gap-4 relative">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs flex-shrink-0 z-10 border-2 border-white ${
                      event.status === 'success'
                        ? 'bg-green-100 text-green-700'
                        : event.status === 'failed'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {event.status === 'success' ? (
                      <CheckCircle size={14} />
                    ) : event.status === 'failed' ? (
                      <AlertTriangle size={14} />
                    ) : (
                      <Clock size={14} />
                    )}
                  </div>
                  <div className="flex-1 pb-4">
                    <div className="bg-gray-50 rounded-lg border border-gray-100 p-3">
                      <div className="flex items-center justify-between mb-0.5">
                        <p className="text-sm font-medium text-gray-900">
                          {event.eventType.replace(/_/g, ' ')}
                        </p>
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            event.status === 'success'
                              ? 'text-green-700 bg-green-50'
                              : event.status === 'failed'
                                ? 'text-red-700 bg-red-50'
                                : 'text-gray-600 bg-gray-100'
                          }`}
                        >
                          {event.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                        <span className="flex items-center gap-1">
                          {sourceIcons[event.source] || <CreditCard size={11} />}
                          {event.source}
                        </span>
                        <span>{formatDate(event.eventTime)}</span>
                        {event.amountCents != null && (
                          <span className="font-semibold text-gray-700">
                            {formatCents(event.amountCents, event.currency || 'USD')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
