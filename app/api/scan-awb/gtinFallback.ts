import { prisma } from "@/app/lib/prisma";
import {
  computeShipmentCoverageForOrders,
  loadDelrShipmentIdsForOrders,
  loadShipmentItemsForOrders,
} from "@/galaxus/warehouse/shipmentLineCoverage";
import {
  isShopifyOrderMatchFresh,
  shopifyMatchMinCreatedAt,
} from "@/app/lib/shopifyMatchEligibility";
import {
  listGalaxusDirectOpenUnits,
  type GalaxusDirectOpenUnit,
} from "@/lib/galaxusDirectOpenUnits";
import {
  decideFulfillUnitSelection,
  type UnitSelectionDecision,
} from "@/lib/shopifyFulfillUnitSelection";
import { listAllOpenUnits } from "@/lib/shopifyOrderOpenSiblings";
import {
  fetchOrderFulfillmentMap,
  fetchOrderShippingInfo,
} from "@/lib/shopifyFulfillment";
import { galaxusScanDisplayRecipient } from "@/lib/swissPostRecipient";
import { expandGtinCandidates } from "@/lib/gtinCandidates";
import { resolveShopifySkusForGtinCandidates } from "@/lib/shopifyGtinSkuResolve";
import { searchLiveOpenShopifyLinesBySkus } from "@/lib/shopifyOpenOrdersBySku";

const DECATHLON_TERMINAL_STATES = new Set([
  "CANCELED",
  "CANCELLED",
  "ORDER_CANCELLED",
  "CLOSED",
  "SHIPPED",
  "REFUSED",
  "REFUNDED",
]);

export type GtinChannel = "galaxus" | "shopify" | "decathlon";
export type GtinAutoChannel = "galaxus_direct" | "shopify" | "decathlon";

export type GtinOrderRow = {
  channel: GtinChannel;
  lineId: string;
  lineNumber: number | null;
  productName: string | null;
  quantity: number;
  ordered: number;
  shipped: number;
  reserved: number;
  remaining: number;
  warehouseMarkedShippedAt: string | null;
  orderDate: string;
  orderNumber: string | null;
  cancelledAt: string | null;
  recipient: {
    name: string | null;
    city: string | null;
    postalCode: string | null;
    countryCode: string | null;
  };
  // Galaxus
  galaxusOrderDbId?: string;
  galaxusOrderId?: string;
  deliveryType?: string | null;
  isDirectDelivery?: boolean;
  physicalDeliveryNoteRequired?: boolean;
  ordrSentAt?: string | null;
  shipments?: Array<{
    id: string;
    trackingNumber: string | null;
    status: string | null;
    deliveryType: string | null;
    packageType: string | null;
    shippedAt: string | null;
    delrStatus: string | null;
  }>;
  stockxLinks?: Array<{
    stockxOrderNumber: string | null;
    awb: string | null;
    etaMin: string | null;
    etaMax: string | null;
    cancelledAt: string | null;
  }>;
  hasAnyShipment?: boolean;
  hasStockxLink?: boolean;
  // Shopify
  shopifyOrderId?: string;
  shopifyOrderName?: string | null;
  shopifyLineItemId?: string | null;
  shopifySku?: string | null;
  // Decathlon
  decathlonOrderDbId?: string;
  decathlonOrderId?: string;
  decathlonOrderState?: string | null;
  decathlonShipmentId?: string | null;
};

