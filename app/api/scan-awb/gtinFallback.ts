import { prisma } from "@/app/lib/prisma";
import { normalizeSize } from "@/app/lib/normalize";
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
import type { UnitSelectionDecision } from "@/lib/shopifyFulfillUnitSelection";
import {
  discoverOpenShopifyOrderHintsBySku,
  loadExistingOrderMatchLinks,
  loadLiveOpenShopifyLines,
} from "@/app/lib/shopifyOpenLineCandidates";
import {
  sizesCompatible,
  skuEquals,
  type OpenShopifyLineCandidate,
} from "@/app/lib/shopifyAwbFallback";

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
  shopifySizeEU?: string | null;
  /** Shared style SKU and size could not be confirmed → show, never auto-fulfill. */
  shopifySizeUnverified?: boolean;
  /** Open Shopify line with no OrderMatch yet — operator tap links it (never auto). */
  shopifyNeedsLink?: boolean;
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
      recipient: {
        name: order.recipientName,
        city: order.recipientCity,
        postalCode: order.recipientPostalCode,
        countryCode: order.recipientCountryCode,
      },
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

export function sizeKeyForGtinMatch(value: string | null | undefined): string | null {
  const n = normalizeSize(value);
  if (!n) return null;
  const key = n.replace(/^EU/, "");
  return key || null;
}

/**
 * Shopify SKU is sometimes a style code shared by every size variant. A GTIN
 * resolves one size, so OrderMatch rows on a shared SKU must match that size.
 * Unknown size on either side → keep row but never auto-fulfill it.
 */
export function filterShopifyMatchesByScannedSize<
  T extends { shopifySku: string | null; shopifySizeEU: string | null },
>(
  matches: T[],
  params: { sharedSkus: Set<string>; scannedSizeKeys: Set<string> }
): Array<T & { sizeUnverified: boolean }> {
  const out: Array<T & { sizeUnverified: boolean }> = [];
  for (const m of matches) {
    const sku = String(m.shopifySku ?? "").trim();
    if (!params.sharedSkus.has(sku)) {
      out.push({ ...m, sizeUnverified: false });
      continue;
    }
    const matchKey = sizeKeyForGtinMatch(m.shopifySizeEU);
    if (params.scannedSizeKeys.size === 0 || !matchKey) {
      out.push({ ...m, sizeUnverified: true });
      continue;
    }
    if (params.scannedSizeKeys.has(matchKey)) {
      out.push({ ...m, sizeUnverified: false });
    }
  }
  return out;
}

/**
 * Live open Shopify lines (no OrderMatch) found by SKU for a scanned GTIN.
 * - exact variant SKU from the GTIN, SKU unique to one variant → size implied
 * - exact SKU shared by several sizes, or catalog style SKU → size must match
 *   the GTIN size; unknown size → kept but unverified (never auto)
 * - mismatching size → dropped
 */
export function classifyDiscoveredGtinLines(
  lines: OpenShopifyLineCandidate[],
  params: {
    exactSkus: Set<string>;
    sharedSkus: Set<string>;
    styleSkus: Set<string>;
    scannedSizes: string[];
  }
): Array<OpenShopifyLineCandidate & { sizeUnverified: boolean }> {
  const upper = (s: string | null | undefined) => String(s ?? "").trim().toUpperCase();
  const exact = new Set(Array.from(params.exactSkus).map(upper));
  const shared = new Set(Array.from(params.sharedSkus).map(upper));
  const out: Array<OpenShopifyLineCandidate & { sizeUnverified: boolean }> = [];
  for (const line of lines) {
    const sku = upper(line.shopifySku);
    const isExact = exact.has(sku);
    const isStyle =
      !isExact && Array.from(params.styleSkus).some((s) => skuEquals(s, line.shopifySku));
    if (!isExact && !isStyle) continue;
    if (isExact && !shared.has(sku)) {
      out.push({ ...line, sizeUnverified: false });
      continue;
    }
    if (params.scannedSizes.length === 0 || (!line.shopifySizeEU && !line.shopifySku)) {
      out.push({ ...line, sizeUnverified: true });
      continue;
    }
    const sizeOk = params.scannedSizes.some((s) =>
      sizesCompatible(s, line.shopifySizeEU, line.shopifySku, line.shopifyProductTitle)
    );
    if (sizeOk) out.push({ ...line, sizeUnverified: false });
  }
  return out;
}

