import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";
import { shopifyMatchMinCreatedAt } from "@/app/lib/shopifyMatchEligibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live SKU / product suggestion feed for the /scan page.
 *
 * Behaviour when the operator TYPES (as opposed to scanning) into the AWB
 * input: we search pending Galaxus warehouse + Galaxus direct-delivery +
 * Decathlon + Shopify lines whose identifiers or product name match the typed
 * text and return up to `limit` results. Ranking prefers exact identifier hits,
 * then prefix, then contains, tie-broken by oldest orderDate.
 */

type SuggestKind = "galaxus_direct" | "galaxus_warehouse" | "decathlon" | "shopify";

type SuggestItem = {
  id: string;
  kind: SuggestKind;
  orderId: string;
  orderDbId: string;
  orderNumber: string | null;
  orderDate: string;
  lineId: string;
  supplierPid: string;
  buyerPid?: string | null;
  gtin: string | null;
  productName: string;
  sizeEU?: string | null;
  deliveryType?: string | null;
  customerCity?: string | null;
};

type SuggestResponse =
  | { ok: true; items: SuggestItem[]; total: number }
  | { ok: false; error: string };

const MAX_LIMIT = 20;
const DEFAULT_LIMIT = 8;
const FETCH_MULTIPLIER = 4;
const DECATHLON_TERMINAL_STATES = new Set([
  "CANCELED",
  "CANCELLED",
  "ORDER_CANCELLED",
  "CLOSED",
  "SHIPPED",
  "REFUSED",
  "REFUNDED",
]);

function normalizeQuery(raw: string): string {
  return raw.trim();
}

function digitsOnly(raw: string): string {
  return raw.replace(/\D+/g, "");
}

function tierFor(fields: Array<string | null | undefined>, q: string): 0 | 1 | 2 {
  const needle = q.toLowerCase();
  const digits = digitsOnly(q);
  let bestTier: 0 | 1 | 2 = 2;
  for (const f of fields) {
    if (!f) continue;
    const s = String(f).toLowerCase();
    if (s === needle) return 0;
    if (digits && digits.length >= 8) {
      const fdigits = digitsOnly(String(f));
      if (fdigits === digits) return 0;
    }
    if (s.startsWith(needle) && bestTier > 1) bestTier = 1;
  }
  return bestTier;
}

async function searchGalaxus(q: string, limit: number): Promise<SuggestItem[]> {
  const contains: Prisma.StringFilter = { contains: q, mode: "insensitive" };
  const lineOr: Prisma.GalaxusOrderLineWhereInput[] = [
    { supplierPid: contains },
    { buyerPid: contains },
    { gtin: contains },
    { supplierSku: contains },
    { description: contains },
    { productName: contains },
    { providerKey: contains },
    { order: { orderNumber: contains } },
    { order: { galaxusOrderId: contains } },
  ];

  const rows = await prisma.galaxusOrderLine.findMany({
    where: {
      OR: lineOr,
      // Pending filter: order not cancelled / archived. Warehouse lines get an
      // extra line-level filter after fetch (warehouseMarkedShippedAt IS NULL)
      // because direct-delivery lines don't use that column at all.
      order: {
        cancelledAt: null,
        archivedAt: null,
      },
    },
    select: {
      id: true,
      supplierPid: true,
      buyerPid: true,
      gtin: true,
      productName: true,
      description: true,
      size: true,
      warehouseMarkedShippedAt: true,
      order: {
        select: {
          id: true,
          galaxusOrderId: true,
          orderNumber: true,
          orderDate: true,
          deliveryType: true,
          recipientCity: true,
          customerCity: true,
        },
      },
    },
    orderBy: { order: { orderDate: "asc" } },
    take: limit * FETCH_MULTIPLIER,
  });

  const items: SuggestItem[] = [];
  for (const line of rows) {
    const deliveryType = String(line.order.deliveryType ?? "").toLowerCase();
    const isDirect = deliveryType === "direct_delivery";
    // Line-level pending signal for warehouse: not yet warehouse-shipped.
    if (!isDirect && line.warehouseMarkedShippedAt) continue;
    items.push({
      id: `galaxus:${line.id}`,
      kind: isDirect ? "galaxus_direct" : "galaxus_warehouse",
      orderId: line.order.galaxusOrderId,
      orderDbId: line.order.id,
      orderNumber: line.order.orderNumber ?? null,
      orderDate: line.order.orderDate.toISOString(),
      lineId: line.id,
      supplierPid: String(line.supplierPid ?? line.buyerPid ?? "").trim(),
      buyerPid: line.buyerPid ?? null,
      gtin: line.gtin ?? null,
      productName: line.productName || line.description || line.supplierPid || "—",
      sizeEU: line.size ?? null,
      deliveryType: line.order.deliveryType ?? null,
      customerCity: line.order.recipientCity ?? line.order.customerCity ?? null,
    });
  }
  return items;
}

