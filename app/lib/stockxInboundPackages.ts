/**
 * Persist / refresh the last N StockX packages arrived for AWB fallback.
 * Multi-account ready via stockxAccountKey (Shopify today; Galaxus later).
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

/**
 * Rebuild recent inbound packages from OrderMatch + StxPurchaseUnit AWB rows.
 * Keeps at most STOCKX_INBOUND_PACKAGE_RETENTION rows (deletes older).
 */
export async function syncStockxInboundPackagesFromDb(options?: {
  limit?: number;
}): Promise<{ upserted: number; pruned: number }> {
  const limit = Math.max(1, Math.min(500, options?.limit ?? STOCKX_INBOUND_PACKAGE_RETENTION));
  const prismaAny = prisma as any;
  if (!prismaAny.stockxInboundPackage) {
    return { upserted: 0, pruned: 0 };
  }

  let upserted = 0;

  const matches = await prisma.orderMatch.findMany({
    where: { stockxAwb: { not: null } },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      stockxAwb: true,
      stockxOrderNumber: true,
      stockxOrderId: true,
      shopifySku: true,
      shopifySizeEU: true,
      shopifyProductTitle: true,
      stockxPurchaseDate: true,
      stockxStatus: true,
      updatedAt: true,
    },
  });

  for (const m of matches) {
    const awb = normalizeAwb(m.stockxAwb);
    if (!awb) continue;
    await upsertStockxInboundPackage({
      awb,
      stockxOrderNumber: m.stockxOrderNumber,
      stockxOrderId: m.stockxOrderId,
      stockxAccountKey: "shopify",
      sku: m.shopifySku,
      sizeEU: m.shopifySizeEU,
      productName: m.shopifyProductTitle,
      purchaseDate: m.stockxPurchaseDate,
      status: m.stockxStatus,
      arrivedAt: m.updatedAt,
      channelHint: "shopify",
    });
    upserted += 1;
  }

  const units = await prismaAny.stxPurchaseUnit.findMany({
    where: { awb: { not: null }, cancelledAt: null },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      awb: true,
      stockxOrderNumber: true,
      stockxOrderId: true,
      gtin: true,
      supplierVariantId: true,
      updatedAt: true,
    },
  });

  for (const u of units) {
    const awb = normalizeAwb(u.awb);
    if (!awb) continue;
    await upsertStockxInboundPackage({
      awb,
      stockxOrderNumber: u.stockxOrderNumber,
      stockxOrderId: u.stockxOrderId,
      stockxAccountKey: "galaxus",
      sku: u.supplierVariantId,
      productName: null,
      purchaseDate: null,
      status: null,
      arrivedAt: u.updatedAt,
      channelHint: "galaxus",
    });
    upserted += 1;
  }

  const keep = await prismaAny.stockxInboundPackage.findMany({
    orderBy: { arrivedAt: "desc" },
    take: limit,
    select: { id: true },
  });
  const keepIds = new Set(keep.map((r: { id: string }) => r.id));
  const prunedResult = await prismaAny.stockxInboundPackage.deleteMany({
    where: { id: { notIn: Array.from(keepIds) } },
  });

  return { upserted, pruned: Number(prunedResult?.count ?? 0) };
}

export async function findStockxInboundPackageByAwb(awbRaw: string) {
  const awb = normalizeAwb(awbRaw);
  if (!awb) return null;
  const prismaAny = prisma as any;
  if (!prismaAny.stockxInboundPackage) return null;
  return prismaAny.stockxInboundPackage.findUnique({ where: { awb } });
}

/**
 * Candidates for Shopify AWB fallback: OrderMatch rows still missing AWB
 * (or matching SKU) within freshness window — open-ish matches.
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
