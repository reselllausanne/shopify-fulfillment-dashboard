/**
 * Design tokens of the partner area (light: #F7F8F7 page, white cards, hairline borders, green
 * primary; dark: the slate palette used by the rest of the app). Class strings are complete
 * literals so Tailwind can see them.
 */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export const PAGE_BG = "bg-[#F7F8F7] dark:bg-slate-950";
export const SURFACE = "bg-white dark:bg-slate-900";
export const HAIRLINE = "border-[#E7E9E7] dark:border-slate-800";
export const DIVIDE = "divide-[#EEF0EE] dark:divide-slate-800";

export const TEXT = "text-[#141A16] dark:text-slate-100";
export const TEXT_MUTED = "text-[#56615A] dark:text-slate-400";
export const TEXT_FAINT = "text-[#6B766E] dark:text-slate-400";
export const TEXT_GREEN = "text-[#017723] dark:text-[#5BE584]";

export const FOCUS =
  "focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#017723] dark:focus-visible:outline-[#5BE584]";

export const LINK = cx(
  "font-medium underline decoration-[#02C73A]/50 underline-offset-2 hover:decoration-[#02C73A]",
  TEXT_GREEN,
  FOCUS,
  "rounded-sm"
);

export const INPUT = cx(
  "block w-full rounded-lg border bg-white px-3 py-2 text-sm placeholder:text-[#8A948D]",
  "border-[#D9DDD9] text-[#141A16] hover:border-[#BFC6C0]",
  "focus:border-[#02C73A] focus:outline-none focus:ring-2 focus:ring-[#02C73A]/25",
  "dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600 dark:focus:border-[#02C73A]",
  "disabled:cursor-not-allowed disabled:opacity-60"
);

export const LABEL = cx("block text-sm font-medium", TEXT);
export const HINT = cx("text-xs", TEXT_FAINT);

export const TABLE_HEAD = cx(
  "border-b px-4 py-2.5 text-left text-xs font-medium",
  HAIRLINE,
  TEXT_FAINT,
  "bg-[#FAFBFA] dark:bg-slate-900/60"
);
