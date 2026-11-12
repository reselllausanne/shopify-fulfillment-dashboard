/**
 * Fast KickDB/StockX price+stock refresh for recently sold Galaxus STX products.
 *
 * Full `stx-refresh` shards rotate the whole catalog over ~1–1.5 days. Hot winter
 * movers (UGG, …) need live asks several times per day so Galaxus PurchasePrice
 * tracks StockX before the next sale.
 *
 * Path = same as manual urlKey refresh: KickDB raw → SupplierVariant → debounced
 * Galaxus stock-price feed push.
 */
import { prisma } from "@/app/lib/prisma";
import { refreshStxProductsByKickdbProductIds } from "@/galaxus/jobs/stxSync";

export type StxHotSellersRefreshOptions = {
  lookbackDays?: number;
  minQty?: number;
  limitProducts?: number;
  concurrency?: number;
};

export type StxHotSellerRow = {
  kickdbProductId: string;
  qty: number;
  lines: number;
};

function readPositiveInt(raw: string | undefined, fallback: number, max?: number): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return max != null ? Math.min(n, max) : n;
}

export function resolveStxHotSellersRefreshOptions(
  overrides: StxHotSellersRefreshOptions = {}
): Required<StxHotSellersRefreshOptions> {
  return {
    lookbackDays:
      overrides.lookbackDays ??
      readPositiveInt(process.env.STX_HOT_LOOKBACK_DAYS, 14, 60),
    minQty: overrides.minQty ?? readPositiveInt(process.env.STX_HOT_MIN_QTY, 1, 100),
    limitProducts:
      overrides.limitProducts ??
      readPositiveInt(process.env.STX_HOT_LIMIT_PRODUCTS, 400, 2000),
    concurrency:
      overrides.concurrency ?? readPositiveInt(process.env.STX_HOT_CONCURRENCY, 4, 16),
  };
}

/** Recent Galaxus STX sales → KickDB product ids, hottest first. */
export async function listHotGalaxusStxKickdbProductIds(
  options: StxHotSellersRefreshOptions = {}
): Promise<StxHotSellerRow[]> {
  const cfg = resolveStxHotSellersRefreshOptions(options);
  const since = new Date(Date.now() - cfg.lookbackDays * 24 * 60 * 60 * 1000);

  const rows = await prisma.$queryRaw<
    Array<{ kickdbProductId: string; qty: number | bigint | string; lines: number | bigint | string }>
  >`
    SELECT
      kp."kickdbProductId" AS "kickdbProductId",
      SUM(l.quantity)::int AS qty,
      COUNT(*)::int AS lines
    FROM "GalaxusOrderLine" l
    INNER JOIN "GalaxusOrder" o ON o.id = l."orderId"
    INNER JOIN "KickDBVariant" kv ON kv.gtin = l.gtin
    INNER JOIN "KickDBProduct" kp ON kp.id = kv."productId"
    WHERE o."createdAt" >= ${since}
      AND l."providerKey" LIKE 'STX_%'
      AND l.gtin IS NOT NULL
      AND length(trim(l.gtin)) > 0
      AND kp."notFound" = false
    GROUP BY kp."kickdbProductId"
    HAVING SUM(l.quantity) >= ${cfg.minQty}
    ORDER BY SUM(l.quantity) DESC, COUNT(*) DESC
    LIMIT ${cfg.limitProducts}
  `;

  return rows
    .map((row) => ({
      kickdbProductId: String(row.kickdbProductId ?? "").trim(),
      qty: Number(row.qty) || 0,
      lines: Number(row.lines) || 0,
    }))
    .filter((row) => row.kickdbProductId.length > 0);
}

export async function runStxHotSellersRefresh(options: StxHotSellersRefreshOptions = {}) {
  const cfg = resolveStxHotSellersRefreshOptions(options);
  const startedAt = Date.now();
  const hot = await listHotGalaxusStxKickdbProductIds(cfg);
  const productIds = hot.map((row) => row.kickdbProductId);

  console.info("[galaxus][sync:stx-hot] start", {
    lookbackDays: cfg.lookbackDays,
    minQty: cfg.minQty,
    limitProducts: cfg.limitProducts,
    concurrency: cfg.concurrency,
    hotProducts: productIds.length,
    topQty: hot.slice(0, 8).map((row) => ({ id: row.kickdbProductId, qty: row.qty })),
  });

  if (productIds.length === 0) {
    return {
      hotProducts: 0,
      processedProducts: 0,
      processedVariants: 0,
      updated: 0,
      stockZeroed: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  const sync = await refreshStxProductsByKickdbProductIds(productIds, {
    concurrency: cfg.concurrency,
  });

  const result = {
    hotProducts: productIds.length,
    processedProducts: sync.processedProducts,
    processedVariants: sync.processedVariants,
    updated: sync.updated,
    stockZeroed: sync.stockZeroed,
    durationMs: Date.now() - startedAt,
  };
  console.info("[galaxus][sync:stx-hot] done", result);
  return result;
}
