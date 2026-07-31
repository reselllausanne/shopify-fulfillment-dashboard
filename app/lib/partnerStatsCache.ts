type CacheEntry<T> = { at: number; value: T };

const PARTNER_STATS_CACHE_MS = Math.max(
  60_000,
  Number(process.env.PARTNER_STATS_CACHE_MS ?? "300000")
);

export function createPartnerKeyedCache<T>(ttlMs = PARTNER_STATS_CACHE_MS) {
  const store = new Map<string, CacheEntry<T>>();
  return {
    get(key: string): T | null {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() - entry.at >= ttlMs) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    set(key: string, value: T) {
      store.set(key, { at: Date.now(), value });
    },
  };
}
