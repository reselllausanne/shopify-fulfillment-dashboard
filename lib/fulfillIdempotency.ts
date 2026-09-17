/**
 * Process-local fulfill idempotency — blocks double label / double fulfill
 * from rescan, refresh, or double-click within the TTL window.
 */

type Entry = { expiresAt: number; result: unknown };

const globalKey = "__resell_fulfill_idempotency_v1";

function store(): Map<string, Entry> {
  const g = globalThis as typeof globalThis & { [globalKey]?: Map<string, Entry> };
  if (!g[globalKey]) g[globalKey] = new Map();
  return g[globalKey]!;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export function getFulfillIdempotentResult(key: string): unknown | null {
  const k = String(key ?? "").trim();
  if (!k) return null;
  const entry = store().get(k);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store().delete(k);
    return null;
  }
  return entry.result;
}

export function setFulfillIdempotentResult(
  key: string,
  result: unknown,
  ttlMs: number = DEFAULT_TTL_MS
): void {
  const k = String(key ?? "").trim();
  if (!k) return;
  store().set(k, { expiresAt: Date.now() + ttlMs, result });
}
