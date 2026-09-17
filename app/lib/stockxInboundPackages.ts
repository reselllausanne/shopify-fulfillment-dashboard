/**
 * Persist / refresh the last N StockX packages arrived for AWB fallback.
 * Multi-account ready via stockxAccountKey (Shopify today; Galaxus later).
 *
 * Retention ranking uses stockxEventAt, else firstSeenAt — never last cron tick.
 * firstSeenAt is immutable after create; lastSeenAt refreshes on every sync hit.
 *
 * NOTE: the legacy `syncStockxInboundPackagesFromDb` rebuilt this table from
 * OrderMatch + StxPurchaseUnit rows — that is the exact fake-signal pathway
 * we're eliminating. The real inbound sync lives in
 * `app/lib/stockxInboundSyncFromApi.ts` and calls the StockX buying API
 * directly. The DB-side helper is kept only as a deprecated no-op so
 * existing imports don't break at build time.
 */

import { prisma } from "@/app/lib/prisma";

export const STOCKX_INBOUND_PACKAGE_RETENTION = 100;

export type UpsertStockxInboundPackageInput = {
  awb: string;
  stockxOrderNumber?: string | null;
  stockxOrderId?: string | null;
  stockxAccountKey?: string | null;
  sku?: string | null;
  sizeEU?: string | null;
  productName?: string | null;
  purchaseDate?: Date | string | null;
  status?: string | null;
  /** @deprecated Prefer stockxEventAt; kept for callers that still pass it. */
  arrivedAt?: Date | string | null;
  /** Best StockX event time (purchase/creation). Drives retention ranking. */
  stockxEventAt?: Date | string | null;
  channelHint?: string | null;
};

export type UpsertStockxInboundPackageResult = {
  awb: string;
  created: boolean;
  firstSeenAt: Date;
  lastSeenAt: Date;
  stockxEventAt: Date | null;
};

