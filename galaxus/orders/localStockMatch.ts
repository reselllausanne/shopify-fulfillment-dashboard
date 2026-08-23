import { prisma } from "@/app/lib/prisma";
import { isGalaxusStxSupplierLine } from "@/galaxus/warehouse/lineInventorySource";
import {
  attachPhysicalStockToLines,
  buildPhysicalStockByGtinMap,
} from "@/shopify/inventory/orderLinePhysicalStock";
import { resolveInStockFixedPrice } from "@/shopify/inventory/inStockFixedPrice";

/** Stable ops ref for Galaxus lines fulfilled from local/physical stock (not a StockX buy). */
export function localStockMatchRef(galaxusOrderId: string, lineNumber: number | string | null | undefined): string {
  return `LOCAL-STOCK-${String(galaxusOrderId ?? "").trim()}-${String(lineNumber ?? "0").trim()}`;
}

export function isLocalOrManualStockxRef(value: unknown): boolean {
  const ref = String(value ?? "").trim();
  if (!ref) return false;
  return /^LOCAL-STOCK-/i.test(ref) || /^MANUAL-/i.test(ref);
}

/**
 * Hard COGS for warehouse in-stock lane (Essentials / Bape / AP×Travis / boxers).
 * Values live in `shopify/inventory/inStockFixedPrice.ts`.
 */
export function resolveGalaxusLocalStockCostChf(line: {
  productName?: string | null;
  description?: string | null;
  supplierSku?: string | null;
  styleSku?: string | null;
  offerSupplierSku?: string | null;
  shopifySku?: string | null;
}): { costChf: number; label: string; matchReason: string } | null {
  const title = String(line.productName ?? line.description ?? "").trim();
  const sku =
    String(line.shopifySku ?? "").trim() ||
    String(line.styleSku ?? "").trim() ||
    String(line.offerSupplierSku ?? "").trim() ||
    String(line.supplierSku ?? "").trim();
  const rule = resolveInStockFixedPrice({ sku: sku || null, title: title || null });
  if (!rule) return null;
  return {
    costChf: rule.costChf,
    label: rule.label,
    matchReason: rule.matchReason,
  };
}

export function shouldAutoLocalStockMatch(line: {
  physicalStock?: { qty?: number | null; locationName?: string | null } | null;
  productName?: string | null;
  description?: string | null;
  supplierSku?: string | null;
  styleSku?: string | null;
  offerSupplierSku?: string | null;
  shopifySku?: string | null;
  warehouseMarkedShippedAt?: Date | string | null;
}): { ok: boolean; reason: string; costChf: number } {
  const localQty = Number(line?.physicalStock?.qty ?? 0);
  const hasLiveStock = Number.isFinite(localQty) && localQty > 0;
  const alreadyShipped = Boolean(line?.warehouseMarkedShippedAt);
  const fixed = resolveGalaxusLocalStockCostChf(line);

  // Known warehouse apparel lane (Essentials / Bape / AP / boxers) → always LOCAL_STOCK
  // on Galaxus even if mirror qty already hit 0 after the sale reserved the unit.
  if (fixed) {
    const loc = String(line?.physicalStock?.locationName ?? "").trim();
    return {
      ok: true,
      reason: loc
        ? `IN_STOCK_FIXED_PRICE@${loc}`
        : hasLiveStock
          ? "IN_STOCK_FIXED_PRICE"
          : "IN_STOCK_FIXED_PRICE_LANE",
      costChf: fixed.costChf,
    };
  }

  if (hasLiveStock) {
    return {
      ok: true,
      reason: "LOCAL_PHYSICAL_STOCK",
      costChf: 0,
    };
  }

  if (alreadyShipped) {
    return {
      ok: true,
      reason: "LOCAL_PHYSICAL_STOCK_AFTER_SHIP",
      costChf: 0,
    };
  }

  return { ok: false, reason: "no_local_stock", costChf: 0 };
}

