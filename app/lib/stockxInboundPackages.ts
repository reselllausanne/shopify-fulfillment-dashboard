/**
 * Persist / refresh the last N StockX packages arrived for AWB fallback.
 * Multi-account ready via stockxAccountKey (Shopify today; Galaxus later).
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
  arrivedAt?: Date | string | null;
  channelHint?: string | null;
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

export async function upsertStockxInboundPackage(
  input: UpsertStockxInboundPackageInput
) {
  const awb = normalizeAwb(input.awb);
  if (!awb) return null;
  const prismaAny = prisma as any;
  if (!prismaAny.stockxInboundPackage) {
    // Migration not applied yet — no-op so callers stay safe.
    return null;
  }

  const purchaseDate = asDate(input.purchaseDate);
  const arrivedAt = asDate(input.arrivedAt) ?? new Date();

  return prismaAny.stockxInboundPackage.upsert({
    where: { awb },
    create: {
      awb,
      stockxOrderNumber: input.stockxOrderNumber ?? null,
      stockxOrderId: input.stockxOrderId ?? null,
      stockxAccountKey: input.stockxAccountKey ?? "default",
      sku: input.sku ?? null,
      sizeEU: input.sizeEU ?? null,
      productName: input.productName ?? null,
      purchaseDate,
      status: input.status ?? null,
      arrivedAt,
      channelHint: input.channelHint ?? "shopify",
    },
    update: {
      stockxOrderNumber: input.stockxOrderNumber ?? undefined,
      stockxOrderId: input.stockxOrderId ?? undefined,
      stockxAccountKey: input.stockxAccountKey ?? undefined,
      sku: input.sku ?? undefined,
      sizeEU: input.sizeEU ?? undefined,
      productName: input.productName ?? undefined,
      purchaseDate: purchaseDate ?? undefined,
      status: input.status ?? undefined,
      arrivedAt,
      channelHint: input.channelHint ?? undefined,
    },
  });
}

export async function findStockxInboundPackageByAwb(awbRaw: string) {
  const awb = normalizeAwb(awbRaw);
  if (!awb) return null;
  const prismaAny = prisma as any;
  if (!prismaAny.stockxInboundPackage) return null;
  return prismaAny.stockxInboundPackage.findUnique({ where: { awb } });
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