export type GtinFallbackPayload = {
  gtin: string;
  productName: string | null;
  totalOpen: number;
  openDirect: number;
  openWarehouse: number;
  openShopify: number;
  openDecathlon: number;
  autoDirectOrderDbId: string | null;
  autoDirectLineId: string | null;
  autoDirectRemaining: number;
  /** All open lines on the matched direct order (not only GTIN hits). */
  autoDirectOpenUnits: GalaxusDirectOpenUnit[];
  autoDirectUnitSelection: UnitSelectionDecision | null;
  autoShopify: {
    shopifyOrderId: string;
    shopifyOrderName: string | null;
    shopifyLineItemId: string;
    unitSelection?: UnitSelectionDecision | null;
    openUnits?: Array<{
      lineItemId: string;
      title: string;
      remainingQuantity: number;
      isScannedLine?: boolean;
    }>;
  } | null;
  autoDecathlon: {
    orderId: string;
    orderDbId: string;
    lineId: string;
    quantity: number;
  } | null;
  /** When no open Decathlon line left, still surface the latest shipped order so /scan can reprint packing slip + label. */
  autoDecathlonReprint: {
    orderId: string;
    orderDbId: string;
    shipmentId: string | null;
  } | null;
  /** Oldest open fulfillable channel (direct / shopify / decathlon). Null if none
   *  or when warehouse + direct both open for the same GTIN (operator must pick). */
  autoChannel: GtinAutoChannel | null;
  /**
   * Same physical GTIN is owed on Galaxus warehouse AND direct. Auto-fulfill /
   * auto-packing must not claim both — operator chooses one channel for this unit.
   */
  requiresChannelChoice: boolean;
  orders: GtinOrderRow[];
};

async function loadGalaxusGtinOrders(gtinCandidates: string[]): Promise<GtinOrderRow[]> {
  const lines = await prisma.galaxusOrderLine.findMany({
    where: {
      OR: [
        { gtin: { in: gtinCandidates } },
        { providerKey: { in: gtinCandidates.map((g) => `STX_${g}`) } },
      ],
      order: { cancelledAt: null, archivedAt: null },
    },
    orderBy: [{ order: { orderDate: "asc" } }, { order: { createdAt: "asc" } }],
    take: 50,
    select: {
      id: true,
      lineNumber: true,
      productName: true,
      quantity: true,
      buyerPid: true,
      supplierPid: true,
      warehouseMarkedShippedAt: true,
      gtin: true,
      order: {
        select: {
          id: true,
          galaxusOrderId: true,
          orderNumber: true,
          orderDate: true,
          createdAt: true,
          deliveryType: true,
          ordrSentAt: true,
          cancelledAt: true,
          physicalDeliveryNoteRequired: true,
          recipientName: true,
          recipientCity: true,
          recipientPostalCode: true,
          recipientCountryCode: true,
          customerName: true,
          customerCity: true,
          customerPostalCode: true,
          customerCountryCode: true,
          referencePerson: true,
          shipments: {
            orderBy: { shippedAt: "desc" },
            select: {
              id: true,
              trackingNumber: true,
              status: true,
              deliveryType: true,
              packageType: true,
              shippedAt: true,
              delrStatus: true,
            },
          },
        },
      },
    },
  });

  if (lines.length === 0) return [];

  const orderRefs = Array.from(new Set(lines.map((l) => l.order.galaxusOrderId)));
  const orderDbIds = Array.from(new Set(lines.map((l) => l.order.id)));

  const fullOrders = await prisma.galaxusOrder.findMany({
    where: { id: { in: orderDbIds } },
    select: {
      id: true,
      galaxusOrderId: true,
      lines: {
        select: {
          id: true,
          quantity: true,
          buyerPid: true,
          supplierPid: true,
          gtin: true,
          warehouseMarkedShippedAt: true,
        },
      },
    },
  });

  const [delrShipmentIds, existingItems] = await Promise.all([
    loadDelrShipmentIdsForOrders(orderDbIds, orderRefs),
    loadShipmentItemsForOrders(orderDbIds),
  ]);
  const coverage = computeShipmentCoverageForOrders(fullOrders, existingItems, delrShipmentIds);

  const stxLinks = orderRefs.length
    ? await prisma.stxPurchaseUnit.findMany({
        where: {
          galaxusOrderId: { in: orderRefs },
          gtin: { in: gtinCandidates },
        },
        select: {
          galaxusOrderId: true,
          stockxOrderNumber: true,
          awb: true,
          etaMin: true,
          etaMax: true,
          cancelledAt: true,
        },
      })
    : [];
  const stxByOrder = new Map<string, typeof stxLinks>();
  for (const link of stxLinks) {
    const arr = stxByOrder.get(link.galaxusOrderId) ?? [];
    arr.push(link);
    stxByOrder.set(link.galaxusOrderId, arr);
  }

  return lines.map((line) => {
    const order = line.order;
    const orderShipments = order.shipments ?? [];
    const orderStx = stxByOrder.get(order.galaxusOrderId) ?? [];
    const deliveryType = String(order.deliveryType ?? "").toLowerCase();
    const lineCoverage = coverage[line.id];
    const ordered = Number(lineCoverage?.ordered ?? line.quantity ?? 0);
    const shipped = Number(lineCoverage?.shipped ?? 0);
    const reserved = Number(lineCoverage?.reserved ?? 0);
    const remaining = Math.max(
      0,
      Number(lineCoverage?.remaining ?? Math.max(0, ordered - shipped - reserved))
    );
    return {
      channel: "galaxus" as const,
      lineId: line.id,
      lineNumber: line.lineNumber,
      productName: line.productName ?? null,
      quantity: line.quantity,
      ordered,
      shipped,
      reserved,
      remaining,
      warehouseMarkedShippedAt: line.warehouseMarkedShippedAt
        ? line.warehouseMarkedShippedAt.toISOString()
        : null,
      galaxusOrderDbId: order.id,
      galaxusOrderId: order.galaxusOrderId,
      orderNumber: order.orderNumber,
      orderDate: order.orderDate.toISOString(),
      deliveryType: order.deliveryType,
      isDirectDelivery: deliveryType === "direct_delivery",
      physicalDeliveryNoteRequired: Boolean(order.physicalDeliveryNoteRequired),
      ordrSentAt: order.ordrSentAt ? order.ordrSentAt.toISOString() : null,
      cancelledAt: order.cancelledAt ? order.cancelledAt.toISOString() : null,
      recipient: galaxusScanDisplayRecipient(order),
      shipments: orderShipments.map((s) => ({
        id: s.id,
        trackingNumber: s.trackingNumber,
        status: s.status,
        deliveryType: s.deliveryType,
        packageType: s.packageType,
        shippedAt: s.shippedAt ? s.shippedAt.toISOString() : null,
        delrStatus: s.delrStatus,
      })),
      stockxLinks: orderStx.map((l) => ({
        stockxOrderNumber: l.stockxOrderNumber,
        awb: l.awb,
        etaMin: l.etaMin ? l.etaMin.toISOString() : null,
        etaMax: l.etaMax ? l.etaMax.toISOString() : null,
        cancelledAt: l.cancelledAt ? l.cancelledAt.toISOString() : null,
      })),
      hasAnyShipment: orderShipments.length > 0,
      hasStockxLink: orderStx.some((l) => !l.cancelledAt),
    };
  });
}

