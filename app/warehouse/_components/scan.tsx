"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { errorMessage, isWhError } from "../_lib/api";
import { useWarehouse } from "../_lib/context";
import { fmtTime } from "../_lib/format";
import { cx } from "./ui";

// ───────────── sound ─────────────

export type ScanTone = "ok" | "warn" | "error" | "info";

let audioCtx: AudioContext | null = null;

function tone(ctx: AudioContext, freq: number, start: number, duration: number, type: OscillatorType, gain = 0.12) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.02);
}

/** Short distinct tones: ok = one high note, warn = two mid notes, error = long low buzz. */
export function beep(kind: ScanTone): void {
  if (typeof window === "undefined" || kind === "info") return;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioCtx = audioCtx ?? new Ctor();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    if (kind === "ok") tone(audioCtx, 1046, 0, 0.11, "sine");
    else if (kind === "warn") {
      tone(audioCtx, 587, 0, 0.12, "triangle", 0.16);
      tone(audioCtx, 587, 0.18, 0.12, "triangle", 0.16);
    } else {
      tone(audioCtx, 165, 0, 0.42, "square", 0.14);
    }
  } catch {
    /* audio is a comfort, never a blocker */
  }
}

// ───────────── flow ─────────────

export type ScanFeedback = { tone: ScanTone; message: string; detail?: ReactNode; at: number };

const DOUBLE_READ_MS = 500;

