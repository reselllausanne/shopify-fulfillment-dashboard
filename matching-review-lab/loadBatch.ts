/**
 * Load open client units + StockX buys for Matching Review Lab (server-side).
 * StockX comes from cache/snapshot — never paginate full history from the browser.
 */

import { prisma } from "@/app/lib/prisma";
import {
  isPackageProtectionShopifyLine,
  isShopifyFinancialRefunded,
  type ShopifyLineItem,
} from "@/app/utils/matching";
import { shouldSkipGalaxusOrderForMatching } from "@/galaxus/orders/openGalaxusOrderFilter";
import { prefetchStockxBuyingOrdersForMatching } from "@/galaxus/stx/buyingOrdersCache";
import { shopifyGraphQL, sleepForShopifyQueryCost } from "@/lib/shopifyAdmin";
import {
  buildPhysicalStockByGtinMap,
  resolvePhysicalStockForGtin,
} from "@/shopify/inventory/orderLinePhysicalStock";
import {
  stockxAccountKeyForGalaxus,
  stockxAccountKeyForShopify,
} from "./accountKeys";
import { isStockxBuyMatchable, normalizeSizeLabel, normalizeStockxBuyingNode } from "./normalize";
import {
  extractStxVariantId,
  isLabDecathlonStxLine,
  isLabGalaxusStxLine,
} from "./stxLineFilter";
import { resolveLabTokenSlots } from "./tokens";
import type { LabChannel, LabClientUnit, LabStockxBuy, StockxAccountKey } from "./types";

export type LoadBatchOptions = {
  channels?: LabChannel[];
  limit?: number;
  /** Lookback days for Shopify GraphQL paid orders. */
  shopifyDays?: number;
  forceRefreshStockx?: boolean;
};

export type LoadBatchResult = {
  units: LabClientUnit[];
  buys: LabStockxBuy[];
  freshness: {
    fetchedAt: string | null;
    fromCache: boolean;
    accounts: Array<{ accountKey: StockxAccountKey; buyCount: number; source: string }>;
  };
  meta: {
    shopifyOrdersScanned: number;
    galaxusOrdersScanned: number;
    decathlonOrdersScanned: number;
    limit: number;
    /** How many Galaxus/Decathlon lines skipped as non-STX. */
    nonStxSkipped: number;
  };
  warnings: string[];
};

function gidToId(gid: string): string {
  const s = String(gid || "");
  const m = s.match(/\/(\d+)\s*$/);
  return m ? m[1]! : s;
}

function sizeFromVariant(node: any): string | null {
  const opts = node?.variant?.selectedOptions ?? [];
  for (const o of opts) {
    if (String(o?.name ?? "").toLowerCase().includes("size")) return String(o.value ?? "");
  }
  return node?.variantTitle ? String(node.variantTitle) : null;
}

function digitsOnlyGtin(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/** All strings to query in VariantMapping.gtin (DB may store 12/13/14-digit forms). */
function expandGtinQueryVariants(lineGtins: string[]): string[] {
  const out = new Set<string>();
  for (const raw of lineGtins) {
    const t = String(raw ?? "").trim();
    if (!t) continue;
    out.add(t);
    const d = digitsOnlyGtin(t);
    if (!d) continue;
    out.add(d);
    out.add(d.padStart(14, "0"));
    out.add(d.padStart(13, "0"));
    out.add(d.padStart(12, "0"));
    const strip = d.replace(/^0+/, "") || "0";
    out.add(strip);
  }
  return Array.from(out).filter((s) => s.length > 0);
}

function sameGtinKey(a: string, b: string): boolean {
  const da = digitsOnlyGtin(a).replace(/^0+/, "") || "0";
  const db = digitsOnlyGtin(b).replace(/^0+/, "") || "0";
  return da === db;
}

function sizeFromProductTitle(title: string | null | undefined): string | null {
  const t = String(title ?? "").trim();
  if (!t) return null;
  // Prefer last "(36)" / "(EU 42)" / "(5.5Y)" style suffix used in Galaxus titles.
  const matches = [...t.matchAll(/\(([^)]+)\)/g)];
  for (let i = matches.length - 1; i >= 0; i--) {
    const inner = String(matches[i]?.[1] ?? "").trim();
    if (!inner) continue;
    if (/^(kids|men|women|gs|youth|grade school)$/i.test(inner)) continue;
    if (/\d/.test(inner)) return inner;
  }
  return null;
}

