"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "./icons";
import { FOCUS, TEXT_GREEN, cx } from "./ui";

type CopyRefProps = {
  /** Short reference of one physical pair, e.g. "8FED-2112". */
  value: string;
  className?: string;
  size?: "sm" | "md";
};

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // falls through to the legacy path
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const done = document.execCommand("copy");
    area.remove();
    return done;
  } catch {
    return false;
  }
}

/** Monospace pair reference with a copy button. */
export function CopyRef({ value, className, size = "sm" }: CopyRefProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    []
  );

  const copy = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const done = await copyText(value);
    setState(done ? "copied" : "failed");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 1800);
  };

  return (
    <span className={cx("inline-flex items-center gap-1 align-middle", className)}>
      <span className={cx("font-mono tabular-nums tracking-tight", size === "md" ? "text-sm" : "text-[13px]", TEXT_GREEN)}>{value}</span>
      <button
        type="button"
        onClick={copy}
        title={state === "copied" ? "Copié" : "Copier la référence"}
        aria-label={`Copier la référence ${value}`}
        className={cx(
          "inline-flex h-7 w-7 items-center justify-center rounded-md text-[#6B766E] transition-colors hover:bg-[#F2F4F2] hover:text-[#141A16] dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100",
          FOCUS
        )}
      >
        {state === "copied" ? <CheckIcon size={15} className="text-[#017723] dark:text-[#5BE584]" /> : <CopyIcon size={15} />}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {state === "copied" ? `Référence ${value} copiée` : state === "failed" ? "Copie impossible" : ""}
      </span>
    </span>
  );
}
