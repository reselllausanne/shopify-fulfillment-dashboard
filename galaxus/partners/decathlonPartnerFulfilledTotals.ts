import type { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { decathlonMiraklSellTotal } from "@/decathlon/orders/margin";
import { decathlonMiraklSellerPayoutLineTotal } from "@/decathlon/orders/miraklLinePayout";
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

  for (const order of orders) {
    currency = String(order.currencyCode ?? currency) || currency;
    const metricsLines = metricsLinesForPartnerSession(order, pk);
    const rollup = partnerShipmentRollup(order, metricsLines);
    if (!isPartnerPortalFulfilled(rollup)) continue;

    fulfilledOrderCount += 1;
    for (const line of metricsLines) {
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

  return {
    currency,
    fulfilledOrderCount,
    fulfilledPartnerLineUnits,
    totalChf,
    miraklPayoutLineMisses: pk === "NER" ? miraklPayoutLineMisses : 0,
  };
}
