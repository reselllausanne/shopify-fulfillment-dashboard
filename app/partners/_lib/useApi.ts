"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PartnerApiError } from "./api";

export type ApiState<T> = {
  data: T | null;
  error: PartnerApiError | null;
  loading: boolean;
  reload: () => void;
};

function toApiError(err: unknown): PartnerApiError {
  if (err instanceof PartnerApiError) return err;
  return new PartnerApiError("UNKNOWN", "Une erreur inattendue est survenue. Réessayez dans un instant.", 0);
}

/**
 * Loads data when `deps` change. A late answer of an outdated call is ignored. Pass
 * `enabled: false` to wait (for example until the stock module is known to be active).
 */
export function useApi<T>(loader: () => Promise<T>, deps: readonly unknown[], enabled = true): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<PartnerApiError | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  // Declared before the loading effect: it always calls the latest loader.
  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    loaderRef
      .current()
      .then((result) => {
        if (!active) return;
        setData(result);
      })
      .catch((err) => {
        if (!active) return;
        setError(toApiError(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** Returns `value` once it has stopped changing for `delay` ms. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