function resolveLabDisplaySize(params: {
  size?: string | null;
  productTitle?: string | null;
  description?: string | null;
  sizeFromCatalog?: string | null;
}): string | null {
  const direct = String(params.size ?? "").trim();
  if (direct) return direct;
  const catalog = String(params.sizeFromCatalog ?? "").trim();
  if (catalog) return catalog;
  return (
    sizeFromProductTitle(params.productTitle) ||
    sizeFromProductTitle(params.description) ||
    null
  );
}

function resolveLabDisplaySku(params: {
  supplierSku?: string | null;
  supplierVariantId?: string | null;
  styleFromCatalog?: string | null;
}): string | null {
  const style = String(params.styleFromCatalog ?? "").trim();
  if (style) return style;
  const sku = String(params.supplierSku ?? "").trim();
  if (sku) return sku;
  const sv = String(params.supplierVariantId ?? "").trim();
  return sv || null;
}

function lookupByGtin(
  map: Map<string, string>,
  gtin: string | null | undefined
): string | null {
  const raw = String(gtin ?? "").trim();
  if (!raw) return null;
  const direct = map.get(raw);
  if (direct) return direct;
  for (const [k, v] of map) {
    if (sameGtinKey(k, raw)) return v;
  }
  return null;
}

async function loadSizeAndStyleByGtin(
  gtins: string[]
): Promise<{
  sizeByGtin: Map<string, string>;
  styleByGtin: Map<string, string>;
  stockxVariantIdByGtin: Map<string, string>;
}> {
  const sizeByGtin = new Map<string, string>();
  const styleByGtin = new Map<string, string>();
  const stockxVariantIdByGtin = new Map<string, string>();
  const clean = expandGtinQueryVariants(gtins);
  if (clean.length === 0) return { sizeByGtin, styleByGtin, stockxVariantIdByGtin };

  try {
    const mappings = await prisma.variantMapping.findMany({
      where: { gtin: { in: clean } },
      select: {
        gtin: true,
        supplierVariantId: true,
        supplierVariant: {
          select: {
            supplierSku: true,
            sizeRaw: true,
            sizeNormalized: true,
          },
        },
        kickdbVariant: {
          select: {
            sizeEu: true,
            sizeUs: true,
            kickdbVariantId: true,
            product: { select: { styleId: true } },
          },
        },
      },
      take: 800,
    });
    for (const m of mappings) {
      const gtin = String(m.gtin ?? "").trim();
      if (!gtin) continue;
      const size =
        String(m.supplierVariant?.sizeRaw ?? "").trim() ||
        String(m.supplierVariant?.sizeNormalized ?? "").trim() ||
        String(m.kickdbVariant?.sizeEu ?? "").trim() ||
        String(m.kickdbVariant?.sizeUs ?? "").trim();
      if (size && !sizeByGtin.has(gtin)) sizeByGtin.set(gtin, size);
      const style =
        String(m.kickdbVariant?.product?.styleId ?? "").trim() ||
        String(m.supplierVariant?.supplierSku ?? "").trim();
      if (style && !styleByGtin.has(gtin)) styleByGtin.set(gtin, style);

      // Prefer real StockX UUID from stx_<uuid> mapping (not STX_<gtin>).
      const fromSupplier = extractStxVariantId(m.supplierVariantId);
      const fromKickdb = extractStxVariantId(m.kickdbVariant?.kickdbVariantId);
      const stockxVid = fromSupplier || fromKickdb;
      if (stockxVid && !stockxVariantIdByGtin.has(gtin)) {
        stockxVariantIdByGtin.set(gtin, stockxVid);
      }
    }
  } catch (err) {
    console.warn("[matching-review-lab] GTIN size/style lookup failed:", err);
  }

  return { sizeByGtin, styleByGtin, stockxVariantIdByGtin };
}

