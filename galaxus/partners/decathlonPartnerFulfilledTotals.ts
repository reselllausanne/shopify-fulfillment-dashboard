import type { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { decathlonMiraklSellTotal } from "@/decathlon/orders/margin";
import { decathlonMiraklSellerPayoutLineTotal } from "@/decathlon/orders/miraklLinePayout";
import { enrichDecathlonOrderLinesWithSupplierCatalog } from "@/decathlon/orders/supplierCatalogLineEnrichment";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";

/**
 * Same partner line scope as `GET /api/decathlon/orders?scope=partner` (offer SKU prefix, or whole order when `order.partnerKey` matches).
 */
function metricsLinesForPartnerSession(
  order: { lines: unknown[]; partnerKey?: string | null },
  sessionPk: string
): any[] {
  const pk = normalizeProviderKey(sessionPk);
  if (!pk) return [];
  const prefix = `${pk}_`;
  const lines = Array.isArray(order.lines) ? order.lines : [];
  let metricsLines = lines.filter((line: any) =>
    String(line.offerSku ?? "").toUpperCase().startsWith(prefix.toUpperCase())
  );
  if (
    metricsLines.length === 0 &&
    order.partnerKey &&
    normalizeProviderKey(order.partnerKey) === pk
  ) {
    metricsLines = lines;
  }
  return metricsLines;
}

/** Same shipped / remaining math as the partner orders list API. */
function partnerShipmentRollup(order: any, metricsLines: any[]) {
  const totalUnits = metricsLines.reduce((sum: number, line: any) => sum + Number(line.quantity ?? 0), 0);
  const shipmentLines = (order.shipments ?? []).flatMap((shipment: any) => shipment.lines ?? []);
  const scopedLineIds = new Set(metricsLines.map((line: any) => line.id));
  const scopedShipmentLines = shipmentLines.filter((line: any) => scopedLineIds.has(line.orderLineId));
  const hasLegacyShipment =
    scopedShipmentLines.length === 0 && (order.shipments ?? []).some((s: any) => s.shippedAt);
  const shippedUnits = hasLegacyShipment
    ? totalUnits
    : scopedShipmentLines.reduce((sum: number, line: any) => sum + Number(line.quantity ?? 0), 0);
  const remainingUnits = Math.max(totalUnits - shippedUnits, 0);
  const shippedCount = (order.shipments ?? []).filter((s: any) => Boolean(s.shippedAt)).length;
  return { totalUnits, shippedUnits, remainingUnits, shippedCount };
}

/** Same rule as `isPartnerOrderFulfilled` on `/partners/orders`. */
function isPartnerPortalFulfilled(rollup: ReturnType<typeof partnerShipmentRollup>): boolean {
  if (rollup.totalUnits > 0) return rollup.remainingUnits <= 0;
  return rollup.shippedCount > 0;
}

/** Shipped quantity per Decathlon order line id (legacy shipment = full line qty). */
function shippedQtyByLineId(order: any, metricsLines: any[]): Map<string, number> {
  const shipmentLines = (order.shipments ?? []).flatMap((shipment: any) => shipment.lines ?? []);
  const scopedLineIds = new Set(metricsLines.map((line: any) => line.id));
  const scopedShipmentLines = shipmentLines.filter((line: any) => scopedLineIds.has(line.orderLineId));
  const hasLegacyShipment =
    scopedShipmentLines.length === 0 && (order.shipments ?? []).some((s: any) => s.shippedAt);
  const map = new Map<string, number>();
  if (hasLegacyShipment) {
    for (const ml of metricsLines) {
      const qty = Number(ml.quantity ?? 0);
      if (Number.isFinite(qty) && qty > 0) map.set(ml.id, qty);
    }
    return map;
  }
  for (const sl of scopedShipmentLines) {
    const q = Number(sl.quantity ?? 0);
    if (!Number.isFinite(q) || q <= 0) continue;
    map.set(sl.orderLineId, (map.get(sl.orderLineId) ?? 0) + q);
  }
  return map;
}

function catalogShippedShipmentLineRowCount(order: any, metricsLines: any[]): number {
  const scopedLineIds = new Set(metricsLines.map((line: any) => line.id));
  const shipmentLines = (order.shipments ?? []).flatMap((shipment: any) => shipment.lines ?? []);
  const scopedShipmentLines = shipmentLines.filter((line: any) => scopedLineIds.has(line.orderLineId));
  const hasLegacyShipment =
    scopedShipmentLines.length === 0 && (order.shipments ?? []).some((s: any) => s.shippedAt);
  if (hasLegacyShipment) {
    return metricsLines.filter((ml) => Number(ml.quantity ?? 0) > 0).length;
  }
  let n = 0;
  for (const ship of order.shipments ?? []) {
    if (!ship.shippedAt) continue;
    for (const sl of ship.lines ?? []) {
      if (!scopedLineIds.has(sl.orderLineId)) continue;
      const q = Number(sl.quantity ?? 0);
      if (q > 0) n += 1;
    }
  }
  return n;
}

function partnerOrderWhere(sessionPk: string): Prisma.DecathlonOrderWhereInput {
  const keyPrefix = `${sessionPk}_`;
  return {
    OR: [{ partnerKey: sessionPk }, { lines: { some: { offerSku: { startsWith: keyPrefix } } } }],
  };
}

export type DecathlonPartnerFulfilledTotals = {
  currency: string;
  /** Orders that appear under Fulfilled for this partner (including manual / legacy shipments). */
  fulfilledOrderCount: number;
  /** Sum of line quantities on partner-scoped lines for those orders. */
  fulfilledPartnerLineUnits: number;
  /** NER: sum of Mirakl line payout per order line; others: sum of Mirakl sell (ligne) from DB. */
  totalChf: number;
  /** NER only: scoped lines missing Mirakl totals on fulfilled orders */
  miraklPayoutLineMisses: number;
  /** Feed/catalog buy price × shipped units on fulfilled orders (non-NER); NER uses Mirakl payout card instead. */
  partnerCatalogShippedChf: number;
  /** Shipment line rows tied to partner lines (or line count for legacy shipments). */
  shippedLineCount: number;
};

const DEFAULT_MAX_ORDERS = 15_000;

/**
 * Totals over orders that are **fulfilled** in the partner portal sense (same logic as the Fulfilled tab),
 * scoped to the **logged-in** partner — not the SKU-derived supplier on each line.
 */
export async function computeDecathlonPartnerFulfilledOrderStats(
  sessionPartnerKey: string,
  options?: { maxOrders?: number }
): Promise<DecathlonPartnerFulfilledTotals> {
  const pk = normalizeProviderKey(sessionPartnerKey);
  if (!pk) {
    throw new Error("Partner key missing");
  }
  const maxOrders = Math.min(Math.max(options?.maxOrders ?? DEFAULT_MAX_ORDERS, 1), 25_000);

  const orders = await prisma.decathlonOrder.findMany({
    where: partnerOrderWhere(pk),
    orderBy: { orderDate: "desc" },
    take: maxOrders,
    include: {
      lines: true,
      shipments: { include: { lines: true } },
    },
  });

  let currency = "CHF";
  let fulfilledOrderCount = 0;
  let fulfilledPartnerLineUnits = 0;
  let totalChf = 0;
  let miraklPayoutLineMisses = 0;

  const fulfilledMetricLines: any[] = [];

  for (const order of orders) {
    currency = String(order.currencyCode ?? currency) || currency;
    const metricsLines = metricsLinesForPartnerSession(order, pk);
    const rollup = partnerShipmentRollup(order, metricsLines);
    if (!isPartnerPortalFulfilled(rollup)) continue;

    fulfilledOrderCount += 1;
    for (const line of metricsLines) {
      fulfilledMetricLines.push(line);
      const qty = Number(line.quantity ?? 0);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      fulfilledPartnerLineUnits += qty;

      if (pk === "NER") {
        const p = decathlonMiraklSellerPayoutLineTotal(line.rawJson);
        if (p != null) totalChf += p;
        else miraklPayoutLineMisses += 1;
      } else {
        const s = decathlonMiraklSellTotal({
          lineTotal: line.lineTotal,
          unitPrice: line.unitPrice,
          quantity: line.quantity,
        });
        if (s != null) totalChf += s;
      }
    }
  }

  let partnerCatalogShippedChf = 0;
  let shippedLineCount = 0;
  if (pk !== "NER" && fulfilledMetricLines.length > 0) {
    const catalogByLineId = await enrichDecathlonOrderLinesWithSupplierCatalog(fulfilledMetricLines);
    for (const order of orders) {
      const metricsLines = metricsLinesForPartnerSession(order, pk);
      const rollup = partnerShipmentRollup(order, metricsLines);
      if (!isPartnerPortalFulfilled(rollup)) continue;
      shippedLineCount += catalogShippedShipmentLineRowCount(order, metricsLines);
      const shippedByLine = shippedQtyByLineId(order, metricsLines);
      for (const line of metricsLines) {
        const shipQty = shippedByLine.get(line.id) ?? 0;
        if (!Number.isFinite(shipQty) || shipQty <= 0) continue;
        const cat = catalogByLineId.get(line.id);
        const price = cat?.catalogPrice;
        if (price != null && Number.isFinite(price)) {
          partnerCatalogShippedChf += price * shipQty;
        }
      }
    }
  }

  return {
    currency,
    fulfilledOrderCount,
    fulfilledPartnerLineUnits,
    totalChf,
    miraklPayoutLineMisses: pk === "NER" ? miraklPayoutLineMisses : 0,
    partnerCatalogShippedChf,
    shippedLineCount,
  };
}