async function discoverUnmatchedShopifyGtinRows(params: {
  exactSkus: Set<string>;
  sharedSkus: Set<string>;
  styleSkus: Set<string>;
  scannedSizes: string[];
}): Promise<GtinOrderRow[]> {
  const searchSkus = [...params.exactSkus, ...params.styleSkus];
  if (searchSkus.length === 0) return [];
  const hints = await discoverOpenShopifyOrderHintsBySku({ skus: searchSkus });
  if (hints.length === 0) return [];
  const live = await loadLiveOpenShopifyLines({
    hints,
    acceptSku: (sku) => Boolean(sku) && searchSkus.some((s) => skuEquals(s, sku)),
  });
  const classified = classifyDiscoveredGtinLines(live, params);
  if (classified.length === 0) return [];
  // "No pre-existing match": any OrderMatch row already covers the line.
  const existing = await loadExistingOrderMatchLinks(
    classified.map((l) => l.shopifyLineItemId)
  );
  const linked = new Set(existing.map((e) => e.shopifyLineItemId));
  return classified
    .filter((l) => !linked.has(l.shopifyLineItemId))
    .map((l) => ({
      channel: "shopify" as const,
      lineId: l.shopifyLineItemId,
      lineNumber: null,
      productName: l.shopifyProductTitle ?? null,
      quantity: l.remainingQuantity,
      ordered: l.remainingQuantity,
      shipped: 0,
      reserved: 0,
      remaining: l.remainingQuantity,
      warehouseMarkedShippedAt: null,
      orderDate: new Date(l.shopifyCreatedAt).toISOString(),
      orderNumber: l.shopifyOrderName ?? null,
      cancelledAt: null,
      recipient: { name: null, city: null, postalCode: null, countryCode: null },
      shopifyOrderId: l.shopifyOrderId,
      shopifyOrderName: l.shopifyOrderName ?? null,
      shopifyLineItemId: l.shopifyLineItemId,
      shopifySku: l.shopifySku,
      shopifySizeEU: l.shopifySizeEU,
      shopifySizeUnverified: l.sizeUnverified,
      shopifyNeedsLink: true,
      hasAnyShipment: false,
      hasStockxLink: false,
    }));
}