function normalizeAwb(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Retention rank: stockxEventAt preferred, else firstSeenAt. Never lastSeenAt. */
export function inboundRetentionRankAt(row: {
  stockxEventAt?: Date | string | null;
  firstSeenAt?: Date | string | null;
  arrivedAt?: Date | string | null;
}): Date {
  return (
    asDate(row.stockxEventAt) ??
    asDate(row.firstSeenAt) ??
    asDate(row.arrivedAt) ??
    new Date(0)
  );
}

/**
 * Logistics timestamp for inbound retention ranking.
 * Prefer real parcel movement dates — NEVER purchaseDate / creationDate
 * (buy time ≠ when the package is inbound).
 *
 * Priority:
 * 1. deliveredDate
 * 2. estimatedDeliveryDateRange (latest, then min)
 * 3. sellerShipByDateRange (actual, then end, then start)
 */
export function resolveStockxInboundLogisticsAt(params: {
  deliveredDate?: Date | string | null;
  estimatedDeliveryDate?: Date | string | null;
  latestEstimatedDeliveryDate?: Date | string | null;
  sellerShipByActual?: Date | string | null;
  sellerShipByEnd?: Date | string | null;
  sellerShipByStart?: Date | string | null;
  /** Explicitly ignored — must not drive retention. */
  purchaseDate?: Date | string | null;
  creationDate?: Date | string | null;
}): Date | null {
  void params.purchaseDate;
  void params.creationDate;
  return (
    asDate(params.deliveredDate) ??
    asDate(params.latestEstimatedDeliveryDate) ??
    asDate(params.estimatedDeliveryDate) ??
    asDate(params.sellerShipByActual) ??
    asDate(params.sellerShipByEnd) ??
    asDate(params.sellerShipByStart) ??
    null
  );
}

export async function upsertStockxInboundPackage(
  input: UpsertStockxInboundPackageInput
): Promise<UpsertStockxInboundPackageResult | null> {
  const awb = normalizeAwb(input.awb);
  if (!awb) return null;
  const prismaAny = prisma as any;
  if (!prismaAny.stockxInboundPackage) {
    // Migration not applied yet — no-op so callers stay safe.
    return null;
  }

  const now = new Date();
  const purchaseDate = asDate(input.purchaseDate);
  // stockxEventAt = logistics only. Never fall back to purchaseDate.
  const stockxEventAt = asDate(input.stockxEventAt);
  // arrivedAt: set once on create from logistics event; do NOT bump on every cron.
  const arrivedAtCreate = stockxEventAt ?? now;

  const existing = await prismaAny.stockxInboundPackage.findUnique({
    where: { awb },
    select: { id: true, firstSeenAt: true },
  });

  if (!existing) {
    const created = await prismaAny.stockxInboundPackage.create({
      data: {
        awb,
        stockxOrderNumber: input.stockxOrderNumber ?? null,
        stockxOrderId: input.stockxOrderId ?? null,
        stockxAccountKey: input.stockxAccountKey ?? "default",
        sku: input.sku ?? null,
        sizeEU: input.sizeEU ?? null,
        productName: input.productName ?? null,
        purchaseDate,
        status: input.status ?? null,
        arrivedAt: arrivedAtCreate,
        firstSeenAt: now,
        lastSeenAt: now,
        stockxEventAt,
        channelHint: input.channelHint ?? "shopify",
      },
      select: {
        awb: true,
        firstSeenAt: true,
        lastSeenAt: true,
        stockxEventAt: true,
      },
    });
    return {
      awb: created.awb,
      created: true,
      firstSeenAt: created.firstSeenAt,
      lastSeenAt: created.lastSeenAt,
      stockxEventAt: created.stockxEventAt ?? null,
    };
  }

  const updated = await prismaAny.stockxInboundPackage.update({
    where: { awb },
    data: {
      stockxOrderNumber: input.stockxOrderNumber ?? undefined,
      stockxOrderId: input.stockxOrderId ?? undefined,
      stockxAccountKey: input.stockxAccountKey ?? undefined,
      sku: input.sku ?? undefined,
      sizeEU: input.sizeEU ?? undefined,
      productName: input.productName ?? undefined,
      purchaseDate: purchaseDate ?? undefined,
      status: input.status ?? undefined,
      // firstSeenAt: never touch
      lastSeenAt: now,
      // Prefer newer StockX event when available; do not clear.
      stockxEventAt: stockxEventAt ?? undefined,
      channelHint: input.channelHint ?? undefined,
      // arrivedAt: do not bump on resync
    },
    select: {
      awb: true,
      firstSeenAt: true,
      lastSeenAt: true,
      stockxEventAt: true,
    },
  });

  return {
    awb: updated.awb,
    created: false,
    firstSeenAt: updated.firstSeenAt,
    lastSeenAt: updated.lastSeenAt,
    stockxEventAt: updated.stockxEventAt ?? null,
  };
}

export async function findStockxInboundPackageByAwb(awbRaw: string) {
  const awb = normalizeAwb(awbRaw);
  if (!awb) return null;
  const prismaAny = prisma as any;
  if (!prismaAny.stockxInboundPackage) return null;
  return prismaAny.stockxInboundPackage.findUnique({ where: { awb } });
}

/**
 * Keep the top `limit` rows for an account by retention rank
 * (stockxEventAt desc, else firstSeenAt). Returns pruned count.
 */
export async function pruneStockxInboundPackagesForAccount(params: {
  accountKey: string;
  limit: number;
}): Promise<number> {
  const prismaAny = prisma as any;
  if (!prismaAny.stockxInboundPackage) return 0;
  const accountKey = String(params.accountKey ?? "").trim() || "default";
  const limit = Math.max(1, Math.min(500, params.limit));

  const rows = await prismaAny.stockxInboundPackage.findMany({
    where: { stockxAccountKey: accountKey },
    select: {
      id: true,
      stockxEventAt: true,
      firstSeenAt: true,
      arrivedAt: true,
    },
  });

  if (rows.length <= limit) return 0;

  const ranked = [...rows].sort(
    (a, b) =>
      inboundRetentionRankAt(b).getTime() - inboundRetentionRankAt(a).getTime()
  );
  const keepIds = new Set(ranked.slice(0, limit).map((r: { id: string }) => r.id));
  const prunedResult = await prismaAny.stockxInboundPackage.deleteMany({
    where: {
      stockxAccountKey: accountKey,
      id: { notIn: Array.from(keepIds) },
    },
  });
  return Number(prunedResult?.count ?? 0);
}

/**
 * @deprecated Rebuilding StockxInboundPackage from OrderMatch / StxPurchaseUnit
 * copied whatever AWB we happened to have already saved and marketed it as an
 * "arrived StockX parcel", which is exactly the wrong signal for the AWB
 * fallback. Real inbound sync now lives in
 * {@link ./stockxInboundSyncFromApi.ts#syncStockxInboundPackagesFromStockxApi}
 * and hits the StockX buying API. This function is kept as a no-op so old
 * imports keep compiling; callers should migrate.
 */
export async function syncStockxInboundPackagesFromDb(_options?: {
  limit?: number;
}): Promise<{ upserted: number; pruned: number; deprecated: true }> {
  console.warn(
    "[STOCKX-INBOUND-PACKAGES] syncStockxInboundPackagesFromDb is deprecated no-op; " +
      "use syncStockxInboundPackagesFromStockxApi instead."
  );
  return { upserted: 0, pruned: 0, deprecated: true };
}

/**
 * Candidates for Shopify AWB fallback: OrderMatch rows still missing AWB
 * (or matching SKU) within freshness window — open-ish matches.
 *
 * NOTE: these rows are only *discovery hints*. Callers MUST re-verify against
 * live Shopify fulfillment orders before treating them as open lines. Cf.
 * `app/lib/shopifyOpenLineCandidates.ts` for the verified loader.
 */
export async function loadShopifyOpenMatchCandidatesForSku(params: {
  sku: string;
  sizeEU?: string | null;
  minCreatedAt: Date;
}) {
  const sku = String(params.sku ?? "").trim();
  if (!sku) return [];

  return prisma.orderMatch.findMany({
    where: {
      shopifySku: { equals: sku, mode: "insensitive" },
      shopifyCreatedAt: { gte: params.minCreatedAt },
      OR: [{ stockxAwb: null }, { stockxAwb: "" }],
      ...(params.sizeEU
        ? { shopifySizeEU: { equals: String(params.sizeEU), mode: "insensitive" } }
        : {}),
    },
    orderBy: { shopifyCreatedAt: "asc" },
    take: 40,
    select: {
      shopifyOrderId: true,
      shopifyOrderName: true,
      shopifyLineItemId: true,
      shopifySku: true,
      shopifySizeEU: true,
      shopifyProductTitle: true,
      shopifyCreatedAt: true,
      stockxAwb: true,
      stockxOrderNumber: true,
    },
  });
}
