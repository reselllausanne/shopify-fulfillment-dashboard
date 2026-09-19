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
import {
  listStockxAccountTokens,
  resolveGalaxusStockxBearerToken,
  resolveStockxBearerToken,
} from "@/lib/stockxToken";
import { resolveShopifyAdminEnv } from "@/lib/shopifyEnv";
import {
  stockxAccountKeyForGalaxus,
  stockxAccountKeyForShopify,
} from "./accountKeys";
import { isStockxBuyMatchable, normalizeSizeLabel, normalizeStockxBuyingNode } from "./normalize";
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
    limit: number;
  };
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

async function shopifyGql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const { shop, token, version } = resolveShopifyAdminEnv();
  if (!shop || !token) throw new Error("Missing Shopify admin env");
  const host = shop.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const res = await fetch(`https://${host}/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: T; errors?: unknown[] };
  if (json.errors?.length) throw new Error(`Shopify GQL: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}

async function loadShopifyOpenUnits(limit: number, days: number): Promise<{
  units: LabClientUnit[];
  ordersScanned: number;
}> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (days - 1));
  since.setUTCHours(0, 0, 0, 0);

  const query = `
    query LabOpenOrders($cursor: String) {
      orders(
        first: 50
        after: $cursor
        sortKey: CREATED_AT
        reverse: true
        query: "created_at:>=${since.toISOString().slice(0, 10)} financial_status:paid -status:cancelled"
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
            lineItems(first: 50) {
              edges {
                node {
                  id
                  title
                  variantTitle
                  sku
                  quantity
                  currentQuantity
                  originalUnitPriceSet { shopMoney { amount currencyCode } }
                  image { url }
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

  while (units.length < limit) {
    const data: OrdersPage = await shopifyGql<OrdersPage>(query, { cursor });

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
        const remaining = Math.max(
          0,
          Number(li.currentQuantity ?? li.quantity ?? 0)
        );
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
          customerName: [o.customer?.firstName, o.customer?.lastName]
            .filter(Boolean)
            .join(" ") || null,
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
          lineItemImageUrl: li.image?.url ?? null,
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

  return { units, ordersScanned };
}

async function loadGalaxusOpenUnits(limit: number): Promise<{
  units: LabClientUnit[];
  ordersScanned: number;
}> {
  const orders = await prisma.galaxusOrder.findMany({
    where: { cancelledAt: null, archivedAt: null },
    orderBy: { orderDate: "desc" },
    take: Math.min(500, Math.max(limit * 2, 50)),
    include: { lines: true },
  });

  const units: LabClientUnit[] = [];
  let ordersScanned = 0;
  const accountKey = stockxAccountKeyForGalaxus({ source: "galaxus" });

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
      if (line.warehouseMarkedShippedAt) continue;
      const qty = Math.max(0, Math.round(Number(line.quantity ?? 0)));
      if (qty <= 0) continue;

      const supplierVariantId = String((line as any).supplierVariantId ?? "").trim();
      const stockxVariantId = supplierVariantId.startsWith("stx_")
        ? supplierVariantId.replace(/^stx_/, "")
        : null;

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
        sku: ((line as any).supplierSku ?? supplierVariantId) || null,
        variantTitle: line.size ?? null,
        quantity: 1,
        price: String((line as any).unitNetPrice ?? "0"),
        totalPrice: String((line as any).lineNetAmount ?? "0"),
        currencyCode: order.currencyCode ?? "CHF",
        sizeEU: line.size ?? null,
        lineItemImageUrl: null,
        gtin: (line as any).gtin ? String((line as any).gtin) : null,
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
          gtin: (line as any).gtin ? String((line as any).gtin) : null,
          sku: (line as any).supplierSku ?? null,
          styleId: (line as any).supplierSku ?? null,
          sizeRaw: line.size ?? null,
          sizeNormalized: normalizeSizeLabel(line.size),
          shopifyLine,
          stockxVariantId,
          stockxAccountKeyExpected: accountKey,
        });
      }
      if (units.length >= limit) break;
    }
    if (units.length >= limit) break;
  }

  return { units, ordersScanned };
}

async function loadStockxBuysForLab(forceRefresh?: boolean): Promise<{
  buys: LabStockxBuy[];
  fetchedAt: string | null;
  fromCache: boolean;
  accounts: Array<{ accountKey: StockxAccountKey; buyCount: number; source: string }>;
}> {
  const tokens = await listStockxAccountTokens();
  const accountsMeta: Array<{
    accountKey: StockxAccountKey;
    buyCount: number;
    source: string;
  }> = [];
  const buys: LabStockxBuy[] = [];
  const seen = new Set<string>();
  let fetchedAt: string | null = null;
  let anyFromCache = true;

  const ensureTokens =
    tokens.length > 0
      ? tokens
      : await (async () => {
          const shopify = await resolveStockxBearerToken();
          const galaxus = await resolveGalaxusStockxBearerToken();
          const out: Array<{
            token: string;
            source: "db" | "dashboard" | "galaxus";
            customerUuid: string | null;
          }> = [];
          if (shopify) {
            out.push({
              token: shopify.token,
              source: shopify.source === "galaxus" ? "dashboard" : shopify.source,
              customerUuid: null,
            });
          }
          if (galaxus && galaxus.token !== shopify?.token) {
            out.push({
              token: galaxus.token,
              source: galaxus.source === "galaxus" ? "galaxus" : galaxus.source,
              customerUuid: null,
            });
          }
          return out;
        })();

  for (const t of ensureTokens) {
    const isGalaxus = t.source === "galaxus";
    const accountKey = isGalaxus
      ? stockxAccountKeyForGalaxus({
          customerUuid: t.customerUuid,
          source: t.source,
        })
      : stockxAccountKeyForShopify({
          customerUuid: t.customerUuid,
          source: t.source,
        });

    // Bounded pages — not full history. PENDING + short HISTORICAL.
    if (forceRefresh) {
      // Bust by using getCached with force via prefetch path (prefetch uses TTL cache).
      // Callers can set STOCKX_BUYING_CACHE_TTL_MS low locally.
    }
    const pref = await prefetchStockxBuyingOrdersForMatching(t.token, {
      pendingPages: Number(process.env.MATCHING_LAB_PENDING_PAGES ?? "4"),
      historicalPages: Number(process.env.MATCHING_LAB_HISTORICAL_PAGES ?? "2"),
      includeHistorical: true,
    });

    let count = 0;
    for (const node of pref.merged) {
      const norm = normalizeStockxBuyingNode(node, accountKey);
      if (!norm) continue;
      if (!isStockxBuyMatchable(norm.statusKey)) continue;
      const key = `${accountKey}:${norm.orderId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      buys.push(norm);
      count += 1;
    }

    accountsMeta.push({
      accountKey,
      buyCount: count,
      source: t.source,
    });
    fetchedAt = new Date().toISOString();
    if (!pref.timings.pendingFromCache || !pref.timings.historicalFromCache) {
      anyFromCache = false;
    }
  }

  return {
    buys,
    fetchedAt,
    fromCache: anyFromCache && buys.length > 0,
    accounts: accountsMeta,
  };
}

