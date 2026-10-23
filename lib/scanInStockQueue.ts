import { prisma } from "@/app/lib/prisma";
import {
  computeShipmentCoverageForOrders,
  loadDelrShipmentIdsForOrders,
  loadShipmentItemsForOrders,
} from "@/galaxus/warehouse/shipmentLineCoverage";
import { expandGtinsForDbLookup } from "@/galaxus/stx/purchaseUnits";
import { isLocalOrManualStockxRef } from "@/galaxus/orders/localStockMatch";
import { shopifyMatchMinCreatedAt } from "@/app/lib/shopifyMatchEligibility";
import { galaxusScanDisplayRecipient } from "@/lib/swissPostRecipient";
import { cleanGtin } from "@/shopify/restock/gtinNormalize";

export type InStockShipChannel = "galaxus_direct" | "galaxus_warehouse" | "shopify";

export type InStockShipItem = {
  id: string;
  channel: InStockShipChannel;
  orderDbId: string;
  orderLabel: string;
  lineId: string;
  gtin: string;
  productName: string;
  size: string | null;
  remaining: number;
  stockQty: number;
  locationName: string;
  customerName: string | null;
  orderDate: string;
  localMatch: boolean;
};

const MAX_ITEMS = 80;

function text(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s || null;
}

function gtinNorm(raw: string): string {
  const clean = cleanGtin(raw) || String(raw ?? "").trim();
  return clean.replace(/^0+/, "") || "0";
}

type PhysRow = { gtin: string; qty: number; locationName: string };

/**
 * Open sales that still need shipping from our WH / magasin stock.
 * Includes:
 * - Galaxus LOCAL_STOCK / MANUAL (mirror qty often already 0 after sale)
 * - Galaxus lines whose GTIN still has mirror qty > 0
 * - Shopify PHYSICAL_STOCK / LOCAL / Essentials
 */
export async function listInStockShipQueue(): Promise<InStockShipItem[]> {
  const physical = await loadPhysicalRows();
  const byNorm = new Map<string, PhysRow>();
  for (const row of physical) {
    const norm = gtinNorm(row.gtin);
    const prev = byNorm.get(norm);
    if (!prev || row.qty > prev.qty) byNorm.set(norm, row);
  }

  const gtinCandidates = Array.from(
    new Set(physical.flatMap((r) => expandGtinsForDbLookup([r.gtin])))
  );

  const [galaxusLocal, galaxusMirror, shopifyItems] = await Promise.all([
    listGalaxusShipFromStock(),
    listGalaxusForPhysicalGtins(gtinCandidates, byNorm),
    listShopifyShipFromStock(),
  ]);

  // Deduplicate by line (local path wins over mirror-only).
  const byKey = new Map<string, InStockShipItem>();
  for (const item of [...galaxusMirror, ...galaxusLocal, ...shopifyItems]) {
    const key = `${item.channel}:${item.lineId}`;
    const prev = byKey.get(key);
    if (!prev || (item.localMatch && !prev.localMatch)) byKey.set(key, item);
  }

  // Newest first. Galaxus local/WH before Shopify essentials backlog.
  const rank = (item: InStockShipItem): number => {
    if (item.channel.startsWith("galaxus") && item.localMatch) return 0;
    if (item.channel.startsWith("galaxus")) return 1;
    if (/stock physique|bussigny|antica|lab|cold/i.test(item.locationName)) return 2;
    if (item.localMatch) return 3;
    return 4;
  };
  return Array.from(byKey.values())
    .sort((a, b) => {
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      return b.orderDate.localeCompare(a.orderDate);
    })
    .slice(0, MAX_ITEMS);
}

async function loadPhysicalRows(): Promise<PhysRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{ gtin: string; qty: bigint; locationName: string | null }>
  >`
    SELECT
      s."gtin" AS gtin,
      SUM(s."available")::bigint AS qty,
      (ARRAY_AGG(s."locationName" ORDER BY s."priority" ASC))[1] AS "locationName"
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."sourceType" = 'physical'
      AND s."available" > 0
      AND s."gtin" IS NOT NULL
      AND TRIM(s."gtin") <> ''
    GROUP BY s."gtin"
  `;
  return rows
    .map((r) => ({
      gtin: String(r.gtin ?? "").trim(),
      qty: Number(r.qty ?? 0),
      locationName: text(r.locationName) ?? "Magasin",
    }))
    .filter((r) => r.gtin && r.qty > 0);
}

/**
 * Galaxus sales already linked as LOCAL_STOCK / MANUAL / PHYSICAL_STOCK.
 * Same as Shopify: mirror qty is often 0 after the sale — still show for scan.
 */