async function loadShopifyGtinOrders(gtinCandidates: string[]): Promise<GtinOrderRow[]> {
  const [skuRows, supplierRows] = await Promise.all([
    prisma.shopifyVariantLocationStock.findMany({
      where: { gtin: { in: gtinCandidates }, sku: { not: null } },
      select: { sku: true, gtin: true },
      take: 40,
    }),
    prisma.supplierVariant.findMany({
      where: { gtin: { in: gtinCandidates } },
      select: { supplierSku: true, sizeRaw: true, sizeNormalized: true },
      take: 20,
    }),
  ]);
  const shopifyGtinSkus = new Set(
    skuRows.map((r) => String(r.sku ?? "").trim()).filter(Boolean)
  );
  // Partner/catalog barcodes (e.g. NER 2000…) are not on the Shopify variant;
  // reach the order via supplierSku, always size-checked below.
  const supplierOnlySkus = new Set(
    supplierRows
      .flatMap((r) => {
        const s = String(r.supplierSku ?? "").trim();
        return [s, s.toUpperCase()];
      })
      .filter((s) => s && !shopifyGtinSkus.has(s))
  );
  const skus = Array.from(new Set([...shopifyGtinSkus, ...supplierOnlySkus]));
  if (skus.length === 0) return [];

  const scannedSizeKeys = new Set(
    supplierRows
      .map((r) => sizeKeyForGtinMatch(r.sizeNormalized ?? r.sizeRaw))
      .filter((k): k is string => Boolean(k))
  );
  const skuVariants = shopifyGtinSkus.size
    ? await prisma.shopifyVariantLocationStock.findMany({
        where: { sku: { in: Array.from(shopifyGtinSkus) } },
        select: { sku: true, shopifyVariantId: true },
        distinct: ["shopifyVariantId"],
        take: 200,
      })
    : [];
  const variantsBySku = new Map<string, Set<string>>();
  for (const v of skuVariants) {
    const sku = String(v.sku ?? "").trim();
    if (!sku) continue;
    const set = variantsBySku.get(sku) ?? new Set<string>();
    set.add(v.shopifyVariantId);
    variantsBySku.set(sku, set);
  }
  const sharedSkus = new Set<string>(supplierOnlySkus);
  for (const [sku, variants] of variantsBySku) {
    if (variants.size > 1) sharedSkus.add(sku);
  }

  const rawMatches = await prisma.orderMatch.findMany({
    where: {
      shopifySku: { in: skus },
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
      shopifySizeEU: true,
      shopifyProductTitle: true,
      shopifyCreatedAt: true,
      shopifyCustomerFirstName: true,
      shopifyCustomerLastName: true,
    },
  });
  const matches = filterShopifyMatchesByScannedSize(rawMatches, {
    sharedSkus,
    scannedSizeKeys,
  });
  const discovered = await discoverUnmatchedShopifyGtinRows({
    exactSkus: shopifyGtinSkus,
    sharedSkus,
    styleSkus: supplierOnlySkus,
    scannedSizes: Array.from(
      new Set(
        supplierRows
          .map((r) => String(r.sizeNormalized ?? r.sizeRaw ?? "").trim())
          .filter(Boolean)
      )
    ),
  }).catch((err) => {
    console.warn("[GTIN-FALLBACK] Shopify discovery failed", err?.message || err);
    return [] as GtinOrderRow[];
  });
  if (matches.length === 0) return discovered;

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

  // Deduplicate by OrderMatch.id (location-stock join can duplicate).
  const seen = new Set<string>();
  const rows: GtinOrderRow[] = [];
  for (const m of matches) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    // Belt: drop ancient rows even if DB filter missed null createdAt.
    if (!isShopifyOrderMatchFresh(m.shopifyCreatedAt)) continue;
    const cancelled = cancelledOrderIds.has(m.shopifyOrderId);
    const alreadyFulfilled = fulfilledOrderIds.has(m.shopifyOrderId);
    // Never surface fulfilled Shopify orders in GTIN match list / auto-fulfill.
    if (alreadyFulfilled) continue;
    const remaining = cancelled ? 0 : 1;
    const name = [m.shopifyCustomerFirstName, m.shopifyCustomerLastName]
      .map((x) => String(x ?? "").trim())
      .filter(Boolean)
      .join(" ");
    rows.push({
      channel: "shopify",
      lineId: m.id,
      lineNumber: null,
      productName: m.shopifyProductTitle ?? null,
      quantity: 1,
      ordered: 1,
      shipped: 0,
      reserved: 0,
      remaining,
      warehouseMarkedShippedAt: null,
      orderDate: (m.shopifyCreatedAt ?? new Date(0)).toISOString(),
      orderNumber: m.shopifyOrderName ?? orderNameById.get(m.shopifyOrderId) ?? null,
      cancelledAt: cancelled ? new Date().toISOString() : null,
      recipient: {
        name: name || null,
        city: null,
        postalCode: null,
        countryCode: null,
      },
      shopifyOrderId: m.shopifyOrderId,
      shopifyOrderName: m.shopifyOrderName ?? orderNameById.get(m.shopifyOrderId) ?? null,
      shopifyLineItemId: m.shopifyLineItemId,
      shopifySku: m.shopifySku,
      shopifySizeEU: m.shopifySizeEU,
      shopifySizeUnverified: m.sizeUnverified,
      hasAnyShipment: false,
      hasStockxLink: false,
    });
  }
  const seenLines = new Set(rows.map((r) => r.shopifyLineItemId));
  return [...rows, ...discovered.filter((d) => !seenLines.has(d.shopifyLineItemId))];
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
  if (row.channel === "shopify") {
    return Boolean(
      row.shopifyLineItemId &&
        row.shopifyOrderId &&
        !row.shopifySizeUnverified &&
        !row.shopifyNeedsLink
    );
  }
  if (row.channel === "decathlon") return Boolean(row.decathlonOrderId && row.lineId);
  if (row.channel === "galaxus") return Boolean(row.isDirectDelivery && row.galaxusOrderDbId);
  return false;
}

