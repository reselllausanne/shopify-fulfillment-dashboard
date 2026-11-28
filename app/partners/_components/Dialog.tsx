"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { CloseIcon } from "./icons";
import { FOCUS, HAIRLINE, TEXT, TEXT_MUTED, cx } from "./ui";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** `center`: modal card; `sheet`: panel attached to the bottom of the screen (mobile menu). */
  variant?: "center" | "sheet";
};

/**
 * Modal built on the native <dialog>: focus is trapped and restored by the browser, Escape
 * closes, a click on the backdrop closes.
 */
export function Dialog({ open, onClose, title, description, children, variant = "center" }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      // Named by aria-label (not a generated id): the closed dialog is part of the server-rendered shell.
      aria-label={title}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cx(
        "w-full border p-0 text-left backdrop:bg-[#0B120D]/45 dark:backdrop:bg-black/60",
        "bg-white text-[#141A16] dark:bg-slate-900 dark:text-slate-100",
        HAIRLINE,
        // Margins are forced: a parent `space-y-*` must not move the modal.
        variant === "sheet"
          ? "!mx-0 !mb-0 !mt-auto max-h-[85vh] max-w-full rounded-t-2xl border-x-0 border-b-0"
          : "!m-auto max-h-[90vh] max-w-[calc(100%-2rem)] rounded-xl sm:max-w-xl"
      )}
    >
      {open ? (
        <div className="flex max-h-[inherit] flex-col">
          <div className={cx("flex items-start justify-between gap-3 border-b px-5 py-4", HAIRLINE)}>
            <div className="min-w-0">
              <h2 className={cx("text-base font-semibold", TEXT)}>
                {title}
              </h2>
              {description ? <p className={cx("mt-0.5 text-sm", TEXT_MUTED)}>{description}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              className={cx(
                "-mr-1.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-[#F2F4F2] dark:hover:bg-slate-800",
                TEXT_MUTED,
                FOCUS
              )}
            >
              <CloseIcon size={18} />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}
