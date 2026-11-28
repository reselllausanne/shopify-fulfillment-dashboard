"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Load data, keep the previous value while refreshing, optionally poll. Stale answers of an
 * older call are dropped. `enabled:false` clears nothing and loads nothing.
 */
export function useLoad<T>(
  loader: () => Promise<T>,
  deps: unknown[],
  opts: { intervalMs?: number; enabled?: boolean } = {}
): { data: T | null; error: unknown; loading: boolean; reload: () => Promise<void>; setData: (v: T | null) => void } {
  const enabled = opts.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(enabled);
  const seq = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const value = await loaderRef.current();
      if (mine !== seq.current) return;
      setData(value);
      setError(null);
    } catch (err) {
      if (mine !== seq.current) return;
      setError(err);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      seq.current += 1;
      setLoading(false);
      return;
    }
    void reload();
    if (!opts.intervalMs) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, opts.intervalMs);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, opts.intervalMs, reload, ...deps]);

  return { data, error, loading, reload, setData };
}

/**
 * A physical gesture in flight: its opKey and exact body, kept in state AND in sessionStorage
 * so a reload (or a lost answer) resumes with the SAME key. Cleared on a definitive answer.
 */
export type PendingGesture<B = Record<string, unknown>> = {
  opKey: string;
  path: string;
  body: B;
  /** Free context shown to the operator when resuming ("Nike Dunk 42 sur A-01-02-3"). */
  label: string;
  startedAt: number;
  extra?: Record<string, unknown>;
};

export function usePendingGesture<B = Record<string, unknown>>(storageKey: string | null) {
  const [pending, setPendingState] = useState<PendingGesture<B> | null>(null);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    setRestored(false);
    if (!storageKey) {
      setPendingState(null);
      return;
    }
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      const parsed = raw ? (JSON.parse(raw) as PendingGesture<B>) : null;
      if (parsed && parsed.opKey && parsed.path) {
        setPendingState(parsed);
        setRestored(true);
      } else setPendingState(null);
    } catch {
      setPendingState(null);
    }
  }, [storageKey]);

  const setPending = useCallback(
    (next: PendingGesture<B> | null) => {
      setPendingState(next);
      setRestored(false);
      if (!storageKey) return;
      try {
        if (next) window.sessionStorage.setItem(storageKey, JSON.stringify(next));
        else window.sessionStorage.removeItem(storageKey);
      } catch {
        /* storage full or blocked: state still holds the key */
      }
    },
    [storageKey]
  );

  return { pending, setPending, restored };
}

export function useLocalFlag(key: string, initial = false): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(raw === "1");
    } catch {
      /* ignore */
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === key && e.newValue !== null) setValue(e.newValue === "1");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);
  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      try {
        window.localStorage.setItem(key, v ? "1" : "0");
      } catch {
        /* ignore */
      }
    },
    [key]
  );
  return [value, set];
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
