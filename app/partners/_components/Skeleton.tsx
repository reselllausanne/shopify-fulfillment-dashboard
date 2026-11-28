import { HAIRLINE, SURFACE, cx } from "./ui";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("animate-pulse rounded bg-[#EEF0EE] dark:bg-slate-800", className)} />;
}

/** Placeholder rows of a list while it loads. */
export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Chargement" className={cx("divide-y divide-[#EEF0EE] dark:divide-slate-800", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-11 w-11 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="hidden h-3.5 w-20 sm:block" />
          <Skeleton className="h-3.5 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder of a full page (header + tiles) while the portal learns what the partner can see. */
export function PageSkeleton() {
  return (
    <div role="status" aria-label="Chargement" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={cx("rounded-lg border p-4", SURFACE, HAIRLINE)}>
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="mt-3 h-8 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
