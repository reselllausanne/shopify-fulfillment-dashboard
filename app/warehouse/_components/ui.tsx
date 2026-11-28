"use client";

import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { errorMessage, isWhError } from "../_lib/api";
import type { Tone } from "../_lib/format";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ───────────── surfaces ─────────────

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  flush,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** No inner padding (tables). */
  flush?: boolean;
}) {
  return (
    <section className={cx("rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900", className)}>
      {title || actions ? (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

const CHIP_TONES: Record<Tone, string> = {
  green: "border-[#BDEFCB] bg-[#E6F9EB] text-[#0A7A2C] dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  amber: "border-[#FBEBC8] bg-[#FEF9E9] text-[#8A5A00] dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  red: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300",
  slate: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  blue: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300",
};

export function Chip({ tone = "slate", children, title, className }: { tone?: Tone; children: ReactNode; title?: string; className?: string }) {
  return (
    <span
      title={title}
      className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium", CHIP_TONES[tone], className)}
    >
      {children}
    </span>
  );
}

export function KpiTile({ label, value, sub, tone, href }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; href?: string }) {
  const accent =
    tone === "red"
      ? "text-red-600 dark:text-red-400"
      : tone === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "green"
          ? "text-[#0A9A34] dark:text-emerald-400"
          : "text-slate-900 dark:text-slate-100";
  const body = (
    <>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className={cx("mt-1 text-2xl font-semibold tabular-nums", accent)}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</div> : null}
    </>
  );
  const cls = "block rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900";
  return href ? (
    <a href={href} className={cx(cls, "transition hover:border-slate-300 dark:hover:border-slate-700")}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// ───────────── controls ─────────────

type BtnVariant = "primary" | "secondary" | "danger" | "ghost" | "warn";
type BtnSize = "sm" | "md" | "lg" | "xl";

const BTN_VARIANTS: Record<BtnVariant, string> = {
  primary: "bg-[#02C73A] text-slate-950 hover:bg-[#02B334] border border-[#02B334]",
  secondary:
    "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800",
  danger: "border border-red-600 bg-red-600 text-white hover:bg-red-700",
  warn: "border border-amber-400 bg-amber-400 text-slate-950 hover:bg-amber-500",
  ghost: "border border-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
};
const BTN_SIZES: Record<BtnSize, string> = {
  sm: "min-h-[36px] px-3 text-xs",
  md: "min-h-[44px] px-4 text-sm",
  lg: "min-h-[52px] px-5 text-base",
  xl: "min-h-[64px] px-6 text-lg",
};

export function Btn({
  variant = "secondary",
  size = "md",
  busy,
  className,
  children,
  disabled,
  type,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize; busy?: boolean }) {
  return (
    <button
      type={type ?? "button"}
      disabled={disabled || busy}
      className={cx(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#02C73A] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-slate-900",
        BTN_VARIANTS[variant],
        BTN_SIZES[size],
        className
      )}
      {...rest}
    >
      {busy ? <Spinner small /> : null}
      {children}
    </button>
  );
}

export const inputCls =
  "min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#02C73A] focus:outline-none focus:ring-1 focus:ring-[#02C73A] disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block text-sm", className)}>
      <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{hint}</span> : null}
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "inline-flex min-h-[44px] items-center gap-3 rounded-lg border px-3 text-left text-sm font-medium transition disabled:opacity-50",
        checked
          ? "border-[#FBEBC8] bg-[#FEF9E9] text-[#8A5A00] dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
          : "border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
      )}
    >
      <span className={cx("relative h-5 w-9 shrink-0 rounded-full transition", checked ? "bg-amber-500" : "bg-slate-300 dark:bg-slate-600")}>
        <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </span>
      {label}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  size?: "md" | "lg";
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={(e) => {
            onChange(o.value);
            // After a pointer click, give the focus back: on a scan screen the next Enter must
            // confirm the box, not press this option again. Keyboard users keep their focus.
            if (e.detail > 0) e.currentTarget.blur();
          }}
          className={cx(
            "whitespace-nowrap rounded-md px-3 font-medium transition",
            size === "lg" ? "min-h-[48px] text-base" : "min-h-[40px] text-sm",
            value === o.value
              ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-100 dark:ring-slate-600"
              : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number | null; tone?: Tone }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800" role="tablist">
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cx(
              "-mb-px flex min-h-[44px] items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition",
              active
                ? "border-[#02C73A] text-slate-900 dark:text-slate-100"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            )}
          >
            {t.label}
            {t.count !== undefined && t.count !== null ? (
              <span
                className={cx(
                  "rounded-md border px-1.5 py-0.5 text-xs tabular-nums",
                  t.tone && t.count > 0 ? CHIP_TONES[t.tone] : active ? CHIP_TONES.green : CHIP_TONES.slate
                )}
              >
                {t.count.toLocaleString("fr-CH")}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ───────────── feedback ─────────────

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx("inline-block animate-spin rounded-full border-2 border-current border-t-transparent opacity-70", small ? "h-4 w-4" : "h-6 w-6")}
    />
  );
}