async function sleepMs(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function loadShopifyOpenUnits(limit: number, days: number): Promise<{
  units: LabClientUnit[];
  ordersScanned: number;
  warnings: string[];
}> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (days - 1));
  since.setUTCHours(0, 0, 0, 0);
  const sinceDay = since.toISOString().slice(0, 10);
  const warnings: string[] = [];

  // Prefer open/partial paid orders — cheaper than scanning all paid then filtering.
  const searchQuery = [
    `created_at:>=${sinceDay}`,
    "financial_status:paid",
    "-status:cancelled",
    "(fulfillment_status:unfulfilled OR fulfillment_status:partial)",
  ].join(" ");

  const query = `
    query LabOpenOrders($cursor: String, $q: String!) {
      orders(
        first: 25
        after: $cursor
        sortKey: CREATED_AT
        reverse: true
        query: $q
      ) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            name
            createdAt
            displayFinancialStatus
            displayFulfillmentStatus
            cancelledAt
            customer { email firstName lastName }
            shippingAddress { countryCodeV2 city }
            lineItems(first: 40) {
              edges {
                node {
                  id
                  title
                  variantTitle
                  sku
                  quantity
                  currentQuantity
                  originalUnitPriceSet { shopMoney { amount currencyCode } }
                  variant { barcode selectedOptions { name value } }
                }
              }
            }
          }
        }
      }
    }
  `;

  const units: LabClientUnit[] = [];
  let cursor: string | null = null;
  let ordersScanned = 0;
  const accountKey = stockxAccountKeyForShopify({ source: "dashboard" });

  type OrdersPage = {
    orders: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: any[];
    };
  };

  const isThrottled = (
    errors: Array<{ message?: string; extensions?: { code?: string } }> | undefined
  ) =>
    (errors ?? []).some((e) => {
      const code = String(e?.extensions?.code ?? "").toUpperCase();
      const msg = String(e?.message ?? "").toUpperCase();
      return code === "THROTTLED" || msg.includes("THROTTLED");
    });

  while (units.length < limit) {
    let result: Awaited<ReturnType<typeof shopifyGraphQL<OrdersPage>>> | null = null;
    let pageGaveUp = false;

    for (let pageAttempt = 0; pageAttempt < 4; pageAttempt += 1) {
      result = await shopifyGraphQL<OrdersPage>(
        query,
        { cursor, q: searchQuery },
        { estimatedQueryCost: 120 }
      );
      if (!result.errors?.length) break;
      if (isThrottled(result.errors)) {
        // Product/image Admin API jobs share this bucket with order queries.
        const waitMs = 3000 + pageAttempt * 4000;
        console.warn(
          `[matching-review-lab] Shopify THROTTLED page retry ${pageAttempt + 1}/4 — wait ${waitMs}ms`
        );
        await sleepMs(waitMs);
        continue;
      }
      throw new Error(`Shopify GQL: ${JSON.stringify(result.errors)}`);
    }

    if (!result) break;

    if (result.errors?.length) {
      if (isThrottled(result.errors)) {
        warnings.push(
          `Shopify THROTTLED after retries (concurrent Admin API / image sync likely). Kept ${units.length} units so far.`
        );
        pageGaveUp = true;
      } else {
        throw new Error(`Shopify GQL: ${JSON.stringify(result.errors)}`);
      }
    }

    if (pageGaveUp) break;

    const data: OrdersPage | undefined = result.data;
    if (!data?.orders) break;

    await sleepForShopifyQueryCost(result.extensions, 600);

    for (const edge of data.orders.edges) {
      const o = edge.node;
      ordersScanned += 1;
      if (o.cancelledAt) continue;
      if (isShopifyFinancialRefunded(o.displayFinancialStatus)) continue;
      const fulfillment = String(o.displayFulfillmentStatus ?? "").toUpperCase();
      if (fulfillment === "FULFILLED") continue;

      for (const le of o.lineItems?.edges ?? []) {
        const li = le.node;
        if (isPackageProtectionShopifyLine(li.title, li.sku)) continue;
        const remaining = Math.max(0, Number(li.currentQuantity ?? li.quantity ?? 0));
        if (remaining <= 0) continue;

        const size = sizeFromVariant(li);
        const gtin = li.variant?.barcode ? String(li.variant.barcode) : null;
        const shopifyLine: ShopifyLineItem = {
          shopifyOrderId: gidToId(o.id),
          orderName: o.name,
          createdAt: o.createdAt,
          displayFinancialStatus: o.displayFinancialStatus,
          displayFulfillmentStatus: o.displayFulfillmentStatus,
          customerEmail: o.customer?.email ?? null,
          customerName:
            [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(" ") || null,
          customerFirstName: o.customer?.firstName ?? null,
          customerLastName: o.customer?.lastName ?? null,
          shippingCountry: o.shippingAddress?.countryCodeV2 ?? null,
          shippingCity: o.shippingAddress?.city ?? null,
          lineItemId: gidToId(li.id),
          title: li.title,
          sku: li.sku,
          variantTitle: li.variantTitle,
          quantity: remaining,
          price: String(li.originalUnitPriceSet?.shopMoney?.amount ?? "0"),
          totalPrice: String(li.originalUnitPriceSet?.shopMoney?.amount ?? "0"),
          currencyCode: li.originalUnitPriceSet?.shopMoney?.currencyCode ?? "CHF",
          sizeEU: size,
          lineItemImageUrl: null,
          gtin,
        };

        for (let unitIndex = 0; unitIndex < remaining && units.length < limit; unitIndex++) {
          const lineId = gidToId(li.id);
          units.push({
            unitKey: `SHOPIFY:${o.name}:${lineId}:${unitIndex}`,
            channel: "SHOPIFY",
            orderId: gidToId(o.id),
            orderNumber: o.name,
            orderDate: o.createdAt,
            lineId,
            unitIndex,
            remainingQty: remaining - unitIndex,
            productTitle: li.title,
            gtin,
            sku: li.sku,
            styleId: li.sku,
            sizeRaw: size,
            sizeNormalized: normalizeSizeLabel(size),
            shopifyLine: { ...shopifyLine, quantity: 1 },
            stockxVariantId: null,
            stockxAccountKeyExpected: accountKey,
          });
        }
      }
    }

    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
    if (!cursor) break;
  }

  return { units, ordersScanned, warnings };
}

