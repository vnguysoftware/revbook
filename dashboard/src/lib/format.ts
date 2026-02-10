import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

export function formatCents(cents: number | null | undefined, currency = 'USD'): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

export function timeAgo(date: string | Date): string {
  return dayjs(date).fromNow();
}

export function formatDate(date: string | Date): string {
  return dayjs(date).format('MMM D, YYYY h:mm A');
}

export function severityColor(severity: string): string {
  switch (severity) {
    case 'critical': return 'text-red-700 bg-red-50 border-red-200';
    case 'warning': return 'text-amber-700 bg-amber-50 border-amber-200';
    case 'info': return 'text-blue-700 bg-blue-50 border-blue-200';
    default: return 'text-gray-700 bg-gray-50 border-gray-200';
  }
}

export function severityDot(severity: string): string {
  switch (severity) {
    case 'critical': return 'bg-red-500';
    case 'warning': return 'bg-amber-500';
    case 'info': return 'bg-blue-500';
    default: return 'bg-gray-400';
  }
}

export function stateColor(state: string): string {
  switch (state) {
    case 'active': case 'trial': return 'text-green-700 bg-green-50';
    case 'grace_period': case 'billing_retry': return 'text-amber-700 bg-amber-50';
    case 'expired': case 'revoked': case 'refunded': return 'text-red-700 bg-red-50';
    case 'paused': case 'on_hold': return 'text-gray-600 bg-gray-100';
    default: return 'text-gray-500 bg-gray-50';
  }
}

export function sourceIcon(source: string): string {
  switch (source) {
    case 'stripe': return '💳';
    case 'apple': return '🍎';
    case 'google': return '🤖';
    case 'recurly': return '🔄';
    default: return '📦';
  }
}
