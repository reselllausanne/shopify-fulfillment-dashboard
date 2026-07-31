type CacheEntry<T> = { at: number; value: T };

/** Fresh TTL — served without recompute. Default 15 min. */
const PARTNER_STATS_CACHE_MS = Math.max(
  60_000,
  Number(process.env.PARTNER_STATS_CACHE_MS ?? "900000")
);

/** Stale grace — return cached value while background refresh runs. Default 1 h. */
const PARTNER_STATS_STALE_MS = Math.max(
  PARTNER_STATS_CACHE_MS,
  Number(process.env.PARTNER_STATS_STALE_MS ?? "3600000")
);

export function createPartnerKeyedCache<T>(
  ttlMs = PARTNER_STATS_CACHE_MS,
  staleMaxMs = PARTNER_STATS_STALE_MS
) {
  const store = new Map<string, CacheEntry<T>>();
  const inflight = new Map<string, Promise<T>>();

  return {
    getFresh(key: string): T | null {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() - entry.at >= ttlMs) return null;
      return entry.value;
    },

    getStale(key: string): T | null {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() - entry.at >= staleMaxMs) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },

    set(key: string, value: T) {
      store.set(key, { at: Date.now(), value });
    },

    async revalidate(key: string, loader: () => Promise<T>): Promise<T> {
      const existing = inflight.get(key);
      if (existing) return existing;

      const promise = loader()
        .then((value) => {
          store.set(key, value);
          return value;
        })
        .finally(() => {
          inflight.delete(key);
        });

      inflight.set(key, promise);
      return promise;
    },
  };
}

/** Fresh → stale-while-revalidate → single deduped cold compute. */
export async function getPartnerStatsWithRevalidate<T>(
  cache: ReturnType<typeof createPartnerKeyedCache<T>>,
  key: string,
  loader: () => Promise<T>
): Promise<{ body: T; stale: boolean }> {
  const fresh = cache.getFresh(key);
  if (fresh) return { body: fresh, stale: false };

  const stale = cache.getStale(key);
  if (stale) {
    void cache.revalidate(key, loader).catch((error) => {
      console.warn("[PARTNER_STATS] background refresh failed", { key, error });
    });
    return { body: stale, stale: true };
  }

  const body = await cache.revalidate(key, loader);
  return { body, stale: false };
}
