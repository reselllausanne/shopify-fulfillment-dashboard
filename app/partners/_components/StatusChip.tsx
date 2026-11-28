import type { ReactNode } from "react";
import type { PartnerRequestStatus, PartnerUnitStatus } from "../_lib/api";
import { REQUEST_STATUS, UNIT_STATUS, type Tone } from "../_lib/labels";
import { cx } from "./ui";

// Two-tone chips: tinted background + 1 px border of the same hue, 12 px text.
const TONES: Record<Tone, string> = {
  green: "bg-[#E6F9EB] border-[#BDEFCB] text-[#017723] dark:bg-[#02C73A]/10 dark:border-[#02C73A]/30 dark:text-[#5BE584]",
  amber: "bg-[#FEF9E9] border-[#FBEBC8] text-[#8A5B00] dark:bg-amber-400/10 dark:border-amber-400/30 dark:text-amber-300",
  orange: "bg-[#FFF3EA] border-[#FFD9BD] text-[#9A4300] dark:bg-orange-400/10 dark:border-orange-400/30 dark:text-orange-300",
  blue: "bg-[#EDF5FF] border-[#CFE2FC] text-[#1D4F91] dark:bg-sky-400/10 dark:border-sky-400/30 dark:text-sky-300",
  violet: "bg-[#F3F0FF] border-[#DDD6FE] text-[#5B3FB0] dark:bg-violet-400/10 dark:border-violet-400/30 dark:text-violet-300",
  neutral: "bg-[#F2F4F2] border-[#E1E4E1] text-[#3D473F] dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300",
  red: "bg-[#FDECEC] border-[#F8C7C7] text-[#B80000] dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-300",
};

export function Chip({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium leading-5", TONES[tone], className)}>
      {children}
    </span>
  );
}

/** Status of one pair, in the partner's words. */
export function StatusChip({ status, className }: { status: PartnerUnitStatus | string; className?: string }) {
  const meta = UNIT_STATUS[status as PartnerUnitStatus];
  return (
    <Chip tone={meta?.tone ?? "neutral"} className={className}>
      {meta?.label ?? "Statut à préciser"}
    </Chip>
  );
}

export function RequestStatusChip({ status, className }: { status: PartnerRequestStatus | string; className?: string }) {
  const meta = REQUEST_STATUS[status as PartnerRequestStatus];
  return (
    <Chip tone={meta?.tone ?? "neutral"} className={className}>
      {meta?.label ?? "En cours"}
    </Chip>
  );
}