async function searchShopify(q: string, limit: number): Promise<SuggestItem[]> {
  const digits = digitsOnly(q);
  const contains: Prisma.StringFilter = { contains: q, mode: "insensitive" };
  const skuFromGtin =
    digits.length >= 8
      ? await prisma.shopifyVariantLocationStock.findMany({
          where: { gtin: { contains: digits }, sku: { not: null } },
          select: { sku: true },
          take: limit * 2,
        })
      : [];
  const skus = Array.from(
    new Set(skuFromGtin.map((r) => String(r.sku ?? "").trim()).filter(Boolean))
  );

  const or: Prisma.OrderMatchWhereInput[] = [
    { shopifyOrderName: contains },
    { shopifySku: contains },
    { shopifyProductTitle: contains },
    { stockxSkuKey: contains },
  ];
  if (skus.length > 0) {
    or.push({ shopifySku: { in: skus } });
  }

  const rows = await prisma.orderMatch.findMany({
    where: {
      OR: or,
      returnAppliedAt: null,
      // Drop fulfilled / ancient Shopify orders from typeahead.
      shopifyCreatedAt: { gte: shopifyMatchMinCreatedAt() },
    },
    select: {
      id: true,
      shopifyOrderId: true,
      shopifyOrderName: true,
      shopifyLineItemId: true,
      shopifySku: true,
      shopifyProductTitle: true,
      shopifySizeEU: true,
      shopifyCreatedAt: true,
    },
    orderBy: { shopifyCreatedAt: "desc" },
    take: limit * FETCH_MULTIPLIER,
  });

  const orderIds = Array.from(new Set(rows.map((r) => r.shopifyOrderId)));
  const [fulfilled, cancelled] = await Promise.all([
    orderIds.length
      ? prisma.shopifyFulfillmentRecord.findMany({
          where: { shopifyOrderId: { in: orderIds } },
          select: { shopifyOrderId: true },
        })
      : Promise.resolve([] as Array<{ shopifyOrderId: string }>),
    orderIds.length
      ? prisma.shopifyOrder.findMany({
          where: { shopifyOrderId: { in: orderIds }, cancelledAt: { not: null } },
          select: { shopifyOrderId: true },
        })
      : Promise.resolve([] as Array<{ shopifyOrderId: string }>),
  ]);
  const fulfilledSet = new Set(fulfilled.map((f) => f.shopifyOrderId));
  const cancelledSet = new Set(cancelled.map((c) => c.shopifyOrderId));

  const items: SuggestItem[] = [];
  for (const row of rows) {
    if (fulfilledSet.has(row.shopifyOrderId)) continue;
    if (cancelledSet.has(row.shopifyOrderId)) continue;
    items.push({
      id: `shopify:${row.id}`,
      kind: "shopify",
      orderId: row.shopifyOrderId,
      orderDbId: row.id,
      orderNumber: row.shopifyOrderName ?? null,
      orderDate: (row.shopifyCreatedAt ?? new Date(0)).toISOString(),
      lineId: row.shopifyLineItemId,
      supplierPid: String(row.shopifySku ?? "").trim(),
      buyerPid: null,
      gtin: digits.length >= 8 ? digits : null,
      productName: row.shopifyProductTitle || row.shopifySku || "—",
      sizeEU: row.shopifySizeEU ?? null,
      deliveryType: null,
      customerCity: null,
    });
  }
  return items;
}