async function loadShopifyGtinOrders(gtinCandidates: string[]): Promise<GtinOrderRow[]> {
  const expandedGtins = expandGtinCandidates(gtinCandidates);
  const skus = await resolveShopifySkusForGtinCandidates(gtinCandidates);
  if (skus.length === 0 && expandedGtins.length === 0) return [];

  // Primary: live Admin open lines (includes Website-stock dropship with no OrderMatch).
  const liveLines =
    skus.length > 0
      ? await searchLiveOpenShopifyLinesBySkus({ skus, take: 40 }).catch((err) => {
          console.warn(
            "[gtinFallback] live Shopify SKU search failed:",
            err instanceof Error ? err.message : err
          );
          return [] as Awaited<ReturnType<typeof searchLiveOpenShopifyLinesBySkus>>;
        })
      : [];

  const rowsByLineId = new Map<string, GtinOrderRow>();
  for (const live of liveLines) {
    const lineId = live.shopifyLineItemId;
    if (!lineId || rowsByLineId.has(lineId)) continue;
    rowsByLineId.set(lineId, {
      channel: "shopify",
      // Prefer line-item id so fulfill works without an OrderMatch row.
      lineId,
      lineNumber: null,
      productName: live.productTitle ?? null,
      quantity: live.remainingQuantity,
      ordered: live.remainingQuantity,
      shipped: 0,
      reserved: 0,
      remaining: live.remainingQuantity,
      warehouseMarkedShippedAt: null,
      orderDate: live.createdAt,
      orderNumber: live.shopifyOrderName,
      cancelledAt: null,
      recipient: {
        name: live.customerName,
        city: null,
        postalCode: null,
        countryCode: null,
      },
      shopifyOrderId: live.shopifyOrderId,
      shopifyOrderName: live.shopifyOrderName,
      shopifyLineItemId: live.shopifyLineItemId,
      shopifySku: live.shopifySku,
      hasAnyShipment: false,
      hasStockxLink: false,
    });
  }

  // Secondary: OrderMatch hints (local lot GTIN join + linked dropship) for anything
  // live search missed — still verified against fulfillment records / freshness.
  const matchOr: Array<Record<string, unknown>> = [];
  if (skus.length > 0) {
    matchOr.push({ shopifySku: { in: skus } });
  }
  if (expandedGtins.length > 0) {
    matchOr.push({ localStockLot: { gtin: { in: expandedGtins } } });
  }
  if (matchOr.length > 0) {
    const matches = await prisma.orderMatch.findMany({
      where: {
        OR: matchOr as any,
        returnAppliedAt: null,
        shopifyCreatedAt: { gte: shopifyMatchMinCreatedAt() },
      },
      orderBy: [{ shopifyCreatedAt: "asc" }],
      take: 40,
      select: {
        id: true,
        shopifyOrderId: true,
        shopifyOrderName: true,
        shopifyLineItemId: true,
        shopifySku: true,
        shopifyProductTitle: true,
        shopifyCreatedAt: true,
        shopifyCustomerFirstName: true,
        shopifyCustomerLastName: true,
      },
    });

    if (matches.length > 0) {
      const orderIds = Array.from(new Set(matches.map((m) => m.shopifyOrderId)));
      const [fulfillmentRows, shopifyOrders] = await Promise.all([
        prisma.shopifyFulfillmentRecord.findMany({
          where: { shopifyOrderId: { in: orderIds } },
          select: { shopifyOrderId: true },
        }),
        prisma.shopifyOrder.findMany({
          where: { shopifyOrderId: { in: orderIds } },
          select: { shopifyOrderId: true, cancelledAt: true, orderName: true },
        }),
      ]);
      const fulfilledOrderIds = new Set(fulfillmentRows.map((r) => r.shopifyOrderId));
      const cancelledOrderIds = new Set(
        shopifyOrders.filter((o) => o.cancelledAt).map((o) => o.shopifyOrderId)
      );
      const orderNameById = new Map(shopifyOrders.map((o) => [o.shopifyOrderId, o.orderName]));

      for (const m of matches) {
        const lineItemId = String(m.shopifyLineItemId ?? "").trim();
        if (!lineItemId || rowsByLineId.has(lineItemId)) continue;
        if (!isShopifyOrderMatchFresh(m.shopifyCreatedAt)) continue;
        if (fulfilledOrderIds.has(m.shopifyOrderId)) continue;
        if (cancelledOrderIds.has(m.shopifyOrderId)) continue;
        const name = [m.shopifyCustomerFirstName, m.shopifyCustomerLastName]
          .map((x) => String(x ?? "").trim())
          .filter(Boolean)
          .join(" ");
        rowsByLineId.set(lineItemId, {
          channel: "shopify",
          lineId: lineItemId,
          lineNumber: null,
          productName: m.shopifyProductTitle ?? null,
          quantity: 1,
          ordered: 1,
          shipped: 0,
          reserved: 0,
          remaining: 1,
          warehouseMarkedShippedAt: null,
          orderDate: (m.shopifyCreatedAt ?? new Date(0)).toISOString(),
          orderNumber: m.shopifyOrderName ?? orderNameById.get(m.shopifyOrderId) ?? null,
          cancelledAt: null,
          recipient: {
            name: name || null,
            city: null,
            postalCode: null,
            countryCode: null,
          },
          shopifyOrderId: m.shopifyOrderId,
          shopifyOrderName: m.shopifyOrderName ?? orderNameById.get(m.shopifyOrderId) ?? null,
          shopifyLineItemId: lineItemId,
          shopifySku: m.shopifySku,
          hasAnyShipment: false,
          hasStockxLink: false,
        });
      }
    }
  }

  return Array.from(rowsByLineId.values()).sort((a, b) =>
    a.orderDate.localeCompare(b.orderDate)
  );
}