export async function upsertGalaxusLocalStockMatch(params: {
  order: {
    id: string;
    galaxusOrderId: string;
    orderDate?: Date | null;
    currencyCode?: string | null;
  };
  line: {
    id: string;
    lineNumber?: number | null;
    productName?: string | null;
    description?: string | null;
    size?: string | null;
    gtin?: string | null;
    providerKey?: string | null;
    supplierSku?: string | null;
    quantity?: number | null;
    unitNetPrice?: unknown;
    lineNetAmount?: unknown;
    vatRate?: unknown;
  };
  /**
   * Prefer hard COGS from in-stock fixed-price lane.
   * Generic physical stock defaults to 0 (already-expensed) unless caller passes amount.
   */
  stockxAmount?: number | null;
  reason?: string;
  locationName?: string | null;
}) {
  const prismaAny = prisma as any;
  const localRef = localStockMatchRef(params.order.galaxusOrderId, params.line.lineNumber);
  const amount =
    params.stockxAmount != null && Number.isFinite(Number(params.stockxAmount))
      ? Number(params.stockxAmount)
      : 0;
  const loc = String(params.locationName ?? "").trim();
  const payload = {
    galaxusOrderId: params.order.id,
    galaxusOrderRef: params.order.galaxusOrderId ?? null,
    galaxusOrderDate: params.order.orderDate ?? null,
    galaxusOrderLineId: params.line.id,
    unitIndex: 0,
    galaxusLineNumber: params.line.lineNumber ?? null,
    galaxusProductName: params.line.productName ?? "Item",
    galaxusDescription: params.line.description ?? null,
    galaxusSize: params.line.size ?? null,
    galaxusGtin: params.line.gtin ?? null,
    galaxusProviderKey: params.line.providerKey ?? null,
    galaxusSupplierSku: params.line.supplierSku ?? null,
    galaxusQuantity: Math.max(1, Number(params.line.quantity ?? 1)),
    galaxusUnitNetPrice: params.line.unitNetPrice,
    galaxusLineNetAmount: params.line.lineNetAmount,
    galaxusVatRate: params.line.vatRate,
    galaxusCurrencyCode: params.order.currencyCode ?? "CHF",
    stockxOrderNumber: localRef,
    stockxStatus: "LOCAL_STOCK",
    stockxAmount: amount,
    stockxCurrencyCode: String(params.order.currencyCode ?? "CHF"),
    matchConfidence: "high",
    matchScore: 1,
    matchType: "LOCAL_STOCK",
    matchReasons: JSON.stringify([
      params.reason ?? "LOCAL_PHYSICAL_STOCK_RESERVED",
      ...(loc ? [`location:${loc}`] : []),
    ]),
    updatedAt: new Date(),
  };
  return prismaAny.galaxusStockxMatch.upsert({
    where: { galaxusOrderLineId_unitIndex: { galaxusOrderLineId: params.line.id, unitIndex: 0 } },
    update: payload,
    create: payload,
  });
}

async function loadShopifySkuByGtin(gtins: string[]): Promise<Map<string, string>> {
  const cleaned = Array.from(
    new Set(gtins.map((g) => String(g ?? "").trim()).filter((g) => g.length > 0))
  );
  if (cleaned.length === 0) return new Map();
  const rows = await prisma.$queryRaw<Array<{ gtin: string; sku: string | null }>>`
    SELECT DISTINCT ON (s."gtin") s."gtin" AS gtin, s."sku" AS sku
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."gtin" = ANY(${cleaned}::text[])
      AND s."sku" IS NOT NULL
      AND length(trim(s."sku")) > 0
    ORDER BY s."gtin", s."priority" ASC, s."available" DESC
  `.catch(() => []);
  const out = new Map<string, string>();
  for (const row of rows) {
    const gtin = String(row?.gtin ?? "").trim();
    const sku = String(row?.sku ?? "").trim();
    if (gtin && sku) out.set(gtin, sku);
  }
  return out;
}

/**
 * Persist LOCAL_STOCK matches for STX lines that:
 * - still have physical qty, OR
 * - match the warehouse in-stock fixed-price lane (Essentials / Bape / AP / boxers)
 *
 * COGS for the fixed-price lane come from `inStockFixedPrice.ts` (tee 26 / hoodie 42 / Bape 35 / AP 40 / boxers 20).
 */