async function listGalaxusShipFromStock(): Promise<InStockShipItem[]> {
  const matches = await (prisma as any).galaxusStockxMatch.findMany({
    where: {
      OR: [
        { matchType: { in: ["LOCAL_STOCK", "MANUAL"] } },
        { stockxStatus: { in: ["LOCAL_STOCK", "PHYSICAL_STOCK", "MANUAL"] } },
        { stockxOrderNumber: { startsWith: "LOCAL-STOCK-" } },
        { stockxOrderNumber: { startsWith: "MANUAL-" } },
      ],
      order: { cancelledAt: null, archivedAt: null },
      orderLine: { warehouseMarkedShippedAt: null },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      matchType: true,
      stockxStatus: true,
      stockxOrderNumber: true,
      galaxusGtin: true,
      galaxusProductName: true,
      galaxusSize: true,
      order: {
        select: {
          id: true,
          galaxusOrderId: true,
          orderNumber: true,
          orderDate: true,
          deliveryType: true,
          recipientName: true,
          customerName: true,
          referencePerson: true,
          recipientCity: true,
          recipientPostalCode: true,
          recipientCountryCode: true,
          customerCity: true,
          customerPostalCode: true,
          customerCountryCode: true,
        },
      },
      orderLine: {
        select: {
          id: true,
          gtin: true,
          productName: true,
          size: true,
          quantity: true,
          buyerPid: true,
          supplierPid: true,
        },
      },
    },
  });

  if (!matches.length) return [];

  const orderDbIds = Array.from(new Set(matches.map((m: any) => String(m.order.id))));
  const orderRefs = Array.from(new Set(matches.map((m: any) => String(m.order.galaxusOrderId))));
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

  const gtins = matches
    .map((m: any) => text(m.orderLine?.gtin) ?? text(m.galaxusGtin))
    .filter((g: string | null): g is string => Boolean(g));
  const locationByNorm = await loadPhysicalLocationByGtin(gtins);

  const out: InStockShipItem[] = [];
  const seenLines = new Set<string>();
  for (const m of matches) {
    const line = m.orderLine;
    if (!line) continue;
    const lineId = String(line.id);
    if (seenLines.has(lineId)) continue;
    const rem = Math.max(0, Number(coverage[lineId]?.remaining ?? 0));
    if (rem <= 0) continue;
    seenLines.add(lineId);

    const gtin = text(line.gtin) ?? text(m.galaxusGtin);
    if (!gtin) continue;

    const loc = locationByNorm.get(gtinNorm(gtin));
    const deliveryType = String(m.order?.deliveryType ?? "").toLowerCase();
    const channel: InStockShipChannel =
      deliveryType === "direct_delivery" ? "galaxus_direct" : "galaxus_warehouse";
    const recipient = galaxusScanDisplayRecipient(m.order as any);

    out.push({
      id: `gx-local:${lineId}`,
      channel,
      orderDbId: String(m.order.id),
      orderLabel: text(m.order.orderNumber) ?? String(m.order.galaxusOrderId),
      lineId,
      gtin,
      productName: text(line.productName) ?? text(m.galaxusProductName) ?? "Item",
      size: text(line.size) ?? text(m.galaxusSize),
      remaining: rem,
      stockQty: Math.max(1, Number(loc?.qty ?? 0)),
      locationName: text(loc?.locationName) ?? "Stock local Galaxus",
      customerName: text(recipient?.name) ?? text(m.order.referencePerson),
      orderDate: new Date(m.order.orderDate).toISOString(),
      localMatch: true,
    });
  }
  return out;
}

/** Location hint even when available=0 (post-sale mirror). */
async function loadPhysicalLocationByGtin(
  gtins: string[]
): Promise<Map<string, PhysRow>> {
  const out = new Map<string, PhysRow>();
  const candidates = Array.from(new Set(gtins.flatMap((g) => expandGtinsForDbLookup([g]))));
  if (candidates.length === 0) return out;

  const rows = await prisma.$queryRaw<
    Array<{ gtin: string; qty: bigint; locationName: string | null }>
  >`
    SELECT
      s."gtin" AS gtin,
      SUM(s."available")::bigint AS qty,
      (ARRAY_AGG(s."locationName" ORDER BY s."priority" ASC))[1] AS "locationName"
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."sourceType" = 'physical'
      AND s."gtin" = ANY(${candidates}::text[])
    GROUP BY s."gtin"
  `;
  for (const r of rows) {
    const gtin = String(r.gtin ?? "").trim();
    if (!gtin) continue;
    const row: PhysRow = {
      gtin,
      qty: Math.max(0, Number(r.qty ?? 0)),
      locationName: text(r.locationName) ?? "Magasin",
    };
    const norm = gtinNorm(gtin);
    const prev = out.get(norm);
    if (!prev || row.qty > prev.qty) out.set(norm, row);
  }
  return out;
}

