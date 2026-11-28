"use client";

import type { ReactNode } from "react";
import { formatCount } from "../_lib/format";
import { FOCUS, HAIRLINE, TEXT, TEXT_MUTED, cx } from "./ui";

// Horizontal rows scroll by touch; the scrollbar itself would only add noise under the tabs.
const NO_SCROLLBAR = "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

export type TabItem<T extends string> = {
  value: T;
  label: string;
  /** Shown in brackets after the label. `null` = not known (nothing is shown). */
  count?: number | string | null;
};

type TabsProps<T extends string> = {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
  /** On small screens the tab row scrolls edge to edge (default). Turn off inside a card. */
  bleed?: boolean;
};

function countText(count: number | string | null | undefined): string | null {
  if (count === null || count === undefined) return null;
  return typeof count === "number" ? formatCount(count) : count;
}

/** Underlined tabs with counts. They filter the list below (buttons with `aria-pressed`). */
export function Tabs<T extends string>({ items, value, onChange, label, className, bleed = true }: TabsProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx("flex gap-1 overflow-x-auto border-b", NO_SCROLLBAR, bleed && "-mx-4 px-4 sm:mx-0 sm:px-0", HAIRLINE, className)}
    >
      {items.map((item) => {
        const active = item.value === value;
        const count = countText(item.count);
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.value)}
            className={cx(
              "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors",
              FOCUS,
              active
                ? "border-[#02C73A] font-semibold text-[#017723] dark:text-[#5BE584]"
                : cx("border-transparent hover:border-[#D9DDD9] dark:hover:border-slate-600", TEXT_MUTED)
            )}
          >
            {item.label}
            {count !== null ? <span className="ml-1 tabular-nums">({count})</span> : null}
          </button>
        );
      })}
    </div>
  );
}

type FilterChipsProps<T extends string> = {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
};

/** Quick-filter chips (single choice). */
export function FilterChips<T extends string>({ items, value, onChange, label, className }: FilterChipsProps<T>) {
  return (
    <div role="group" aria-label={label} className={cx("-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0", NO_SCROLLBAR, className)}>
      {items.map((item) => {
        const active = item.value === value;
        const count = countText(item.count);
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.value)}
            className={cx(
              "shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-[13px] leading-5 transition-colors",
              FOCUS,
              active
                ? "border-[#BDEFCB] bg-[#E6F9EB] font-medium text-[#017723] dark:border-[#02C73A]/40 dark:bg-[#02C73A]/10 dark:text-[#5BE584]"
                : cx("border-[#E7E9E7] bg-white hover:border-[#BFC6C0] dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600", TEXT_MUTED)
            )}
          >
            {item.label}
            {count !== null ? <span className="ml-1.5 tabular-nums opacity-80">{count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

type SegmentedProps<T extends string> = {
  items: { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
};

/** Two-state view switch ("Liste simple / Groupé par modèle"). */
export function Segmented<T extends string>({ items, value, onChange, label, className }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className={cx("inline-flex rounded-lg border p-0.5", HAIRLINE, "bg-[#F2F4F2] dark:bg-slate-800/60", className)}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.value)}
            className={cx(
              "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] transition-colors",
              FOCUS,
              active ? cx("bg-white font-semibold shadow-[0_0_0_1px_#E7E9E7] dark:bg-slate-900 dark:shadow-[0_0_0_1px_#334155]", TEXT) : TEXT_MUTED
            )}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
