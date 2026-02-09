import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { fetcher } from '../lib/api';
import { formatDate, timeAgo, stateColor } from '../lib/format';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { SkeletonRow } from '../components/ui/Skeleton';
import {
  Users,
  Search,
  ExternalLink,
  AlertTriangle,
  CreditCard,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface UserSummary {
  id: string;
  email: string | null;
  externalUserId: string | null;
  createdAt: string;
  entitlementCount?: number;
  openIssueCount?: number;
}

interface UsersResponse {
  users: UserSummary[];
  pagination: { limit: number; offset: number; count: number };
}

const PAGE_SIZE = 25;

export function UsersPage() {
  useEffect(() => { document.title = 'Users - RevBack'; }, []);

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
  });
  if (search) params.set('search', search);

  const { data, isLoading, error, mutate } = useSWR<UsersResponse>(
    `/users?${params}`,
    fetcher,
    { refreshInterval: 30000 },
  );

  const totalPages = data ? Math.ceil(data.pagination.count / PAGE_SIZE) : 0;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Users"
        subtitle={`${data?.pagination.count ?? 0} tracked subscribers`}
      />

      {/* Search bar */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search by email, user ID, or external ID..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-shadow bg-white"
          />
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}
        </div>
      )}

      {/* Error */}
      {error && <ErrorState message="Failed to load users" onRetry={() => mutate()} />}

      {/* Empty state */}
      {!isLoading && !error && (!data?.users || data.users.length === 0) && (
        <Card>
          <EmptyState
            icon={Users}
            title={search ? 'No users found' : 'No users tracked yet'}
            description={
              search
                ? 'Try a different search term or clear the filter'
                : 'Users will appear here once billing events are processed'
            }
          />
        </Card>
      )}

      {/* User List */}
      {!isLoading && !error && data?.users && data.users.length > 0 && (
        <>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">User</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Email</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Created</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Issues</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.users.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center text-xs font-bold text-gray-600">
                            {(user.email || user.externalUserId || user.id)[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {user.externalUserId || user.id.slice(0, 12)}
                            </p>
                            <p className="text-[10px] text-gray-400 font-mono">{user.id.slice(0, 8)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {user.email ? (
                          <span className="text-sm text-gray-700">{user.email}</span>
                        ) : (
                          <span className="text-xs text-gray-300">--</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-xs text-gray-500">{timeAgo(user.createdAt)}</span>
                      </td>
                      <td className="py-3 px-4">
                        {(user.openIssueCount || 0) > 0 ? (
                          <Badge variant="critical" dot size="sm">
                            {user.openIssueCount} open
                          </Badge>
                        ) : (
                          <Badge variant="success" size="sm">Clear</Badge>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <Link
                          to={`/users/${user.id}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 transition-colors"
                        >
                          View <ExternalLink size={11} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6">
              <p className="text-sm text-gray-500">
                Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, data.pagination.count)} of {data.pagination.count}
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