async function loadDecathlonGtinOrders(gtinCandidates: string[]): Promise<GtinOrderRow[]> {
  const lines = await prisma.decathlonOrderLine.findMany({
    where: {
      OR: [
        { gtin: { in: gtinCandidates } },
        { providerKey: { in: gtinCandidates.map((g) => `STX_${g}`) } },
      ],
      order: {
        NOT: { orderState: { in: Array.from(DECATHLON_TERMINAL_STATES) } },
      },
    },
    orderBy: [{ order: { orderDate: "asc" } }],
    take: 40,
    select: {
      id: true,
      orderLineId: true,
      lineNumber: true,
      productTitle: true,
      quantity: true,
      gtin: true,
      order: {
        select: {
          id: true,
          orderId: true,
          orderNumber: true,
          orderDate: true,
          orderState: true,
          recipientName: true,
          recipientCity: true,
          recipientPostalCode: true,
          recipientCountryCode: true,
          customerName: true,
          customerCity: true,
          customerPostalCode: true,
          customerCountryCode: true,
          shipments: {
            select: {
              id: true,
              trackingNumber: true,
              shippedAt: true,
              lines: { select: { orderLineId: true, quantity: true } },
            },
          },
        },
      },
    },
  });

  return lines.map((line) => {
    const order = line.order;
    const shipped = (order.shipments ?? []).reduce((sum, shipment) => {
      const qty = (shipment.lines ?? [])
        .filter((sl) => sl.orderLineId === line.id)
        .reduce((s, sl) => s + (Number(sl.quantity) || 0), 0);
      return sum + qty;
    }, 0);
    const ordered = Number(line.quantity ?? 0);
    const remaining = Math.max(0, ordered - shipped);
    const state = String(order.orderState ?? "").toUpperCase();
    const cancelled = DECATHLON_TERMINAL_STATES.has(state) && state.includes("CANCEL");
    const latestShipment =
      (order.shipments ?? [])
        .filter((s) =>
          (s.lines ?? []).some((sl) => sl.orderLineId === line.id && Number(sl.quantity) > 0)
        )
        .sort((a, b) => {
          const ta = a.shippedAt ? new Date(a.shippedAt).getTime() : 0;
          const tb = b.shippedAt ? new Date(b.shippedAt).getTime() : 0;
          return tb - ta;
        })[0] ?? null;
    return {
      channel: "decathlon" as const,
      lineId: line.id,
      lineNumber: line.lineNumber ?? null,
      productName: line.productTitle ?? null,
      quantity: ordered,
      ordered,
      shipped,
      reserved: 0,
      remaining: cancelled ? 0 : remaining,
      warehouseMarkedShippedAt: null,
      orderDate: order.orderDate.toISOString(),
      orderNumber: order.orderNumber,
      cancelledAt: cancelled ? new Date().toISOString() : null,
      recipient: {
        name: order.recipientName ?? order.customerName ?? null,
        city: order.recipientCity ?? order.customerCity ?? null,
        postalCode: order.recipientPostalCode ?? order.customerPostalCode ?? null,
        countryCode: order.recipientCountryCode ?? order.customerCountryCode ?? null,
      },
      decathlonOrderDbId: order.id,
      decathlonOrderId: order.orderId,
      decathlonOrderState: order.orderState ?? null,
      decathlonShipmentId: latestShipment?.id ?? null,
      hasAnyShipment: shipped > 0,
      hasStockxLink: false,
    };
  });
}

