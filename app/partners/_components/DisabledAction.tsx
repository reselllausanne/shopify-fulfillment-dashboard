"use client";

import { useId, type ReactNode } from "react";
import { LockIcon } from "./icons";
import { TEXT_MUTED, cx } from "./ui";

type DisabledActionProps = {
  label: string;
  /** One functional sentence: why the action is unavailable and what to do instead. */
  reason: string;
  icon?: ReactNode;
  className?: string;
  /** `inline`: reason on the right of the button; `stack`: reason below. */
  layout?: "inline" | "stack";
};

/**
 * An action that does not exist yet. It stays visible, clearly greyed, and always says why.
 * The button keeps the focus (aria-disabled) so that a keyboard or screen-reader user reaches
 * the reason too.
 */
export function DisabledAction({ label, reason, icon, className, layout = "stack" }: DisabledActionProps) {
  const reasonId = useId();
  return (
    <div className={cx(layout === "inline" ? "flex flex-wrap items-center gap-x-3 gap-y-1.5" : "space-y-1.5", className)}>
      <button
        type="button"
        aria-disabled="true"
        aria-describedby={reasonId}
        onClick={(event) => event.preventDefault()}
        className="inline-flex min-h-[40px] cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-dashed border-[#D9DDD9] bg-[#F2F4F2] px-4 py-2 text-sm font-medium text-[#6B766E] focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6B766E] dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400"
      >
        {icon ?? <LockIcon size={16} />}
        {label}
      </button>
      <p id={reasonId} className={cx("text-xs leading-5", TEXT_MUTED)}>
        {reason}
      </p>
    </div>
  );
}

type DisabledSwitchProps = {
  /** Accessible name, e.g. "Publication sur Galaxus". */
  label: string;
  reasonId: string;
};

/** A switch that is off and cannot be turned on (the row carries the reason). */
export function DisabledSwitch({ label, reasonId }: DisabledSwitchProps) {
  return (
    <span
      role="switch"
      aria-checked="false"
      aria-disabled="true"
      aria-label={label}
      aria-describedby={reasonId}
      tabIndex={0}
      className="relative inline-flex h-5 w-9 shrink-0 cursor-not-allowed items-center rounded-full border border-dashed border-[#C9CFCA] bg-[#EEF0EE] focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6B766E] dark:border-slate-600 dark:bg-slate-800"
    >
      <span className="ml-0.5 h-3.5 w-3.5 rounded-full bg-[#B4BBB6] dark:bg-slate-600" />
    </span>
  );
}