export function Loading({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-8 text-sm text-slate-500 dark:text-slate-400">
      <Spinner small /> {label}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-4 py-10 text-center">
      <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</div>
      {children ? <div className="mx-auto mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">{children}</div> : null}
    </div>
  );
}

export function Notice({ tone = "slate", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <div className={cx("rounded-lg border px-3 py-2 text-sm", CHIP_TONES[tone], className)}>{children}</div>;
}

export function ErrorNote({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  if (!error) return null;
  const lost = isWhError(error) && error.fateUnknown;
  return (
    <div role="alert" className={cx("flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm", CHIP_TONES.red, className)}>
      <span>{lost ? "Connexion perdue — les données affichées peuvent être anciennes." : errorMessage(error)}</span>
      {onRetry ? (
        <Btn size="sm" onClick={onRetry}>
          Réessayer
        </Btn>
      ) : null}
    </div>
  );
}

// ───────────── overlays ─────────────

function useOverlay(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);
}

/** Overlays carry `data-wh-overlay`: scan inputs do not steal focus while one is open. */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
  tone,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  tone?: "amber" | "red";
}) {
  useOverlay(open, onClose);
  if (!open) return null;
  return (
    <div data-wh-overlay className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div
        className={cx(
          "relative flex max-h-[92vh] w-full flex-col rounded-t-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 sm:rounded-xl",
          wide ? "sm:max-w-3xl" : "sm:max-w-lg"
        )}
      >
        <header
          className={cx(
            "flex items-center justify-between gap-3 rounded-t-xl border-b px-4 py-3",
            tone === "amber"
              ? "border-[#FBEBC8] bg-[#FEF9E9] dark:border-amber-800 dark:bg-amber-950/50"
              : tone === "red"
                ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/50"
                : "border-slate-200 dark:border-slate-800"
          )}
        >
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <div className="overflow-y-auto px-4 py-4">{children}</div>
        {footer ? <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function Drawer({ open, title, onClose, children, footer }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useOverlay(open, onClose);
  if (!open) return null;
  return (
    <div data-wh-overlay className="fixed inset-0 z-[70] flex justify-end bg-slate-950/40" role="dialog" aria-modal="true">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <aside className="relative flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="min-w-0 text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer ? <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">{footer}</footer> : null}
      </aside>
    </div>
  );
}

// ───────────── data bits ─────────────

export function Thumb({ src, size = 48, alt = "" }: { src: string | null | undefined; size?: number; alt?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  const style = { width: size, height: size };
  if (!src || broken) {
    return (
      <span
        style={style}
        className="flex shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-600"
        aria-hidden
      >
        <svg viewBox="0 0 24 24" className="h-1/2 w-1/2" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5c2.5 0 4-1 5.5-3l2 1.5c1.5 1 3 1.5 5 1.5h3.5a2 2 0 0 1 2 2V19H3v-2.5Z" />
        </svg>
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setBroken(true)}
      style={style}
      className="shrink-0 rounded-md border border-slate-200 bg-white object-contain dark:border-slate-700"
    />
  );
}

/** Mono short reference; the button copies the FULL label code. */
export function CopyRef({ shortRef, labelCode, large }: { shortRef: string; labelCode: string; large?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(labelCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Code de l'étiquette :", labelCode);
    }
  }, [labelCode]);
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cx("font-mono font-medium tabular-nums text-[#0A7A2C] dark:text-emerald-400", large ? "text-lg" : "text-sm")}>{shortRef}</span>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void copy();
        }}
        title={`Copier le code complet : ${labelCode}`}
        aria-label="Copier le code complet de l'étiquette"
        className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        {copied ? (
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#02C73A]" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 5 5 9-10" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path strokeLinecap="round" d="M5 15V6a2 2 0 0 1 2-2h9" />
          </svg>
        )}
      </button>
    </span>
  );
}

/** Occupied (solid) + reserved (hatched light) over capacity. */
export function OccupancyBar({ occupied, reserved, capacity, className }: { occupied: number; reserved: number; capacity: number | null; className?: string }) {
  const cap = capacity && capacity > 0 ? capacity : null;
  const occPct = cap ? Math.min(100, (occupied / cap) * 100) : occupied > 0 ? 100 : 0;
  const resPct = cap ? Math.min(100 - occPct, (reserved / cap) * 100) : 0;
  const over = cap !== null && occupied + reserved > cap;
  return (
    <div className={cx("h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800", className)} title={cap ? `${occupied} occupées, ${reserved} réservées sur ${cap}` : `${occupied} paires`}>
      <div className="flex h-full">
        <div style={{ width: `${occPct}%` }} className={over ? "bg-red-500" : "bg-[#02C73A]"} />
        <div style={{ width: `${resPct}%` }} className="bg-amber-300 dark:bg-amber-500/70" />
      </div>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cx("whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400", className)}>{children}</th>;
}
export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cx("px-3 py-2 align-middle text-sm text-slate-800 dark:text-slate-200", className)}>
      {children}
    </td>
  );
}
export const tableCls = "w-full border-collapse text-sm";
export const theadCls = "border-b border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900";
export const rowCls = "border-b border-slate-100 last:border-0 dark:border-slate-800";

export function DefList({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
          <dd className="min-w-0 break-words text-slate-900 dark:text-slate-100">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
