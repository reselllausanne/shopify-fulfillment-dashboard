/**
 * In-process + disk TTL cache for StockX buying-list pages.
 * Stops match/auto-link/bulk from re-paginating the same PENDING feed
 * on every Galaxus order / scan / page reload.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  fetchRecentStockxBuyingOrders,
  type StockxBuyingNode,
} from "@/galaxus/stx/stockxClient";

export type BuyingListState = "PENDING" | "HISTORICAL" | null;

type CacheEntry = {
  expiresAt: number;
  fetchedAt: number;
  nodes: StockxBuyingNode[];
  pageCount: number;
  durationMs: number;
};

const globalKey = "__resell_stockx_buying_orders_cache_v1";

type CacheStore = Map<string, CacheEntry>;

function store(): CacheStore {
  const g = globalThis as typeof globalThis & { [globalKey]?: CacheStore };
  if (!g[globalKey]) g[globalKey] = new Map();
  return g[globalKey]!;
}

function tokenFingerprint(token: string): string {
  // Avoid storing raw bearer; short stable key is enough for process-local cache.
  const t = String(token ?? "").trim();
  if (t.length <= 12) return t || "empty";
  return `${t.slice(0, 6)}…${t.slice(-4)}:${t.length}`;
}

function cacheKey(params: {
  token: string;
  state: BuyingListState;
  first: number;
  maxPages: number;
  query?: string | null;
}): string {
  return [
    tokenFingerprint(params.token),
    params.state === null ? "ALL" : params.state,
    `f${params.first}`,
    `p${params.maxPages}`,
    params.query ? `q:${params.query.trim().toLowerCase()}` : "q:",
  ].join("|");
}

export const BUYING_ORDERS_CACHE_TTL_MS = Math.max(
  15_000,
  Number(process.env.STOCKX_BUYING_CACHE_TTL_MS ?? "300000")
);

const DISK_CACHE_DIR = path.join(process.cwd(), ".data", "stockx-buying-cache");

function diskSafeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
}

async function readDiskEntry(key: string): Promise<CacheEntry | null> {
  try {
    const file = path.join(DISK_CACHE_DIR, `${diskSafeKey(key)}.json`);
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed || !Array.isArray(parsed.nodes) || !Number.isFinite(parsed.expiresAt)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeDiskEntry(key: string, entry: CacheEntry): Promise<void> {
  try {
    await fs.mkdir(DISK_CACHE_DIR, { recursive: true });
    const file = path.join(DISK_CACHE_DIR, `${diskSafeKey(key)}.json`);
    await fs.writeFile(file, JSON.stringify(entry), "utf8");
  } catch (err) {
    console.warn("[STOCKX][BUYING_CACHE] disk write failed", err);
  }
}

export type CachedBuyingOrdersResult = {
  nodes: StockxBuyingNode[];
  fromCache: boolean;
  fetchedAt: number;
  durationMs: number;
  pageCount: number;
  cacheKey: string;
  cacheSource?: "memory" | "disk" | "network";
};

export async function getCachedStockxBuyingOrders(
  token: string,
  options?: {
    first?: number;
    maxPages?: number;
    state?: BuyingListState;
    query?: string | null;
    /** Bypass TTL and refetch. */
    forceRefresh?: boolean;
    ttlMs?: number;
    /** Stop paginating early once predicate returns true (network only). */
    shouldStop?: (nodes: StockxBuyingNode[]) => boolean;
  }
): Promise<CachedBuyingOrdersResult> {
  const first = Math.max(1, Math.min(options?.first ?? 100, 100));
  const maxPages = Math.max(1, options?.maxPages ?? 4);
  const state: BuyingListState =
    options?.state === undefined ? "PENDING" : options.state;
  const query =
    typeof options?.query === "string" && options.query.trim()
      ? options.query.trim()
      : null;
  const key = cacheKey({ token, state, first, maxPages, query });
  const ttl = options?.ttlMs ?? BUYING_ORDERS_CACHE_TTL_MS;
  const now = Date.now();
  const cached = store().get(key);

  if (!options?.forceRefresh && cached && cached.expiresAt > now) {
    return {
      nodes: cached.nodes,
      fromCache: true,
      fetchedAt: cached.fetchedAt,
      durationMs: cached.durationMs,
      pageCount: cached.pageCount,
      cacheKey: key,
      cacheSource: "memory",
    };
  }

  // Disk bridge: localhost reload / multi-worker share one crawl for TTL.
  if (!options?.forceRefresh && !options?.shouldStop) {
    const disk = await readDiskEntry(key);
    if (disk && disk.expiresAt > now) {
      store().set(key, disk);
      return {
        nodes: disk.nodes,
        fromCache: true,
        fetchedAt: disk.fetchedAt,
        durationMs: disk.durationMs,
        pageCount: disk.pageCount,
        cacheKey: key,
        cacheSource: "disk",
      };
    }
  }

  const started = Date.now();
  const nodes = await fetchRecentStockxBuyingOrders(token, {
    first,
    maxPages,
    state,
    query,
    shouldStop: options?.shouldStop,
  });
  const durationMs = Date.now() - started;
  const entry: CacheEntry = {
    expiresAt: now + ttl,
    fetchedAt: now,
    nodes,
    pageCount: maxPages,
    durationMs,
  };
  // Early-stop runs must not poison the full-page cache key.
  if (!options?.shouldStop) {
    store().set(key, entry);
    void writeDiskEntry(key, entry);
  }

  return {
    nodes,
    fromCache: false,
    fetchedAt: entry.fetchedAt,
    durationMs,
    pageCount: maxPages,
    cacheKey: key,
    cacheSource: "network",
  };
}

