import type { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { galaxusLineNetRevenueChf } from "@/galaxus/orders/margin";
import { isGalaxusShipmentDispatchConfirmed } from "@/galaxus/orders/shipmentDispatch";

type PartnerLine = {
  id: string;
  quantity: number;
  providerKey?: string | null;
  supplierVariantId?: string | null;
  warehouseMarkedShippedAt?: Date | null;
  lineNetAmount?: unknown;
  priceLineAmount?: unknown;
};

function partnerLineScope(pk: string): Prisma.GalaxusOrderLineWhereInput {
  const prefix = `${pk}_`;
  const lower = pk.toLowerCase();
  return {
    OR: [
      { providerKey: { startsWith: prefix, mode: "insensitive" } },
      { supplierVariantId: { startsWith: `${lower}:`, mode: "insensitive" } },
      { supplierVariantId: { startsWith: `${prefix}`, mode: "insensitive" } },
    ],
  };
}

function isOrderFulfilled(order: {
  deliveryType?: string | null;
  shipments?: any[];
  partnerLines?: Array<{ warehouseMarkedShippedAt?: Date | null }>;
}): boolean {
  const isDirect = String(order.deliveryType ?? "").toLowerCase() === "direct_delivery";
  const partnerLines = Array.isArray(order.partnerLines) ? order.partnerLines : [];
  const warehouseShippedCount = partnerLines.filter((line) => Boolean(line?.warehouseMarkedShippedAt)).length;
  const isWarehouseFulfilled = partnerLines.length > 0 && warehouseShippedCount >= partnerLines.length;
  if (!Array.isArray(order.shipments) || order.shipments.length === 0) return isWarehouseFulfilled;
  if (isDirect) {
    return isWarehouseFulfilled || order.shipments.some((shipment) => Boolean(shipment?.delrSentAt));
  }
  return (
    isWarehouseFulfilled ||
    order.shipments.some((shipment) => {
    if (shipment?.delrSentAt) return true;
    const delrStatus = String(shipment?.delrStatus ?? "").toUpperCase();
    return delrStatus === "UPLOADED" || delrStatus === "SENT";
    })
  );
}

export type GalaxusPartnerFulfilledTotals = {
  currency: string;
  fulfilledOrderCount: number;
  fulfilledPartnerLineUnits: number;
  totalChf: number;
};

const DEFAULT_MAX_ORDERS = 20_000;

export async function computeGalaxusPartnerFulfilledOrderStats(
  sessionPartnerKey: string,
  options?: { maxOrders?: number }
): Promise<GalaxusPartnerFulfilledTotals> {
  const pk = normalizeProviderKey(sessionPartnerKey);
  if (!pk) throw new Error("Partner key missing");
  const maxOrders = Math.min(Math.max(options?.maxOrders ?? DEFAULT_MAX_ORDERS, 1), 30_000);

  const orders = await prisma.galaxusOrder.findMany({
    where: { lines: { some: partnerLineScope(pk) } },
    orderBy: { orderDate: "desc" },
    take: maxOrders,
    include: {
      lines: true,
      shipments: true,
    },
  });

  let currency = "CHF";
  let fulfilledOrderCount = 0;
  let fulfilledPartnerLineUnits = 0;
  let totalChf = 0;

  for (const order of orders) {
    currency = String(order.currencyCode ?? currency) || currency;
    const partnerLines: PartnerLine[] = order.lines.filter((line) => {
      const providerKey = String(line.providerKey ?? "").toUpperCase();
      const supplierVariantId = String(line.supplierVariantId ?? "").toLowerCase();
      return (
        providerKey.startsWith(`${pk}_`) ||
        supplierVariantId.startsWith(`${pk.toLowerCase()}:`) ||
        supplierVariantId.startsWith(`${pk.toUpperCase()}_`.toLowerCase())
      );
    });
    if (!isOrderFulfilled({ ...order, partnerLines })) continue;
    fulfilledOrderCount += 1;
    for (const line of partnerLines) {
      const qty = Number(line.quantity ?? 0);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      fulfilledPartnerLineUnits += qty;
      const revenue = galaxusLineNetRevenueChf(line);
      if (revenue != null && Number.isFinite(revenue)) {
        totalChf += revenue;
      }
    }
  }

  return { currency, fulfilledOrderCount, fulfilledPartnerLineUnits, totalChf };
}