async function listGalaxusForPhysicalGtins(
  gtinCandidates: string[],
  physicalByNorm: Map<string, PhysRow>
): Promise<InStockShipItem[]> {
  if (gtinCandidates.length === 0) return [];

  const lines = await prisma.galaxusOrderLine.findMany({
    where: {
      gtin: { in: gtinCandidates },
      warehouseMarkedShippedAt: null,
      order: {
        cancelledAt: null,
        archivedAt: null,
        deliveryType: { in: ["direct_delivery", "warehouse_delivery"] },
      },
    },
    orderBy: [{ order: { orderDate: "asc" } }, { order: { createdAt: "asc" } }],
    take: 200,
    select: {
      id: true,
      lineNumber: true,
      productName: true,
      size: true,
      gtin: true,
      quantity: true,
      buyerPid: true,
      supplierPid: true,
      stockxMatches: {
        orderBy: { unitIndex: "asc" },
        take: 1,
        select: {
          stockxOrderNumber: true,
          matchType: true,
          stockxStatus: true,
        },
      },
      order: {
        select: {
          id: true,
          galaxusOrderId: true,
          orderNumber: true,
          orderDate: true,
          deliveryType: true,
          recipientName: true,
          customerName: true,
          referencePerson: true,
          recipientCity: true,
          recipientPostalCode: true,
          recipientCountryCode: true,
          customerCity: true,
          customerPostalCode: true,
          customerCountryCode: true,
        },
      },
    },
  });

  if (lines.length === 0) return [];

  const orderDbIds = Array.from(new Set(lines.map((l) => l.order.id)));
  const orderRefs = Array.from(new Set(lines.map((l) => l.order.galaxusOrderId)));
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

  const out: InStockShipItem[] = [];
  for (const line of lines) {
    const gtin = text(line.gtin);
    if (!gtin) continue;
    const rem = Math.max(0, Number(coverage[line.id]?.remaining ?? 0));
    if (rem <= 0) continue;

    const phys = physicalByNorm.get(gtinNorm(gtin));
    if (!phys || phys.qty <= 0) continue;

    const match = line.stockxMatches[0] ?? null;
    const localMatch =
      Boolean(match) &&
      (String(match?.matchType ?? "").toUpperCase() === "LOCAL_STOCK" ||
        String(match?.stockxStatus ?? "").toUpperCase() === "LOCAL_STOCK" ||
        isLocalOrManualStockxRef(match?.stockxOrderNumber));

    const deliveryType = String(line.order.deliveryType ?? "").toLowerCase();
    const channel: InStockShipChannel =
      deliveryType === "direct_delivery" ? "galaxus_direct" : "galaxus_warehouse";
    const recipient = galaxusScanDisplayRecipient(line.order as any);

    out.push({
      id: `gx:${line.id}`,
      channel,
      orderDbId: line.order.id,
      orderLabel: text(line.order.orderNumber) ?? line.order.galaxusOrderId,
      lineId: line.id,
      gtin,
      productName: text(line.productName) ?? "Item",
      size: text(line.size),
      remaining: rem,
      stockQty: phys.qty,
      locationName: phys.locationName,
      customerName: text(recipient?.name) ?? text(line.order.referencePerson),
      orderDate: line.order.orderDate.toISOString(),
      localMatch,
    });
  }
  return out;
}

/**
 * Shopify sales already marked as ship-from-our-stock.
 * Mirror qty is often 0 after the sale decrements inventory — still show them
 * so ops can scan the GTIN / grab the pair.
 */