export async function ensureLocalStockMatchesForOrder(params: {
  order: {
    id: string;
    galaxusOrderId: string;
    orderDate?: Date | null;
    currencyCode?: string | null;
    lines?: any[];
  };
  reason?: string;
}): Promise<{ created: number; updated: number }> {
  const lines = params.order.lines ?? [];
  if (lines.length === 0) return { created: 0, updated: 0 };

  const prismaAny = prisma as any;
  const existing = await prismaAny.galaxusStockxMatch.findMany({
    where: { galaxusOrderId: params.order.id },
    select: {
      id: true,
      galaxusOrderLineId: true,
      stockxOrderNumber: true,
      matchType: true,
      stockxStatus: true,
      stockxAmount: true,
    },
  });
  const existingByLine = new Map<string, any>();
  for (const m of existing) {
    existingByLine.set(String(m.galaxusOrderLineId), m);
  }

  const physicalStockByGtin = await buildPhysicalStockByGtinMap(lines.map((l: any) => l?.gtin));
  const withPhysical = attachPhysicalStockToLines(lines, physicalStockByGtin);
  const skuByGtin = await loadShopifySkuByGtin(
    withPhysical.map((l: any) => String(l?.gtin ?? "").trim()).filter(Boolean)
  );

  let created = 0;
  let updated = 0;
  for (const line of withPhysical) {
    if (!isGalaxusStxSupplierLine(line)) continue;
    const lineId = String(line?.id ?? "").trim();
    if (!lineId) continue;

    const gtin = String(line?.gtin ?? "").trim();
    const shopifySku = (gtin && skuByGtin.get(gtin)) || null;
    const decision = shouldAutoLocalStockMatch({
      ...line,
      shopifySku,
    });
    if (!decision.ok) continue;

    // Shipped + no live stock + not fixed-price lane: skip if a real STX unit already linked.
    if (decision.reason === "LOCAL_PHYSICAL_STOCK_AFTER_SHIP") {
      const linkedUnit = gtin
        ? await prismaAny.stxPurchaseUnit
            .findFirst({
              where: {
                galaxusOrderId: params.order.galaxusOrderId,
                gtin,
                stockxOrderId: { not: null },
                cancelledAt: null,
              },
              select: { id: true },
            })
            .catch(() => null)
        : null;
      if (linkedUnit) continue;
    }

    const existingMatch = existingByLine.get(lineId) ?? null;
    if (existingMatch) {
      const existingNum = String(existingMatch.stockxOrderNumber ?? "").trim();
      const isLocal =
        String(existingMatch.matchType ?? "").toUpperCase() === "LOCAL_STOCK" ||
        String(existingMatch.stockxStatus ?? "").toUpperCase() === "LOCAL_STOCK" ||
        /^LOCAL-STOCK-/i.test(existingNum);
      // Do not overwrite a real StockX / manual buy link.
      if (!isLocal && existingNum) continue;

      const existingAmt =
        existingMatch.stockxAmount != null && Number.isFinite(Number(existingMatch.stockxAmount))
          ? Number(existingMatch.stockxAmount)
          : null;
      // Refresh when lane COGS is known and match amount is missing or stale.
      if (isLocal && decision.costChf > 0 && existingAmt !== decision.costChf) {
        await upsertGalaxusLocalStockMatch({
          order: params.order,
          line: { ...line, shopifySku },
          stockxAmount: decision.costChf,
          reason: params.reason ?? decision.reason,
          locationName: line?.physicalStock?.locationName ?? null,
        });
        updated += 1;
      }
      continue;
    }

    await upsertGalaxusLocalStockMatch({
      order: params.order,
      line: { ...line, shopifySku },
      stockxAmount: decision.costChf,
      reason: params.reason ?? decision.reason,
      locationName: line?.physicalStock?.locationName ?? null,
    });
    existingByLine.set(lineId, { galaxusOrderLineId: lineId, stockxOrderNumber: "LOCAL-STOCK" });
    created += 1;
  }

  return { created, updated };
}
