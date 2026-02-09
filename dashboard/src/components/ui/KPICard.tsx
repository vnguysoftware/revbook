import clsx from 'clsx';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface KPICardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel: string;
  variant: 'danger' | 'success' | 'neutral' | 'warning';
  trend?: {
    direction: 'up' | 'down' | 'flat';
    value: string;
    positive?: boolean; // is this trend direction good?
  };
}

export function KPICard({ icon, label, value, sublabel, variant, trend }: KPICardProps) {
  const borderColor = {
    danger: 'border-l-red-500',
    success: 'border-l-green-500',
    neutral: 'border-l-gray-400',
    warning: 'border-l-amber-500',
  }[variant];

  const bgGradient = {
    danger: 'from-red-50/50 to-white',
    success: 'from-green-50/50 to-white',
    neutral: 'from-gray-50/50 to-white',
    warning: 'from-amber-50/50 to-white',
  }[variant];

  return (
    <div
      className={clsx(
        'bg-gradient-to-br rounded-lg border border-gray-200 border-l-4 p-5',
        borderColor,
        bgGradient,
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-white shadow-sm border border-gray-100">
            {icon}
          </div>
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</span>
        </div>
        {trend && (
          <TrendBadge {...trend} />
        )}
      </div>
      <p className="text-3xl font-bold text-gray-900 tracking-tight">{value}</p>
      <p className="text-xs text-gray-500 mt-1.5">{sublabel}</p>
    </div>
  );
}

function TrendBadge({ direction, value, positive }: { direction: 'up' | 'down' | 'flat'; value: string; positive?: boolean }) {
  const isGood = positive !== undefined ? positive : direction === 'up';
  const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus;

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded',
        isGood
          ? 'text-green-700 bg-green-50'
          : 'text-red-700 bg-red-50',
        direction === 'flat' && 'text-gray-500 bg-gray-50',
      )}
    >
      <Icon size={12} />
      {value}
    </span>
  );
}
