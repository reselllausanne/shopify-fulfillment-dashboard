"use client";

import { useEffect, useRef } from "react";

/**
 * Soft keep-current: refetch on tab focus/visibility + light poll while visible.
 * Prefer silent DB/list reloads — no full page navigation.
 */
export function useSoftPageRefresh(
  refresh: () => void | Promise<void>,
  options?: { intervalMs?: number; enabled?: boolean }
) {
  const intervalMs = options?.intervalMs ?? 30_000;
  const enabled = options?.enabled !== false;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) return;

    const run = () => {
      void refreshRef.current();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") run();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", run);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") run();
    }, intervalMs);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", run);
      window.clearInterval(timer);
    };
  }, [enabled, intervalMs]);
}
