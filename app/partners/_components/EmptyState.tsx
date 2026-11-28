import type { ReactNode } from "react";
import { TEXT, TEXT_MUTED, cx } from "./ui";

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  /** What exists today / why there is nothing to show. */
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
};

export function EmptyState({ icon, title, children, action, className, compact }: EmptyStateProps) {
  return (
    <div className={cx("flex flex-col items-center text-center", compact ? "px-4 py-8" : "px-4 py-12", className)}>
      {icon ? (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#F2F4F2] text-[#56615A] dark:bg-slate-800 dark:text-slate-400">
          {icon}
        </div>
      ) : null}
      <h3 className={cx("text-[15px] font-semibold", TEXT)}>{title}</h3>
      {children ? <div className={cx("mt-1 max-w-md text-sm leading-6", TEXT_MUTED)}>{children}</div> : null}
      {action ? <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}