/** Scanner transport noise only: control characters, surrounding spaces. The code itself is untouched. */
export function cleanScan(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return String(raw ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

/**
 * One scan at a time. While a request is in flight nothing is buffered; an identical code
 * arriving within 500 ms (double read) is ignored. Every outcome goes through `notify`
 * (banner + beep). An exception thrown by the handler becomes a red banner.
 */
export function useScanFlow(handler: (code: string) => Promise<void>) {
  const { muted } = useWarehouse();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
  const busyRef = useRef(false);
  const lastRef = useRef<{ code: string; at: number } | null>(null);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const notify = useCallback((kind: ScanTone, message: string, detail?: ReactNode) => {
    setFeedback({ tone: kind, message, detail, at: Date.now() });
    if (!mutedRef.current) beep(kind);
  }, []);

  const notifyError = useCallback(
    (err: unknown, readOnlyAction = true) => {
      if (isWhError(err) && err.fateUnknown) {
        notify("error", readOnlyAction ? "Connexion perdue — rien n'a été enregistré." : "Connexion perdue — le résultat de l'action est inconnu.");
      } else notify("error", errorMessage(err));
    },
    [notify]
  );

  /** Run any action under the same lock as scans (buttons included). Returns false when busy. */
  const run = useCallback(
    async (fn: () => Promise<void>): Promise<boolean> => {
      if (busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      try {
        await fn();
      } catch (err) {
        notifyError(err);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
      return true;
    },
    [notifyError]
  );

  const submit = useCallback(
    (raw: string) => {
      const code = cleanScan(raw);
      if (!code) return;
      const now = Date.now();
      const last = lastRef.current;
      if (last && last.code === code && now - last.at < DOUBLE_READ_MS) return;
      if (busyRef.current) return;
      lastRef.current = { code, at: now };
      void run(() => handlerRef.current(code));
    },
    [run]
  );

  const clearFeedback = useCallback(() => setFeedback(null), []);

  return { busy, feedback, notify, notifyError, clearFeedback, submit, run };
}

export type ScanFlow = ReturnType<typeof useScanFlow>;

// ───────────── banner ─────────────

const BANNER: Record<ScanTone, string> = {
  ok: "border-[#02B334] bg-[#02C73A] text-slate-950",
  warn: "border-amber-500 bg-amber-400 text-slate-950",
  error: "border-red-700 bg-red-600 text-white",
  info: "border-slate-300 bg-slate-100 text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100",
};
const BANNER_LABEL: Record<ScanTone, string> = { ok: "OK", warn: "À confirmer", error: "Refusé", info: "Info" };

export function FeedbackBanner({ feedback, children }: { feedback: ScanFeedback | null; children?: ReactNode }) {
  if (!feedback) {
    return <div className="min-h-[64px] rounded-lg border border-dashed border-slate-200 dark:border-slate-800" aria-hidden />;
  }
  return (
    <div key={feedback.at} role="status" aria-live="assertive" className={cx("min-h-[64px] w-full rounded-lg border-2 px-4 py-3", BANNER[feedback.tone])}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-wide opacity-80">{BANNER_LABEL[feedback.tone]}</div>
          <div className="text-lg font-semibold leading-snug md:text-xl">{feedback.message}</div>
          {feedback.detail ? <div className="mt-1 text-sm font-medium">{feedback.detail}</div> : null}
        </div>
        <div className="text-xs tabular-nums opacity-80">{fmtTime(feedback.at)}</div>
      </div>
      {children ? <div className="mt-2 flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}

// ───────────── input ─────────────

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
}
function overlayOpen(): boolean {
  return Boolean(document.querySelector("[data-wh-overlay]"));
}

/**
 * The scanner is a keyboard wedge (characters, then Enter). One large input that takes the
 * focus back after every action, on window focus, and as soon as a key is typed while a
 * button has the focus. `onEmptyEnter` lets Enter confirm a pending step.
 */
export function ScanInput({
  prompt,
  hint,
  busy,
  disabled,
  onScan,
  onEmptyEnter,
  onEscape,
  placeholder = "Code scanné",
  right,
}: {
  /** What must be scanned next, in big letters. */
  prompt: string;
  hint?: ReactNode;
  busy: boolean;
  disabled?: boolean;
  onScan: (code: string) => void;
  onEmptyEnter?: () => void;
  onEscape?: () => void;
  placeholder?: string;
  right?: ReactNode;
}) {
  const { muted, setMuted } = useWarehouse();
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [softKeyboard, setSoftKeyboard] = useState(true);
  const emptyEnterRef = useRef(onEmptyEnter);
  emptyEnterRef.current = onEmptyEnter;
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  const focus = useCallback(() => {
    if (overlayOpen()) return;
    const active = document.activeElement;
    if (active !== ref.current && isEditable(active)) return;
    ref.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    // A touch device with a hardware scanner: keep the on-screen keyboard closed by default.
    if (window.matchMedia?.("(pointer: coarse)").matches) setSoftKeyboard(false);
  }, []);

  useEffect(() => {
    focus();
    const onWindowFocus = () => focus();
    const onKey = (e: KeyboardEvent) => {
      if (overlayOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
      const active = document.activeElement;
      if (active === ref.current || isEditable(active)) return;
      if (e.key.length === 1) {
        // First character of a scan while a button (or nothing) has the focus: route it here.
        ref.current?.focus({ preventScroll: true });
      } else if (e.key === "Enter" && (!active || active === document.body)) {
        e.preventDefault();
        emptyEnterRef.current?.();
      } else if (e.key === "Escape") {
        escapeRef.current?.();
      }
    };
    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [focus]);

  // Back to the scan field after every action.
  useEffect(() => {
    if (!busy) focus();
  }, [busy, focus]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div className="text-2xl font-semibold leading-tight tracking-tight text-slate-900 dark:text-slate-100 md:text-3xl">{prompt}</div>
        <div className="flex items-center gap-1">
          {right}
          <button
            type="button"
            onClick={() => {
              setSoftKeyboard((v) => !v);
              ref.current?.focus();
            }}
            title={softKeyboard ? "Masquer le clavier à l'écran" : "Saisir au clavier"}
            aria-pressed={softKeyboard}
            className="flex h-11 items-center gap-1 rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="2.5" y="6" width="19" height="12" rx="2" />
              <path strokeLinecap="round" d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
            </svg>
            Clavier
          </button>
          <button
            type="button"
            onClick={() => setMuted(!muted)}
            aria-pressed={muted}
            title={muted ? "Réactiver le son" : "Couper le son"}
            className="flex h-11 items-center gap-1 rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4Z" />
              {muted ? <path strokeLinecap="round" d="m16 9 5 6M21 9l-5 6" /> : <path strokeLinecap="round" d="M16 9a4.5 4.5 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />}
            </svg>
            {muted ? "Son coupé" : "Son"}
          </button>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const code = cleanScan(value);
          if (!code) {
            if (!busy) emptyEnterRef.current?.();
            return;
          }
          // While a request is in flight nothing is buffered: the scan is dropped, visibly.
          setValue("");
          if (!busy && !disabled) onScan(code);
        }}
      >
        <div className="relative">
          <input
            ref={ref}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (value) setValue("");
                else escapeRef.current?.();
              }
            }}
            inputMode={softKeyboard ? "text" : "none"}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="send"
            aria-label={prompt}
            placeholder={busy ? "Traitement…" : placeholder}
            className={cx(
              "h-16 w-full rounded-lg border-2 bg-white px-4 font-mono text-xl text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:outline-none dark:bg-slate-900 dark:text-slate-100 md:text-2xl",
              busy ? "border-amber-400" : "border-slate-300 focus:border-[#02C73A] dark:border-slate-600"
            )}
          />
          {busy ? (
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 rounded-md bg-amber-400 px-2 py-1 text-sm font-semibold text-slate-950">Traitement…</span>
          ) : null}
        </div>
      </form>
      {hint ? <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">{hint}</div> : null}
    </div>
  );
}
