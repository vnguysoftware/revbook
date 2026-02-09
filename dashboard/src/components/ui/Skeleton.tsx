import clsx from 'clsx';

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
}

export function Skeleton({ className, style }: SkeletonProps) {
  return (
    <div
      className={clsx(
        'relative overflow-hidden rounded bg-gray-200',
        className,
      )}
      style={style}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <Skeleton className="h-4 w-32 mb-4" />
      <Skeleton className="h-8 w-24 mb-2" />
      <Skeleton className="h-3 w-48" />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 flex items-center gap-4">
      <Skeleton className="h-3 w-3 rounded-full" />
      <div className="flex-1">
        <Skeleton className="h-4 w-48 mb-2" />
        <Skeleton className="h-3 w-72" />
      </div>
      <Skeleton className="h-4 w-16" />
    </div>
  );
}

export function SkeletonKPI() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Skeleton className="h-8 w-8 rounded-md" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-8 w-28 mb-2" />
      <Skeleton className="h-3 w-36" />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex gap-6">
        {[80, 120, 60, 80, 60, 100].map((w, i) => (
          <Skeleton key={i} className="h-3" style={{ width: w }} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-4 py-3 border-b border-gray-50 flex gap-6 items-center">
          {[80, 120, 60, 80, 60, 100].map((w, j) => (
            <Skeleton key={j} className="h-3" style={{ width: w }} />
          ))}
        </div>
      ))}
    </div>
  );
}