async function loadGalaxusOpenUnits(limit: number): Promise<{
  units: LabClientUnit[];
  ordersScanned: number;
  nonStxSkipped: number;
}> {
  const orders = await prisma.galaxusOrder.findMany({
    where: { cancelledAt: null, archivedAt: null },
    orderBy: { orderDate: "desc" },
    take: Math.min(500, Math.max(limit * 3, 80)),
    include: { lines: true },
  });

  const units: LabClientUnit[] = [];
  let ordersScanned = 0;
  let nonStxSkipped = 0;
  const accountKey = stockxAccountKeyForGalaxus({ source: "galaxus" });

  type Candidate = {
    order: (typeof orders)[number];
    line: (typeof orders)[number]["lines"][number];
    orderDate: string;
    orderNumber: string;
    qty: number;
    supplierVariantId: string;
    stockxVariantId: string | null;
  };
  const candidates: Candidate[] = [];

  for (const order of orders) {
    ordersScanned += 1;
    if (
      shouldSkipGalaxusOrderForMatching({
        cancelledAt: order.cancelledAt,
        archivedAt: order.archivedAt,
        lines: order.lines,
      })
    ) {
      continue;
    }

    const orderDate =
      order.orderDate instanceof Date
        ? order.orderDate.toISOString()
        : String(order.orderDate);
    const orderNumber = order.orderNumber ?? order.galaxusOrderId;

    for (const line of order.lines) {
      if (!isLabGalaxusStxLine(line)) {
        nonStxSkipped += 1;
        continue;
      }
      const qty = Math.max(0, Math.round(Number(line.quantity ?? 0)));
      if (qty <= 0) continue;

      const supplierVariantId = String(
        line.supplierVariantId ?? line.supplierSku ?? line.providerKey ?? ""
      ).trim();
      const stockxVariantId =
        extractStxVariantId(line.supplierVariantId) ||
        extractStxVariantId(line.supplierSku) ||
        extractStxVariantId(line.providerKey);
      candidates.push({
        order,
        line,
        orderDate,
        orderNumber,
        qty,
        supplierVariantId,
        stockxVariantId,
      });
    }
  }

  const { sizeByGtin, styleByGtin, stockxVariantIdByGtin } = await loadSizeAndStyleByGtin(
    candidates.map((c) => String(c.line.gtin ?? ""))
  );
  const physicalByGtin = await buildPhysicalStockByGtinMap(
    candidates.map((c) => String(c.line.gtin ?? ""))
  );

  for (const c of candidates) {
    if (units.length >= limit) break;
    const { line, order, orderDate, orderNumber, qty, supplierVariantId } = c;
    const gtin = line.gtin ? String(line.gtin) : null;
    const stockxVariantId =
      c.stockxVariantId ||
      extractStxVariantId(line.supplierSku) ||
      extractStxVariantId(line.providerKey) ||
      lookupByGtin(stockxVariantIdByGtin, gtin);
    const size = resolveLabDisplaySize({
      size: line.size,
      productTitle: line.productName,
      description: line.description,
      sizeFromCatalog: lookupByGtin(sizeByGtin, gtin),
    });
    const sku = resolveLabDisplaySku({
      supplierSku: line.supplierSku,
      supplierVariantId,
      styleFromCatalog: lookupByGtin(styleByGtin, gtin),
    });
    const physical = resolvePhysicalStockForGtin(gtin, physicalByGtin);

    const shopifyLine: ShopifyLineItem = {
      shopifyOrderId: order.id,
      orderName: orderNumber,
      createdAt: orderDate,
      displayFinancialStatus: "PAID",
      displayFulfillmentStatus: null,
      customerEmail: order.customerEmail ?? null,
      customerName: order.customerName ?? null,
      customerFirstName: null,
      customerLastName: null,
      shippingCountry: order.customerCountry ?? null,
      shippingCity: order.customerCity ?? null,
      lineItemId: line.id,
      title: line.productName ?? "Item",
      sku: sku,
      variantTitle: size,
      quantity: 1,
      price: String(line.unitNetPrice ?? "0"),
      totalPrice: String(line.lineNetAmount ?? "0"),
      currencyCode: order.currencyCode ?? "CHF",
      sizeEU: size,
      lineItemImageUrl: null,
      gtin,
      physicalStockQty: physical?.qty ?? 0,
    };

    for (let unitIndex = 0; unitIndex < qty && units.length < limit; unitIndex++) {
      units.push({
        unitKey: `GALAXUS:${orderNumber}:${line.id}:${unitIndex}`,
        channel: "GALAXUS",
        orderId: order.id,
        orderNumber,
        orderDate,
        lineId: line.id,
        unitIndex,
        remainingQty: qty - unitIndex,
        productTitle: line.productName ?? "Item",
        gtin,
        sku,
        styleId: sku,
        sizeRaw: size,
        sizeNormalized: normalizeSizeLabel(size),
        shopifyLine,
        stockxVariantId,
        stockxAccountKeyExpected: accountKey,
      });
    }
  }

  return { units, ordersScanned, nonStxSkipped };
}

