import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRightIcon } from "./icons";
import { FOCUS, HAIRLINE, SURFACE, TEXT, TEXT_FAINT, TEXT_MUTED, cx } from "./ui";

type KpiTileProps = {
  label: string;
  /** Big figure. Pass "—" (never a made-up number) when the value does not exist yet. */
  value: ReactNode;
  /** One line under the figure: unit, context or the reason why the value is absent. */
  hint?: ReactNode;
  /** Makes the whole tile a link. */
  href?: string;
  /** Greys the figure: the value does not exist at this stage (the hint says why). */
  unavailable?: boolean;
  loading?: boolean;
  accent?: boolean;
  /** `md` for a value that is a text (a date) rather than a figure. */
  size?: "lg" | "md";
  className?: string;
};

export function KpiTile({ label, value, hint, href, unavailable, loading, accent, size = "lg", className }: KpiTileProps) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className={cx("text-[13px] leading-5", TEXT_MUTED)}>{label}</span>
        {href ? <ChevronRightIcon size={16} className={cx("shrink-0 opacity-60", TEXT_FAINT)} /> : null}
      </div>
      {loading ? (
        <div className="mt-2 h-8 w-20 animate-pulse rounded bg-[#EEF0EE] dark:bg-slate-800" />
      ) : (
        <div
          className={cx(
            "mt-1 font-semibold tracking-tight tabular-nums",
            size === "md" ? "text-xl leading-9" : "text-[28px] leading-9",
            unavailable ? "text-[#8A948D] dark:text-slate-500" : accent ? "text-[#017723] dark:text-[#5BE584]" : TEXT
          )}
        >
          {value}
        </div>
      )}
      {hint ? <div className={cx("mt-1 text-xs leading-5", TEXT_FAINT)}>{hint}</div> : null}
    </>
  );

  const shell = cx("block rounded-lg border p-4", SURFACE, HAIRLINE, className);
  if (href) {
    return (
      <Link href={href} className={cx(shell, "transition-colors hover:border-[#02C73A] dark:hover:border-[#02C73A]/70", FOCUS)}>
        {body}
      </Link>
    );
  }
  return <div className={shell}>{body}</div>;
}