/**
 * Oldest open row that could claim this unit. If it is an unlinked Shopify
 * order (needs tap), nothing is auto-claimed — a newer order must not win.
 */
export function pickGtinAutoRow(openOrdersOldestFirst: GtinOrderRow[]): GtinOrderRow | null {
  const oldest =
    openOrdersOldestFirst.find(
      (r) =>
        isAutoFulfillable(r) ||
        (r.channel === "shopify" && r.shopifyNeedsLink && !r.shopifySizeUnverified && isOpen(r))
    ) ?? null;
  return oldest && isAutoFulfillable(oldest) ? oldest : null;
}

function autoChannelOf(row: GtinOrderRow): GtinAutoChannel | null {
  if (row.channel === "shopify") return "shopify";
  if (row.channel === "decathlon") return "decathlon";
  if (row.channel === "galaxus" && row.isDirectDelivery) return "galaxus_direct";
  return null;
}

/**
 * Decide whether GTIN scan may auto-claim a fulfill channel.
 * When the same GTIN is open on warehouse AND direct, never auto — one physical
 * unit cannot pack into a warehouse box and also ship as direct.
 */
export function decideGtinAutoChannel(params: {
  openDirect: number;
  openWarehouse: number;
  autoRowChannel: GtinAutoChannel | null;
}): { autoChannel: GtinAutoChannel | null; requiresChannelChoice: boolean } {
  const requiresChannelChoice =
    params.openDirect > 0 && params.openWarehouse > 0;
  if (requiresChannelChoice) {
    return { autoChannel: null, requiresChannelChoice: true };
  }
  return {
    autoChannel: params.autoRowChannel,
    requiresChannelChoice: false,
  };
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

  const openOrders = all.filter(isOpen).sort((a, b) => a.orderDate.localeCompare(b.orderDate));
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

  const autoDirectOrder =
    openOrders.find((o) => o.channel === "galaxus" && o.isDirectDelivery) ?? null;
  // FIFO: an older unlinked Shopify order (needs operator tap) blocks auto on a newer one.
  const oldestVerifiedShopify =
    openOrders.find(
      (o) => o.channel === "shopify" && o.shopifyLineItemId && !o.shopifySizeUnverified
    ) ?? null;
  const autoShopifyRow =
    oldestVerifiedShopify && !oldestVerifiedShopify.shopifyNeedsLink
      ? oldestVerifiedShopify
      : null;
  const autoDecathlonRow =
    openOrders.find((o) => o.channel === "decathlon" && o.decathlonOrderId) ?? null;

  // Oldest fulfillable open row across Galaxus direct / Shopify / Decathlon.
  const autoRow = pickGtinAutoRow(openOrders);
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
    autoShopify:
      autoShopifyRow?.shopifyLineItemId && autoShopifyRow.shopifyOrderId
        ? {
            shopifyOrderId: autoShopifyRow.shopifyOrderId,
            shopifyOrderName: autoShopifyRow.shopifyOrderName ?? null,
            shopifyLineItemId: autoShopifyRow.shopifyLineItemId,
          }
        : null,
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