function isOpen(row: GtinOrderRow): boolean {
  return row.remaining > 0 && !row.cancelledAt;
}

function isAutoFulfillable(row: GtinOrderRow): boolean {
  if (!isOpen(row)) return false;
  if (row.channel === "shopify") return Boolean(row.shopifyLineItemId && row.shopifyOrderId);
  if (row.channel === "decathlon") return Boolean(row.decathlonOrderId && row.lineId);
  if (row.channel === "galaxus") return Boolean(row.isDirectDelivery && row.galaxusOrderDbId);
  return false;
}

function autoChannelOf(row: GtinOrderRow): GtinAutoChannel | null {
  if (row.channel === "shopify") return "shopify";
  if (row.channel === "decathlon") return "decathlon";
  if (row.channel === "galaxus" && row.isDirectDelivery) return "galaxus_direct";
  return null;
}

/**
 * Decide whether GTIN scan may auto-claim a fulfill channel.
 * Galaxus warehouse + direct ambiguity blocks auto **Galaxus direct** only —
 * Shopify/Decathlon FIFO must still win when they are the oldest open row.
 */
export function decideGtinAutoChannel(params: {
  openDirect: number;
  openWarehouse: number;
  autoRowChannel: GtinAutoChannel | null;
}): { autoChannel: GtinAutoChannel | null; requiresChannelChoice: boolean } {
  const galaxusWarehouseDirectConflict =
    params.openDirect > 0 && params.openWarehouse > 0;

  if (params.autoRowChannel === "shopify" || params.autoRowChannel === "decathlon") {
    return { autoChannel: params.autoRowChannel, requiresChannelChoice: false };
  }

  if (params.autoRowChannel === "galaxus_direct" && galaxusWarehouseDirectConflict) {
    return { autoChannel: null, requiresChannelChoice: true };
  }

  if (!params.autoRowChannel && galaxusWarehouseDirectConflict) {
    return { autoChannel: null, requiresChannelChoice: true };
  }

  return {
    autoChannel: params.autoRowChannel,
    requiresChannelChoice: false,
  };
}