const DECATHLON_CLOSED_STATES = new Set([
  "CANCELED",
  "CANCELLED",
  "REFUSED",
  "CLOSED",
  "SHIPPED",
  "RECEIVED",
]);

async function loadDecathlonOpenUnits(limit: number): Promise<{
  units: LabClientUnit[];
  ordersScanned: number;
  nonStxSkipped: number;
}> {
  const orders = await prisma.decathlonOrder.findMany({
    orderBy: { orderDate: "desc" },
    take: Math.min(400, Math.max(limit * 3, 60)),
    include: {
      lines: { include: { stockxMatch: true, shipmentLines: true } },
    },
  });

  const units: LabClientUnit[] = [];
  let ordersScanned = 0;
  let nonStxSkipped = 0;
  const accountKey = stockxAccountKeyForGalaxus({ source: "galaxus" });

  type Candidate = {
    order: (typeof orders)[number];
    line: (typeof orders)[number]["lines"][number];
    orderDate: string;
    orderNumber: string;
    qty: number;
    providerKey: string;
    stockxVariantId: string | null;
  };
  const candidates: Candidate[] = [];

  for (const order of orders) {
    ordersScanned += 1;
    const state = String(order.orderState ?? "").trim().toUpperCase();
    if (DECATHLON_CLOSED_STATES.has(state)) continue;

    const orderDate =
      order.orderDate instanceof Date
        ? order.orderDate.toISOString()
        : String(order.orderDate);
    const orderNumber = order.orderNumber ?? order.orderId;

    for (const line of order.lines) {
      if (!isLabDecathlonStxLine(line)) {
        nonStxSkipped += 1;
        continue;
      }
      // Skip lines already matched to StockX.
      if (line.stockxMatch?.stockxOrderNumber) continue;
      // Skip fully shipped line qty.
      const shipped = (line.shipmentLines ?? []).reduce(
        (sum, sl) => sum + Math.max(0, Number(sl.quantity ?? 0)),
        0
      );
      const qty = Math.max(0, Math.round(Number(line.quantity ?? 0)) - shipped);
      if (qty <= 0) continue;

      const providerKey = String(line.providerKey ?? "").trim();
      const stockxVariantId =
        extractStxVariantId(line.supplierSku) ||
        extractStxVariantId(line.offerSku) ||
        (providerKey.toUpperCase().startsWith("STX_")
          ? null
          : extractStxVariantId(providerKey));

      candidates.push({
        order,
        line,
        orderDate,
        orderNumber,
        qty,
        providerKey,
        stockxVariantId,
      });
    }
  }

  const { sizeByGtin, styleByGtin, stockxVariantIdByGtin } = await loadSizeAndStyleByGtin(
    candidates.map((c) => String(c.line.gtin ?? ""))
  );

  for (const c of candidates) {
    if (units.length >= limit) break;
    const { line, order, orderDate, orderNumber, qty, providerKey } = c;
    const gtin = line.gtin ? String(line.gtin) : null;
    const stockxVariantId =
      c.stockxVariantId ||
      extractStxVariantId(line.supplierSku) ||
      extractStxVariantId(line.offerSku) ||
      extractStxVariantId(providerKey) ||
      lookupByGtin(stockxVariantIdByGtin, gtin);
    const size = resolveLabDisplaySize({
      size: line.size,
      productTitle: line.productTitle,
      sizeFromCatalog: lookupByGtin(sizeByGtin, gtin),
    });
    const sku = resolveLabDisplaySku({
      supplierSku: line.supplierSku ?? line.offerSku,
      supplierVariantId: providerKey,
      styleFromCatalog: lookupByGtin(styleByGtin, gtin),
    });

    const shopifyLine: ShopifyLineItem = {
      shopifyOrderId: order.id,
      orderName: orderNumber,
      createdAt: orderDate,
      displayFinancialStatus: "PAID",
      displayFulfillmentStatus: null,
      customerEmail: order.customerEmail ?? null,
      customerName: order.customerName ?? null,
      customerFirstName: null,
      customerLastName: null,
      shippingCountry: order.customerCountry ?? null,
      shippingCity: order.customerCity ?? null,
      lineItemId: line.id,
      title: line.productTitle ?? "Item",
      sku,
      variantTitle: size,
      quantity: 1,
      price: String(line.unitPrice ?? "0"),
      totalPrice: String(line.lineTotal ?? "0"),
      currencyCode: order.currencyCode ?? "CHF",
      sizeEU: size,
      lineItemImageUrl: null,
      gtin,
    };

    for (let unitIndex = 0; unitIndex < qty && units.length < limit; unitIndex++) {
      units.push({
        unitKey: `DECATHLON:${orderNumber}:${line.id}:${unitIndex}`,
        channel: "DECATHLON",
        orderId: order.id,
        orderNumber,
        orderDate,
        lineId: line.id,
        unitIndex,
        remainingQty: qty - unitIndex,
        productTitle: line.productTitle ?? "Item",
        gtin,
        sku,
        styleId: sku,
        sizeRaw: size,
        sizeNormalized: normalizeSizeLabel(size),
        shopifyLine,
        stockxVariantId,
        stockxAccountKeyExpected: accountKey,
      });
    }
  }

  return { units, ordersScanned, nonStxSkipped };
}