async function searchDecathlon(q: string, limit: number): Promise<SuggestItem[]> {
  const contains: Prisma.StringFilter = { contains: q, mode: "insensitive" };
  const lineOr: Prisma.DecathlonOrderLineWhereInput[] = [
    { offerSku: contains },
    { productSku: contains },
    { supplierSku: contains },
    { gtin: contains },
    { description: contains },
    { productTitle: contains },
    { providerKey: contains },
    { order: { orderNumber: contains } },
    { order: { orderId: contains } },
  ];

  const rows = await prisma.decathlonOrderLine.findMany({
    where: {
      OR: lineOr,
      order: {
        NOT: { orderState: { in: Array.from(DECATHLON_TERMINAL_STATES) } },
      },
    },
    select: {
      id: true,
      offerSku: true,
      productSku: true,
      supplierSku: true,
      gtin: true,
      productTitle: true,
      description: true,
      size: true,
      order: {
        select: {
          id: true,
          orderId: true,
          orderNumber: true,
          orderDate: true,
          orderState: true,
          recipientCity: true,
          customerCity: true,
        },
      },
    },
    orderBy: { order: { orderDate: "asc" } },
    take: limit * FETCH_MULTIPLIER,
  });

  return rows.map((line) => ({
    id: `decathlon:${line.id}`,
    kind: "decathlon" as const,
    orderId: line.order.orderId,
    orderDbId: line.order.id,
    orderNumber: line.order.orderNumber ?? null,
    orderDate: line.order.orderDate.toISOString(),
    lineId: line.id,
    supplierPid: String(line.offerSku ?? line.productSku ?? line.supplierSku ?? "").trim(),
    buyerPid: null,
    gtin: line.gtin ?? null,
    productName: line.productTitle || line.description || line.offerSku || "—",
    sizeEU: line.size ?? null,
    deliveryType: null,
    customerCity: line.order.recipientCity ?? line.order.customerCity ?? null,
  }));
}

function rankFieldsFor(item: SuggestItem): Array<string | null | undefined> {
  return [
    item.supplierPid,
    item.buyerPid,
    item.gtin,
    item.productName,
    item.orderNumber,
    item.orderId,
  ];
}

export async function GET(req: NextRequest): Promise<NextResponse<SuggestResponse>> {
  try {
    const url = new URL(req.url);
    const qRaw = url.searchParams.get("q") ?? "";
    const q = normalizeQuery(qRaw);
    const limitRaw = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
    const limit = Math.max(
      1,
      Math.min(MAX_LIMIT, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : DEFAULT_LIMIT)
    );

    if (q.length < 2) {
      return NextResponse.json<SuggestResponse>({ ok: true, items: [], total: 0 });
    }

    const [galaxusItems, decathlonItems, shopifyItems] = await Promise.all([
      searchGalaxus(q, limit),
      searchDecathlon(q, limit),
      searchShopify(q, limit),
    ]);

    const combined = [...galaxusItems, ...decathlonItems, ...shopifyItems];
    const ranked = combined
      .map((item) => ({ item, tier: tierFor(rankFieldsFor(item), q) }))
      .sort((a, b) => {
        if (a.tier !== b.tier) return a.tier - b.tier;
        const da = new Date(a.item.orderDate).getTime();
        const db = new Date(b.item.orderDate).getTime();
        if (da !== db) return da - db;
        return a.item.id.localeCompare(b.item.id);
      })
      .slice(0, limit)
      .map(({ item }) => item);

    const res = NextResponse.json<SuggestResponse>({
      ok: true,
      items: ranked,
      total: combined.length,
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err: any) {
    console.error("[SCAN-AWB][suggest] error:", err);
    return NextResponse.json<SuggestResponse>(
      { ok: false, error: err?.message || "Internal error" },
      { status: 500 }
    );
  }
}