async function listShopifyShipFromStock(): Promise<InStockShipItem[]> {
  const matches = await prisma.orderMatch.findMany({
    where: {
      returnAppliedAt: null,
      stockxAwb: null,
      shopifyCreatedAt: { gte: shopifyMatchMinCreatedAt() },
      OR: [
        { stockxStatus: { in: ["PHYSICAL_STOCK", "LOCAL_STOCK", "ESSENTIAL_STOCK"] } },
        {
          matchType: {
            in: ["physical_fulfillment", "LOCAL_STOCK", "essentials_in_stock", "fixed_price_cost"],
          },
        },
        { stockxOrderNumber: { startsWith: "LOCAL-STOCK-" } },
        { localStockLotId: { not: null } },
      ],
    },
    orderBy: [{ shopifyCreatedAt: "desc" }],
    take: 200,
    select: {
      id: true,
      shopifyOrderId: true,
      shopifyOrderName: true,
      shopifyLineItemId: true,
      shopifyProductTitle: true,
      shopifySizeEU: true,
      shopifySku: true,
      shopifyCreatedAt: true,
      shopifyCustomerFirstName: true,
      shopifyCustomerLastName: true,
      stockxStatus: true,
      matchType: true,
      localStockLot: {
        select: {
          gtin: true,
          locationName: true,
          qtyAvailable: true,
        },
      },
    },
  });

  if (matches.length === 0) return [];

  const skus = Array.from(
    new Set(matches.map((m) => text(m.shopifySku)).filter((s): s is string => Boolean(s)))
  );
  const skuMeta = await loadPhysicalMetaBySku(skus);

  const out: InStockShipItem[] = [];
  const seenOrders = new Set<string>();

  for (const m of matches) {
    const dedupeKey = `${m.shopifyOrderId}|${m.shopifyLineItemId}`;
    if (seenOrders.has(dedupeKey)) continue;
    seenOrders.add(dedupeKey);

    const sku = text(m.shopifySku);
    const skuInfo = sku ? skuMeta.get(sku.toUpperCase()) : null;
    const lotGtin = text(m.localStockLot?.gtin);
    const gtin =
      lotGtin ??
      text(skuInfo?.gtin) ??
      (sku && /^\d{8,14}$/.test(sku) ? sku : null);
    // Need a barcode to scan — skip rows with neither GTIN nor numeric SKU.
    if (!gtin && !sku) continue;
    const scanCode = gtin ?? sku!;

    const lotQty = Math.max(0, Number(m.localStockLot?.qtyAvailable ?? 0));
    const mirrorQty = Math.max(0, Number(skuInfo?.available ?? 0));
    const stockQty = Math.max(lotQty, mirrorQty, 1);

    const customer = [m.shopifyCustomerFirstName, m.shopifyCustomerLastName]
      .map((x) => text(x))
      .filter(Boolean)
      .join(" ");

    const status = String(m.stockxStatus ?? "").toUpperCase();
    const locationName =
      text(skuInfo?.locationName) ??
      text(m.localStockLot?.locationName) ??
      (status === "PHYSICAL_STOCK"
        ? "Stock physique"
        : status === "ESSENTIAL_STOCK"
          ? "Essentials"
          : "Magasin");

    out.push({
      id: `sh:${m.id}`,
      channel: "shopify",
      orderDbId: String(m.shopifyOrderId ?? ""),
      orderLabel: text(m.shopifyOrderName) ?? String(m.shopifyOrderId ?? ""),
      lineId: String(m.shopifyLineItemId ?? m.id),
      gtin: scanCode,
      productName: text(m.shopifyProductTitle) ?? "Item",
      size: text(m.shopifySizeEU),
      remaining: 1,
      stockQty,
      locationName,
      customerName: customer || null,
      orderDate: (m.shopifyCreatedAt ?? new Date()).toISOString(),
      localMatch: true,
    });
  }
  return out;
}

async function loadPhysicalMetaBySku(
  skus: string[]
): Promise<Map<string, { gtin: string | null; locationName: string; available: number }>> {
  const out = new Map<string, { gtin: string | null; locationName: string; available: number }>();
  if (skus.length === 0) return out;

  // Case-insensitive SKU match; include available=0 so sold pairs still resolve GTIN/location.
  const rows = await prisma.$queryRaw<
    Array<{
      sku: string;
      gtin: string | null;
      locationName: string | null;
      available: number;
      priority: number;
    }>
  >`
    SELECT
      s."sku" AS sku,
      s."gtin" AS gtin,
      s."locationName" AS "locationName",
      s."available" AS available,
      s."priority" AS priority
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."sourceType" = 'physical'
      AND s."sku" IS NOT NULL
      AND UPPER(s."sku") = ANY(${skus.map((s) => s.toUpperCase())}::text[])
    ORDER BY s."priority" ASC, s."available" DESC
  `;

  for (const row of rows) {
    const key = String(row.sku ?? "")
      .trim()
      .toUpperCase();
    if (!key || out.has(key)) continue;
    out.set(key, {
      gtin: text(row.gtin),
      locationName: text(row.locationName) ?? "Magasin",
      available: Math.max(0, Number(row.available ?? 0)),
    });
  }
  return out;
}