const AUTO_FULFILL_CHANNEL_RANK: Record<GtinAutoChannel, number> = {
  shopify: 0,
  decathlon: 1,
  galaxus_direct: 2,
};

function compareOpenOrdersForAutoFulfill(a: GtinOrderRow, b: GtinOrderRow): number {
  const byDate = a.orderDate.localeCompare(b.orderDate);
  if (byDate !== 0) return byDate;
  const aCh = autoChannelOf(a);
  const bCh = autoChannelOf(b);
  if (aCh && bCh && aCh !== bCh) {
    return AUTO_FULFILL_CHANNEL_RANK[aCh] - AUTO_FULFILL_CHANNEL_RANK[bCh];
  }
  return 0;
}

/**
 * Parallel multi-channel GTIN lookup for /scan when no AWB hit.
 * Returns null when no lines found on any channel.
 */
export async function resolveGtinFallback(
  gtinCandidates: string[]
): Promise<GtinFallbackPayload | null> {
  if (gtinCandidates.length === 0) return null;

  const [galaxus, shopify, decathlon] = await Promise.all([
    loadGalaxusGtinOrders(gtinCandidates),
    loadShopifyGtinOrders(gtinCandidates),
    loadDecathlonGtinOrders(gtinCandidates),
  ]);

  const all = [...galaxus, ...shopify, ...decathlon];
  if (all.length === 0) return null;

  const openOrders = all.filter(isOpen).sort(compareOpenOrdersForAutoFulfill);
  const closedOrders = all
    .filter((o) => !isOpen(o))
    .sort((a, b) => a.orderDate.localeCompare(b.orderDate));
  const orderedList = [...openOrders, ...closedOrders];

  const openDirect = openOrders.filter(
    (o) => o.channel === "galaxus" && o.isDirectDelivery
  ).length;
  const openWarehouse = openOrders.filter(
    (o) => o.channel === "galaxus" && !o.isDirectDelivery
  ).length;
  const openShopify = openOrders.filter((o) => o.channel === "shopify").length;
  const openDecathlon = openOrders.filter((o) => o.channel === "decathlon").length;

  // Oldest fulfillable open row across Galaxus direct / Shopify / Decathlon.
  const autoRow = openOrders.find(isAutoFulfillable) ?? null;

  const autoDirectOrder =
    autoRow?.channel === "galaxus" && autoRow.isDirectDelivery
      ? autoRow
      : openOrders.find((o) => o.channel === "galaxus" && o.isDirectDelivery) ?? null;
  const autoShopifyRow =
    autoRow?.channel === "shopify" && autoRow.shopifyLineItemId
      ? autoRow
      : openOrders.find((o) => o.channel === "shopify" && o.shopifyLineItemId) ?? null;
  const autoDecathlonRow =
    autoRow?.channel === "decathlon" && autoRow.decathlonOrderId
      ? autoRow
      : openOrders.find((o) => o.channel === "decathlon" && o.decathlonOrderId) ?? null;
  const { autoChannel, requiresChannelChoice } = decideGtinAutoChannel({
    openDirect,
    openWarehouse,
    autoRowChannel: autoRow ? autoChannelOf(autoRow) : null,
  });

  // Reprint pointer: latest Decathlon shipment for this GTIN when nothing left to ship.
  const shippedDecathlon = orderedList
    .filter(
      (o) =>
        o.channel === "decathlon" &&
        o.decathlonOrderId &&
        (o.hasAnyShipment || o.shipped > 0)
    )
    .sort((a, b) => b.orderDate.localeCompare(a.orderDate));
  const reprintRow = !autoDecathlonRow ? shippedDecathlon[0] ?? null : null;

  const autoDirectOrderDbId = autoDirectOrder?.galaxusOrderDbId ?? null;
  const autoDirectLineId = autoDirectOrder?.lineId ?? null;
  const directOpen =
    autoDirectOrderDbId
      ? await listGalaxusDirectOpenUnits({
          orderDbId: autoDirectOrderDbId,
          scannedLineId: autoDirectLineId,
        }).catch(() => null)
      : null;

  let autoShopifyPayload: GtinFallbackPayload["autoShopify"] = null;
  if (autoShopifyRow?.shopifyLineItemId && autoShopifyRow.shopifyOrderId) {
    autoShopifyPayload = {
      shopifyOrderId: autoShopifyRow.shopifyOrderId,
      shopifyOrderName: autoShopifyRow.shopifyOrderName ?? null,
      shopifyLineItemId: autoShopifyRow.shopifyLineItemId,
    };
    if (autoChannel === "shopify") {
      try {
        const [orderInfo, fulfillmentMap] = await Promise.all([
          fetchOrderShippingInfo(autoShopifyRow.shopifyOrderId),
          fetchOrderFulfillmentMap(autoShopifyRow.shopifyOrderId),
        ]);
        if (orderInfo?.lineItems?.nodes && fulfillmentMap.order) {
          const lineId = autoShopifyRow.shopifyLineItemId;
          const openUnits = listAllOpenUnits({
            orderLineItems: orderInfo.lineItems.nodes,
            fulfillmentOrders: fulfillmentMap.order.fulfillmentOrders.nodes,
          }).map((u) => ({
            lineItemId: u.lineItemId,
            title: u.title,
            remainingQuantity: u.remainingQuantity,
            isScannedLine: u.lineItemId === lineId,
          }));
          autoShopifyPayload = {
            ...autoShopifyPayload,
            openUnits,
            unitSelection: decideFulfillUnitSelection(
              openUnits.map((u) => ({
                lineItemId: u.lineItemId,
                title: u.title,
                variantTitle: null,
                sku: null,
                remainingQuantity: u.remainingQuantity,
                isScannedLine: u.isScannedLine,
              }))
            ),
          };
        }
      } catch {
        // Fulfill path will re-fetch; scan may still prompt on client.
      }
    }
  }

  return {
    gtin: gtinCandidates[0],
    productName: orderedList.find((o) => o.productName)?.productName ?? null,
    totalOpen: openOrders.length,
    openDirect,
    openWarehouse,
    openShopify,
    openDecathlon,
    autoDirectOrderDbId,
    autoDirectLineId,
    autoDirectRemaining: Math.max(0, Number(autoDirectOrder?.remaining ?? 0)),
    autoDirectOpenUnits: directOpen?.openUnits ?? [],
    autoDirectUnitSelection: directOpen?.unitSelection ?? null,
    autoShopify: autoShopifyPayload,
    autoDecathlon:
      autoDecathlonRow?.decathlonOrderId && autoDecathlonRow.lineId
        ? {
            orderId: autoDecathlonRow.decathlonOrderId,
            orderDbId: autoDecathlonRow.decathlonOrderDbId ?? "",
            lineId: autoDecathlonRow.lineId,
            quantity: Math.max(1, autoDecathlonRow.remaining || 1),
          }
        : null,
    autoDecathlonReprint:
      reprintRow?.decathlonOrderId
        ? {
            orderId: reprintRow.decathlonOrderId,
            orderDbId: reprintRow.decathlonOrderDbId ?? "",
            shipmentId: reprintRow.decathlonShipmentId ?? null,
          }
        : null,
    autoChannel,
    requiresChannelChoice,
    orders: orderedList,
  };
}
