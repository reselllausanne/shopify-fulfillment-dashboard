import { prisma } from "@/app/lib/prisma";
import { isGalaxusStxSupplierLine } from "@/galaxus/warehouse/lineInventorySource";
import {
  attachPhysicalStockToLines,
  buildPhysicalStockByGtinMap,
} from "@/shopify/inventory/orderLinePhysicalStock";
import type { OrderLinePhysicalStock } from "@/shopify/inventory/orderLinePhysicalStock.types";
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

export function isLocalStockMatchRow(match: {
  matchType?: string | null;
  stockxStatus?: string | null;
  stockxOrderNumber?: string | null;
} | null | undefined): boolean {
  if (!match) return false;
  const type = String(match.matchType ?? "").trim().toUpperCase();
  const status = String(match.stockxStatus ?? "").trim().toUpperCase();
  const num = String(match.stockxOrderNumber ?? "").trim();
  return type === "LOCAL_STOCK" || status === "LOCAL_STOCK" || /^LOCAL-STOCK-/i.test(num);
}

/** Encode sale location into matchReasons (kept as JSON array for ops readability). */
export function buildLocalStockMatchReasons(params: {
  reason?: string;
  locationName?: string | null;
  locationId?: string | null;
}): string {
  const reasons: unknown[] = [params.reason ?? "LOCAL_PHYSICAL_STOCK_RESERVED"];
  const locationName = String(params.locationName ?? "").trim();
  const locationId = String(params.locationId ?? "").trim();
  if (locationName) reasons.push(`location:${locationName}`);
  if (locationName || locationId) {
    reasons.push({
      locationName: locationName || null,
      locationId: locationId || null,
    });
  }
  return JSON.stringify(reasons);
}

export function parseLocalStockLocationFromMatch(match: {
  matchReasons?: string | null;
} | null | undefined): { locationName: string; locationId: string | null } | null {
  const raw = String(match?.matchReasons ?? "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    let fromString: string | null = null;
    for (const entry of parsed) {
      if (typeof entry === "string") {
        const m = /^location:(.+)$/i.exec(entry.trim());
        if (m?.[1]) fromString = m[1].trim();
        continue;
      }
      if (!entry || typeof entry !== "object") continue;
      const locationName = String((entry as any).locationName ?? "").trim();
      const locationId = String((entry as any).locationId ?? "").trim() || null;
      if (locationName) return { locationName, locationId };
    }
    if (fromString) return { locationName: fromString, locationId: null };
  } catch {
    return null;
  }
  return null;
}

/**
 * After Shopify qty hits 0, still show warehouse location from LOCAL_STOCK match.
 * Live mirror qty > 0 wins; reserved sale location fills gaps.
 */
export function mergeReservedPhysicalStockOntoLines<
  T extends { id?: string | null; gtin?: string | null; physicalStock?: OrderLinePhysicalStock | null },
