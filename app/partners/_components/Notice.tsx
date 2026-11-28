import type { ReactNode } from "react";
import { AlertIcon, CheckIcon, InfoIcon } from "./icons";
import { cx } from "./ui";

type NoticeTone = "info" | "success" | "warning" | "error";

const TONES: Record<NoticeTone, string> = {
  info: "border-[#E7E9E7] bg-white text-[#3D473F] dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
  success: "border-[#BDEFCB] bg-[#E6F9EB] text-[#015C1B] dark:border-[#02C73A]/30 dark:bg-[#02C73A]/10 dark:text-[#8BEFA8]",
  warning: "border-[#FBEBC8] bg-[#FEF9E9] text-[#6F4A00] dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200",
  // Red is reserved for errors.
  error: "border-[#F8C7C7] bg-[#FFF5F5] text-[#B80000] dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200",
};

type NoticeProps = {
  tone?: NoticeTone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
};

/** Inline message. Errors are announced immediately, other tones politely. */
export function Notice({ tone = "info", title, children, action, className }: NoticeProps) {
  const Icon = tone === "error" || tone === "warning" ? AlertIcon : tone === "success" ? CheckIcon : InfoIcon;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx("flex items-start gap-3 rounded-lg border px-4 py-3 text-sm leading-6", TONES[tone], className)}
    >
      <Icon size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title ? <div className="font-semibold">{title}</div> : null}
        {children ? <div>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