/** Prefetch PENDING (+ optional HISTORICAL) once for multi-order runners. */
export async function prefetchStockxBuyingOrdersForMatching(
  token: string,
  options?: {
    pendingPages?: number;
    historicalPages?: number;
    includeHistorical?: boolean;
  }
): Promise<{
  pending: StockxBuyingNode[];
  historical: StockxBuyingNode[];
  merged: StockxBuyingNode[];
  timings: { pendingMs: number; historicalMs: number; pendingFromCache: boolean; historicalFromCache: boolean };
}> {
  const pendingPages = Math.max(
    1,
    Math.min(12, options?.pendingPages ?? Number(process.env.STOCKX_MATCH_PENDING_PAGES ?? "4"))
  );
  const includeHistorical = options?.includeHistorical !== false;
  const historicalPages = Math.max(
    0,
    Math.min(4, options?.historicalPages ?? Number(process.env.STOCKX_MATCH_HISTORICAL_PAGES ?? "2"))
  );

  const pendingRes = await getCachedStockxBuyingOrders(token, {
    first: 100,
    maxPages: pendingPages,
    state: "PENDING",
  });

  let historical: StockxBuyingNode[] = [];
  let historicalMs = 0;
  let historicalFromCache = false;
  if (includeHistorical && historicalPages > 0) {
    const histRes = await getCachedStockxBuyingOrders(token, {
      first: 100,
      maxPages: historicalPages,
      state: "HISTORICAL",
    });
    historical = histRes.nodes;
    historicalMs = histRes.durationMs;
    historicalFromCache = histRes.fromCache;
  }

  const seen = new Set<string>();
  const merged: StockxBuyingNode[] = [];
  for (const node of [...pendingRes.nodes, ...historical]) {
    const k = `${String(node.chainId ?? "")}::${String(node.orderId ?? "")}`;
    if (!k || k === "::" || seen.has(k)) continue;
    seen.add(k);
    merged.push(node);
  }

  return {
    pending: pendingRes.nodes,
    historical,
    merged,
    timings: {
      pendingMs: pendingRes.durationMs,
      historicalMs,
      pendingFromCache: pendingRes.fromCache,
      historicalFromCache,
    },
  };
}

export function clearBuyingOrdersCache(): void {
  store().clear();
}
