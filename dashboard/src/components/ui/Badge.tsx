import clsx from 'clsx';

interface BadgeProps {
  variant?: 'critical' | 'warning' | 'info' | 'success' | 'neutral' | 'open' | 'acknowledged' | 'resolved' | 'dismissed' | 'slate' | 'violet' | 'amber' | 'emerald';
  size?: 'sm' | 'md';
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  info: 'bg-blue-50 text-blue-700 border-blue-200',
  success: 'bg-green-50 text-green-700 border-green-200',
  neutral: 'bg-gray-100 text-gray-600 border-gray-200',
  open: 'bg-red-50 text-red-700 border-red-200',
  acknowledged: 'bg-amber-50 text-amber-700 border-amber-200',
  resolved: 'bg-green-50 text-green-700 border-green-200',
  dismissed: 'bg-gray-100 text-gray-500 border-gray-200',
  // Category color variants
  slate: 'bg-slate-50 text-slate-700 border-slate-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const dotStyles: Record<string, string> = {
  critical: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-blue-500',
  success: 'bg-green-500',
  neutral: 'bg-gray-400',
  open: 'bg-red-500',
  acknowledged: 'bg-amber-500',
  resolved: 'bg-green-500',
  dismissed: 'bg-gray-400',
  // Category color variants
  slate: 'bg-slate-500',
  violet: 'bg-violet-500',
  amber: 'bg-amber-500',
  emerald: 'bg-emerald-500',
};

export function Badge({ variant = 'neutral', size = 'sm', dot, children, className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 font-medium border rounded-full',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
        variantStyles[variant],
        className,
      )}
    >
      {dot && (
        <span className={clsx('w-1.5 h-1.5 rounded-full', dotStyles[variant])} />
      )}
      {children}
    </span>
  );
}