async function loadStockxBuysForLab(
  forceRefresh?: boolean,
  options?: {
    buyLimitPerAccount?: number;
    roles?: Array<"shopify" | "galaxus">;
  }
): Promise<{
  buys: LabStockxBuy[];
  fetchedAt: string | null;
  fromCache: boolean;
  accounts: Array<{ accountKey: StockxAccountKey; buyCount: number; source: string }>;
  warnings: string[];
}> {
  const buyLimitPerAccount = Math.max(
    50,
    Math.min(
      300,
      options?.buyLimitPerAccount ?? Number(process.env.MATCHING_LAB_STOCKX_BUY_LIMIT ?? "150")
    )
  );
  const pendingPages = Math.max(
    2,
    Math.min(4, Number(process.env.MATCHING_LAB_PENDING_PAGES ?? "2"))
  );
  const historicalPages = Math.max(
    1,
    Math.min(3, Number(process.env.MATCHING_LAB_HISTORICAL_PAGES ?? "2"))
  );

  const { slots, warnings } = await resolveLabTokenSlots(options?.roles);
  const accountsMeta: Array<{
    accountKey: StockxAccountKey;
    buyCount: number;
    source: string;
  }> = [];
  const buys: LabStockxBuy[] = [];
  const seen = new Set<string>();
  let fetchedAt: string | null = null;
  let anyFromCache = true;

  void forceRefresh;

  for (const slot of slots) {
    try {
      const pref = await prefetchStockxBuyingOrdersForMatching(slot.token, {
        pendingPages,
        historicalPages,
        includeHistorical: true,
      });

      const accountBuys: LabStockxBuy[] = [];
      for (const node of pref.merged) {
        const norm = normalizeStockxBuyingNode(node, slot.accountKey);
        if (!norm) continue;
        if (!isStockxBuyMatchable(norm.statusKey)) continue;
        const key = `${slot.accountKey}:${norm.orderId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        accountBuys.push(norm);
      }

      accountBuys.sort((a, b) => {
        const am = Date.parse(a.purchaseDate) || 0;
        const bm = Date.parse(b.purchaseDate) || 0;
        return bm - am;
      });
      const kept = accountBuys.slice(0, buyLimitPerAccount);
      buys.push(...kept);

      accountsMeta.push({
        accountKey: slot.accountKey,
        buyCount: kept.length,
        source: `${slot.role}:${slot.source}:last${buyLimitPerAccount}`,
      });
      fetchedAt = new Date().toISOString();
      if (!pref.timings.pendingFromCache || !pref.timings.historicalFromCache) {
        anyFromCache = false;
      }
      if (kept.length === 0) {
        warnings.push(
          `StockX ${slot.role}: token OK (${slot.source}) but 0 buys in window`
        );
      }
      console.log(
        `[matching-review-lab] StockX ${slot.role}: last ${kept.length}/${accountBuys.length} (${slot.source})`
      );
    } catch (err) {
      warnings.push(
        `StockX ${slot.role} fetch failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return {
    buys,
    fetchedAt,
    fromCache: anyFromCache && buys.length > 0,
    accounts: accountsMeta,
    warnings,
  };
}

/** Load open units + StockX snapshots. Default 150 units/channel + 150 buys/account. */
export async function loadMatchingReviewBatch(
  options?: LoadBatchOptions
): Promise<LoadBatchResult> {
  const limit = Math.max(1, Math.min(300, options?.limit ?? 150));
  const channels = options?.channels ?? ["SHOPIFY", "GALAXUS", "DECATHLON"];
  const shopifyDays = Math.max(1, Math.min(90, options?.shopifyDays ?? 30));

  // Each selected channel can fill up to `limit` open units (STX_ only for Galaxus/Decathlon).
  const units: LabClientUnit[] = [];
  const warnings: string[] = [];
  let shopifyOrdersScanned = 0;
  let galaxusOrdersScanned = 0;
  let decathlonOrdersScanned = 0;
  let nonStxSkipped = 0;

  if (channels.includes("SHOPIFY")) {
    try {
      const shopify = await loadShopifyOpenUnits(limit, shopifyDays);
      units.push(...shopify.units);
      shopifyOrdersScanned = shopify.ordersScanned;
      warnings.push(...shopify.warnings);
      if (shopify.units.length === 0 && shopify.warnings.length === 0) {
        warnings.push(
          `Shopify: 0 open units in last ${shopifyDays}d (scanned ${shopify.ordersScanned} orders)`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[matching-review-lab] Shopify load failed:", err);
      warnings.push(`Shopify load failed: ${msg}`);
    }
  }

  if (channels.includes("GALAXUS")) {
    try {
      const galaxus = await loadGalaxusOpenUnits(limit);
      units.push(...galaxus.units);
      galaxusOrdersScanned = galaxus.ordersScanned;
      nonStxSkipped += galaxus.nonStxSkipped;
      if (galaxus.units.length === 0) {
        warnings.push(
          `Galaxus: 0 open STX_ units (scanned ${galaxus.ordersScanned} orders, non-STX skip ${galaxus.nonStxSkipped})`
        );
      }
    } catch (err) {
      console.warn("[matching-review-lab] Galaxus load failed:", err);
      warnings.push(
        `Galaxus load failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (channels.includes("DECATHLON")) {
    try {
      const decathlon = await loadDecathlonOpenUnits(limit);
      units.push(...decathlon.units);
      decathlonOrdersScanned = decathlon.ordersScanned;
      nonStxSkipped += decathlon.nonStxSkipped;
    } catch (err) {
      console.warn("[matching-review-lab] Decathlon load failed:", err);
      warnings.push(
        `Decathlon load failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Soft cap total rows in UI batch (per-channel already capped at `limit`).
  const maxTotal = Math.min(500, limit * Math.max(1, channels.length));
  const clipped = units.slice(0, maxTotal);

  // StockX buys only for selected channels — Galaxus-only never needs Shopify token.
  const stockxRoles: Array<"shopify" | "galaxus"> = [];
  if (channels.includes("SHOPIFY")) stockxRoles.push("shopify");
  if (channels.includes("GALAXUS") || channels.includes("DECATHLON")) {
    stockxRoles.push("galaxus");
  }

  const stockx = await loadStockxBuysForLab(options?.forceRefreshStockx, {
    buyLimitPerAccount: Number(process.env.MATCHING_LAB_STOCKX_BUY_LIMIT ?? "150"),
    roles: stockxRoles.length ? stockxRoles : ["shopify", "galaxus"],
  });
  warnings.push(...stockx.warnings);

  return {
    units: clipped,
    buys: stockx.buys,
    freshness: {
      fetchedAt: stockx.fetchedAt,
      fromCache: stockx.fromCache,
      accounts: stockx.accounts,
    },
    meta: {
      shopifyOrdersScanned,
      galaxusOrdersScanned,
      decathlonOrdersScanned,
      limit,
      nonStxSkipped,
    },
    warnings,
  };
}