/** Load open units + relevant StockX buys (server cache). Default limit 120. */
export async function loadMatchingReviewBatch(
  options?: LoadBatchOptions
): Promise<LoadBatchResult> {
  const limit = Math.max(1, Math.min(300, options?.limit ?? 120));
  const channels = options?.channels ?? ["SHOPIFY", "GALAXUS"];
  const shopifyDays = Math.max(1, Math.min(90, options?.shopifyDays ?? 30));

  const perChannel = Math.ceil(limit / Math.max(1, channels.length));
  const units: LabClientUnit[] = [];
  let shopifyOrdersScanned = 0;
  let galaxusOrdersScanned = 0;

  if (channels.includes("SHOPIFY")) {
    try {
      const shopify = await loadShopifyOpenUnits(perChannel, shopifyDays);
      units.push(...shopify.units);
      shopifyOrdersScanned = shopify.ordersScanned;
    } catch (err) {
      console.warn("[matching-review-lab] Shopify load failed:", err);
    }
  }

  if (channels.includes("GALAXUS") && units.length < limit) {
    try {
      const galaxus = await loadGalaxusOpenUnits(limit - units.length);
      units.push(...galaxus.units);
      galaxusOrdersScanned = galaxus.ordersScanned;
    } catch (err) {
      console.warn("[matching-review-lab] Galaxus load failed:", err);
    }
  }

  const stockx = await loadStockxBuysForLab(options?.forceRefreshStockx);

  return {
    units: units.slice(0, limit),
    buys: stockx.buys,
    freshness: {
      fetchedAt: stockx.fetchedAt,
      fromCache: stockx.fromCache,
      accounts: stockx.accounts,
    },
    meta: {
      shopifyOrdersScanned,
      galaxusOrdersScanned,
      limit,
    },
  };
}