>(
  lines: T[],
  matches: Array<{
    galaxusOrderLineId?: string | null;
    matchType?: string | null;
    stockxStatus?: string | null;
    stockxOrderNumber?: string | null;
    matchReasons?: string | null;
  }>
): Array<T & { physicalStock: OrderLinePhysicalStock | null }> {
  const localByLineId = new Map<string, (typeof matches)[number]>();
  for (const m of matches ?? []) {
    if (!isLocalStockMatchRow(m)) continue;
    const lineId = String(m.galaxusOrderLineId ?? "").trim();
    if (lineId && !localByLineId.has(lineId)) localByLineId.set(lineId, m);
  }

  return lines.map((line) => {
    const live = line.physicalStock ?? null;
    if (live && live.qty > 0) {
      return { ...line, physicalStock: live };
    }
    const match = localByLineId.get(String(line.id ?? "").trim());
    if (!match) return { ...line, physicalStock: live };
    const loc = parseLocalStockLocationFromMatch(match);
    return {
      ...line,
      physicalStock: {
        qty: Math.max(1, Number(live?.qty ?? 1) || 1),
        locationName: loc?.locationName || live?.locationName || "Physical stock",
        locationId: loc?.locationId ?? live?.locationId ?? null,
        reservedFromSale: true,
      },
    };
  });
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
  locationId?: string | null;
}) {
  const prismaAny = prisma as any;
  const localRef = localStockMatchRef(params.order.galaxusOrderId, params.line.lineNumber);
  const amount =
    params.stockxAmount != null && Number.isFinite(Number(params.stockxAmount))
      ? Number(params.stockxAmount)
      : 0;
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
    matchReasons: buildLocalStockMatchReasons({
      reason: params.reason ?? "LOCAL_PHYSICAL_STOCK_RESERVED",
      locationName: params.locationName,
      locationId: params.locationId,
    }),
    updatedAt: new Date(),
  };
  return prismaAny.galaxusStockxMatch.upsert({
    where: { galaxusOrderLineId_unitIndex: { galaxusOrderLineId: params.line.id, unitIndex: 0 } },
    update: payload,
    create: payload,
  });
}

/**
 * Persist LOCAL_STOCK after marketplace physical Shopify decrement (qty already 0).
 * Parses `GALAXUS:{orderRef}:{lineNumber}` external line ids from inventory apply.
 */
export async function upsertLocalStockMatchAfterMarketplaceSale(params: {
  channel: string;
  externalOrderId?: string | null;
  externalLineId: string;
  locations: Array<{ locationId: string; locationName: string; delta: number }>;
}): Promise<{ ok: boolean; reason?: string }> {
  if (String(params.channel ?? "").toUpperCase() !== "GALAXUS") {
    return { ok: false, reason: "not_galaxus" };
  }
  const externalLineId = String(params.externalLineId ?? "").trim();
  const m = /^GALAXUS:([^:]+):(\d+)$/i.exec(externalLineId);
  const orderRef =
    String(params.externalOrderId ?? "").trim() || (m ? String(m[1] ?? "").trim() : "");
  const lineNumber = m ? Number(m[2]) : NaN;
  if (!orderRef || !Number.isFinite(lineNumber)) {
    return { ok: false, reason: "bad_external_line" };
  }

  const order = await (prisma as any).galaxusOrder.findFirst({
    where: { galaxusOrderId: orderRef },
    select: {
      id: true,
      galaxusOrderId: true,
      orderDate: true,
      currencyCode: true,
      lines: {
        where: { lineNumber },
        take: 1,
      },
    },
  });
  if (!order?.id) return { ok: false, reason: "order_not_found" };
  const line = Array.isArray(order.lines) ? order.lines[0] : null;
  if (!line?.id) return { ok: false, reason: "line_not_found" };

  const soldLoc = (params.locations ?? []).find((l) => Number(l.delta) < 0) ?? params.locations?.[0];
  const fixed = resolveGalaxusLocalStockCostChf(line);
  await upsertGalaxusLocalStockMatch({
    order,
    line,
    stockxAmount: fixed?.costChf ?? 0,
    reason: fixed
      ? `LOCAL_PHYSICAL_STOCK_AFTER_MARKETPLACE_SALE:${fixed.matchReason}`
      : "LOCAL_PHYSICAL_STOCK_AFTER_MARKETPLACE_SALE",
    locationName: soldLoc?.locationName ?? null,
    locationId: soldLoc?.locationId ?? null,
  });
  return { ok: true };
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
 * - match the warehouse in-stock fixed-price lane (Essentials / Bape / AP / boxers), OR
 * - were already warehouse-shipped without a StockX buy
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
          locationId: line?.physicalStock?.locationId ?? null,
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
      locationId: line?.physicalStock?.locationId ?? null,
    });
    existingByLine.set(lineId, { galaxusOrderLineId: lineId, stockxOrderNumber: "LOCAL-STOCK" });
    created += 1;
  }

  return { created, updated };
}
