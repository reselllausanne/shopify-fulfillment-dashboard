import { NextResponse } from "next/server";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";
import { shopifySellDateUtcWindow, SHOPIFY_SELL_TIMEZONE } from "@/app/utils/shopifySellDate";
import { estimateUnboughtMarginChf, aaaWarehouseMarginChf, presentShopifyLiveSale, summarizeDbShopifyOrder, type TvCostMatch } from "@/app/lib/tvShopifySale";
import { isCrocsLightningMcQueenLine } from "@/galaxus/warehouse/lineInventorySource";
import { isTheWarehouseGalaxusLine } from "@/galaxus/warehouse/theCatalogStock";
import { resolveGalaxusLocalStockCostChf } from "@/galaxus/orders/localStockMatch";
import { galaxusLineNetRevenueChf } from "@/galaxus/orders/margin";
import { isNerGalaxusMarketplaceLine, nerMarginFromCaChf } from "@/galaxus/orders/nerMarketplaceMargin";
import { galaxusLineStockxCostChfByLineId } from "@/galaxus/orders/galaxusLineStockxCostMetrics";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { loadStxQuotes, pickBuyChf } from "@/app/lib/tvLiveBuy";
import { restateStoredBuyChf } from "@/app/lib/stockxAllIn";
import { detectShopifyExpress } from "@/lib/stockxAutoCheckout/detectShopifyExpress";
import { isPhysicalFulfillmentLocationName } from "@/shopify/orders/physicalFulfillmentLocations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 10_000;
let cache: { at: number; body: unknown } | null = null;
let inflight: Promise<unknown> | null = null;

type Channel = "shopify" | "galaxus";

type TvSale = {
  id: string;
  channel: Channel;
  ref: string;
  title: string;
  extraItems: number;
  imageUrl: string | null;
  salesChf: number;
  marginChf: number | null;
  marginEstimated: boolean;
  at: string;
};

const SHOPIFY_TODAY_QUERY = /* GraphQL */ `
  query TvTodayOrders($first: Int!, $after: String, $q: String!) {
    orders(first: $first, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        createdAt
        cancelledAt
        shippingLines(first: 3) {
          nodes {
            title
          }
        }
        currentTotalPriceSet {
          shopMoney {
            amount
          }
        }
        fulfillmentOrders(first: 4) {
          nodes {
            assignedLocation {
              name
            }
            lineItems(first: 8) {
              nodes {
                totalQuantity
                lineItem {
                  id
                }
              }
            }
          }
        }
        lineItems(first: 8) {
          nodes {
            id
            title
            name
            sku
            quantity
            discountedUnitPriceSet {
              shopMoney {
                amount
              }
            }
            variant {
              barcode
              title
            }
            image {
              url
            }
          }
        }
      }
    }
  }
`;

type ShopifyOrderNode = {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  shippingLines?: { nodes?: Array<{ title?: string | null }> };
  currentTotalPriceSet?: { shopMoney?: { amount?: string } };
  fulfillmentOrders?: {
    nodes?: Array<{
      assignedLocation?: { name?: string | null } | null;
      lineItems?: { nodes?: Array<{ lineItem?: { id?: string | null } | null }> };
    }>;
  };
  lineItems?: {
    nodes?: Array<{
      id?: string;
      title?: string;
      name?: string;
      sku?: string | null;
      quantity?: number;
      discountedUnitPriceSet?: { shopMoney?: { amount?: string } };
      variant?: { barcode?: string | null; title?: string | null } | null;
      image?: { url?: string } | null;
    }>;
  };
};

async function fetchShopifyToday(startIso: string): Promise<ShopifyOrderNode[]> {
  const out: ShopifyOrderNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < 6; page += 1) {
    const res: Awaited<
      ReturnType<
        typeof shopifyGraphQL<{
          orders: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: ShopifyOrderNode[];
          };
        }>
      >
    > = await shopifyGraphQL(
      SHOPIFY_TODAY_QUERY,
      { first: 25, after, q: `created_at:>=${startIso}` },
      { estimatedQueryCost: 45, bypassQueue: true, maxAttempts: 8 }
    );
    if (res.errors?.length) throw new Error(res.errors[0]?.message ?? "shopify graphql error");
    // Shopify's created_at search can round the bound down to the whole day; filter exactly here.
    const startMs = new Date(startIso).getTime();
    out.push(
      ...(res.data?.orders?.nodes ?? []).filter((o) => new Date(o.createdAt).getTime() >= startMs)
    );
    if (!res.data?.orders?.pageInfo?.hasNextPage) break;
    after = res.data.orders.pageInfo.endCursor;
  }
  return out;
}

type BuyPriceIndex = {
  byVariantId: Map<string, number>;
  byGtin: Map<string, number>;
};

async function loadBuyPrices(variantIds: string[], gtins: string[]): Promise<BuyPriceIndex> {
  const idx: BuyPriceIndex = { byVariantId: new Map(), byGtin: new Map() };
  const vIds = [...new Set(variantIds.filter(Boolean))];
  const gs = [...new Set(gtins.filter(Boolean))];
  if (!vIds.length && !gs.length) return idx;
  const rows = await prisma.supplierVariant.findMany({
    where: {
      OR: [
        ...(vIds.length ? [{ supplierVariantId: { in: vIds } }] : []),
        ...(gs.length ? [{ gtin: { in: gs } }] : []),
      ],
    },
    select: { supplierVariantId: true, gtin: true, providerKey: true, standardBuyPrice: true, expressBuyPrice: true },
  });
  for (const r of rows) {
    const buy = toNumberSafe(r.standardBuyPrice, 0) || toNumberSafe(r.expressBuyPrice, 0);
    if (buy <= 0) continue;
    idx.byVariantId.set(r.supplierVariantId, buy);
    if (r.gtin) {
      const prev = idx.byGtin.get(r.gtin);
      const isStx = String(r.providerKey ?? "").toUpperCase().startsWith("STX");
      if (prev == null || isStx) idx.byGtin.set(r.gtin, buy);
    }
  }
  return idx;
}

const SHOPIFY_FRESH_MS = 15_000;
const SHOPIFY_WAIT_MS = 12_000;
let shopifyOrdersCache: { at: number; day: string; orders: ShopifyOrderNode[] } | null = null;
let shopifyRefresh: Promise<ShopifyOrderNode[] | null> | null = null;

function startShopifyRefresh(startIso: string, day: string): Promise<ShopifyOrderNode[] | null> {
  if (shopifyRefresh) return shopifyRefresh;
  shopifyRefresh = fetchShopifyToday(startIso)
    .then((orders) => {
      shopifyOrdersCache = { at: Date.now(), day, orders };
      return orders;
    })
    .catch((err) => {
      console.warn("[tv/feed] shopify live fetch failed", err instanceof Error ? err.message : err);
      return null;
    })
    .finally(() => {
      shopifyRefresh = null;
    });
  return shopifyRefresh;
}

/** Never block the kiosk on the Shopify queue. Serve the last good list and refresh behind it. */
async function shopifyOrdersForFeed(startIso: string, day: string): Promise<ShopifyOrderNode[] | null> {
  const cached = shopifyOrdersCache?.day === day ? shopifyOrdersCache : null;
  const age = cached ? Date.now() - cached.at : Number.POSITIVE_INFINITY;
  if (cached && age < SHOPIFY_FRESH_MS) return cached.orders;
  const pending = startShopifyRefresh(startIso, day);
  if (cached) return cached.orders;
  const raced = await Promise.race([
    pending,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), SHOPIFY_WAIT_MS)),
  ]);
  if (raced) return raced;
  return shopifyOrdersCache?.day === day ? shopifyOrdersCache.orders : null;
}

async function build() {
  const now = new Date();
  const todayKey = formatInTimeZone(now, SHOPIFY_SELL_TIMEZONE, "yyyy-MM-dd");
  const startIso = fromZonedTime(`${todayKey}T00:00:00`, SHOPIFY_SELL_TIMEZONE).toISOString();
  const window = shopifySellDateUtcWindow(todayKey)!;

  const [adsRow, matches, galaxusLines, shopifyLive] = await Promise.all([
    prisma.dailyAdSpend.findUnique({ where: { date: window.start }, select: { amountChf: true } }),
    prisma.orderMatch.findMany({
      where: { shopifyCreatedAt: { gte: window.start, lte: window.end } },
      select: {
        shopifyOrderName: true,
        shopifyLineItemId: true,
        shopifyProductTitle: true,
        shopifySku: true,
        shopifySizeEU: true,
        shopifyTotalPrice: true,
        manualRevenueAdjustment: true,
        supplierCost: true,
        manualCostOverride: true,
        supplierSource: true,
        stockxStatus: true,
        stockxOrderNumber: true,
        returnReason: true,
        returnFeePercent: true,
        returnFeeAmountChf: true,
        shopifyCreatedAt: true,
        shopifyLineItemImageUrl: true,
      },
    }),
    prisma.galaxusOrderLine.findMany({
      where: {
        order: { orderDate: { gte: window.start, lte: window.end }, cancelledAt: null },
      },
      select: {
        id: true,
        orderId: true,
        quantity: true,
        productName: true,
        description: true,
        lineNetAmount: true,
        priceLineAmount: true,
        gtin: true,
        supplierSku: true,
        providerKey: true,
        supplierPid: true,
        supplierVariantId: true,
        order: { select: { orderDate: true, galaxusOrderId: true, orderNumber: true } },
        stockxMatches: {
          orderBy: { updatedAt: "desc" },
          select: {
            unitIndex: true,
            stockxAmount: true,
            stockxOrderNumber: true,
            stockxOrderId: true,
            stockxChainId: true,
          },
        },
      },
    }),
    shopifyOrdersForFeed(startIso, todayKey),
  ]);

  const matchesByOrder = new Map<string, TvCostMatch[]>();
  for (const m of matches) {
    const list = matchesByOrder.get(m.shopifyOrderName) ?? [];
    list.push(m);
    matchesByOrder.set(m.shopifyOrderName, list);
  }

  const sales: TvSale[] = [];
  let shopifySales = 0;
  let shopifyOrders = 0;
  let shopifyMargin = 0;
  let shopifyMarginEstimated = 0;

  const costById = await galaxusLineStockxCostChfByLineId(galaxusLines);
  const gxPrices = await loadBuyPrices(
    galaxusLines.map((l) => l.supplierVariantId ?? ""),
    galaxusLines.map((l) => l.gtin ?? "")
  );
  const shopPrices = await loadBuyPrices(
    [],
    (shopifyLive ?? []).flatMap((o) => (o.lineItems?.nodes ?? []).map((li) => li.variant?.barcode ?? ""))
  );
  const shopifyGtins = (shopifyLive ?? []).flatMap((o) => (o.lineItems?.nodes ?? []).map((li) => li.variant?.barcode ?? ""));
  const galaxusPendingGtins = galaxusLines
    .filter((l) => !isNerGalaxusMarketplaceLine(l) && (costById.get(l.id) ?? 0) <= 0)
    .map((l) => l.gtin);
  const quotes = await loadStxQuotes([...shopifyGtins, ...galaxusPendingGtins]);
  const storedBuy = (stored: number | undefined) => (stored && stored > 0 ? restateStoredBuyChf(stored) : undefined);
  const buyUnitChf = (gtin: string, express: boolean) =>
    pickBuyChf(quotes.get(gtin.trim()), express) ?? (gtin ? storedBuy(shopPrices.byGtin.get(gtin)) : undefined);

  if (shopifyLive) {
    for (const o of shopifyLive) {
      if (o.cancelledAt) continue;
      const total = toNumberSafe(o.currentTotalPriceSet?.shopMoney?.amount, 0);
      shopifySales += total;
      shopifyOrders += 1;
      const items = o.lineItems?.nodes ?? [];
      const physicalLineIds: string[] = [];
      for (const fo of o.fulfillmentOrders?.nodes ?? []) {
        if (!isPhysicalFulfillmentLocationName(fo.assignedLocation?.name)) continue;
        for (const l of fo.lineItems?.nodes ?? []) {
          if (l.lineItem?.id) physicalLineIds.push(l.lineItem.id);
        }
      }
      const presented = presentShopifyLiveSale({
        lines: items.map((li) => ({
          id: li.id,
          title: li.title,
          name: li.name,
          sku: li.sku,
          quantity: li.quantity,
          unitPrice: toNumberSafe(li.discountedUnitPriceSet?.shopMoney?.amount, 0),
          imageUrl: li.image?.url ?? null,
          gtin: li.variant?.barcode ?? null,
          variantTitle: li.variant?.title ?? null,
        })),
        matches: matchesByOrder.get(o.name) ?? [],
        physicalLineIds,
        buyUnitChf,
        express: detectShopifyExpress({
          shippingLineTitles: (o.shippingLines?.nodes ?? []).map((n) => n.title),
        }),
      });
      if (presented.marginChf != null) {
        shopifyMargin += presented.marginChf;
        if (presented.marginEstimated) shopifyMarginEstimated += presented.marginChf;
      }
      sales.push({
        id: `shopify:${o.name}`,
        channel: "shopify",
        ref: o.name,
        title: presented.title,
        extraItems: presented.extraItems,
        imageUrl: presented.imageUrl,
        salesChf: total,
        marginChf: presented.marginChf,
        marginEstimated: presented.marginEstimated,
        at: o.createdAt,
      });
    }
  } else {
    // Fallback: DB matches only (may lag live orders).
    for (const [orderName, rows] of matchesByOrder) {
      const presented = summarizeDbShopifyOrder(rows);
      if (!presented || presented.marginChf == null) continue;
      shopifySales += presented.salesChf;
      shopifyOrders += 1;
      shopifyMargin += presented.marginChf;
      const at = rows.find((r) => r.shopifyCreatedAt)?.shopifyCreatedAt ?? now;
      sales.push({
        id: `shopify:${orderName}`,
        channel: "shopify",
        ref: orderName,
        title: presented.title,
        extraItems: presented.extraItems,
        imageUrl: presented.imageUrl,
        salesChf: presented.salesChf,
        marginChf: presented.marginChf,
        marginEstimated: false,
        at: at.toISOString(),
      });
    }
  }

  const shopifyMarginPending = shopifyLive
    ? sales.filter((x) => x.channel === "shopify" && x.marginChf == null).length
    : 0;

  // ---- Galaxus ----
  const gxOrders = new Map<
    string,
    { ref: string; title: string; lines: number; sales: number; margin: number; hasMargin: boolean; estimated: boolean; at: Date }
  >();
  let galaxusSales = 0;
  let galaxusMargin = 0;
  let galaxusMarginEstimated = 0;
  const isLocal = (m: { stockxOrderNumber?: string | null }) =>
    String(m.stockxOrderNumber ?? "").toUpperCase().startsWith("LOCAL-STOCK");

  for (const line of galaxusLines) {
    const revenue = galaxusLineNetRevenueChf({
      lineNetAmount: line.lineNetAmount,
      priceLineAmount: line.priceLineAmount,
    });
    if (revenue == null) continue;
    galaxusSales += revenue;
    let margin: number | null = null;
    let estimated = false;
    if (isNerGalaxusMarketplaceLine(line)) {
      margin = nerMarginFromCaChf(revenue);
    } else {
      const qty = Math.max(1, line.quantity ?? 1);
      const fixed = resolveGalaxusLocalStockCostChf({
        productName: line.productName,
        description: line.description,
        supplierSku: line.supplierSku,
      });
      const warehouse =
        fixed != null ||
        line.stockxMatches.some(isLocal) ||
        isCrocsLightningMcQueenLine(line) ||
        isTheWarehouseGalaxusLine(line);
      const warehouseMargin = aaaWarehouseMarginChf({
        revenue,
        qty,
        warehouse,
        fixedUnitCostChf: fixed?.costChf ?? null,
      });
      if (warehouseMargin != null) {
        margin = warehouseMargin;
      } else {
        const unitRev = revenue / qty;
        const ownedUnits = new Set(line.stockxMatches.filter(isLocal).map((m) => m.unitIndex)).size;
        const boughtUnits = new Set(
          line.stockxMatches.filter((m) => !isLocal(m) && Number(m.stockxAmount) > 0).map((m) => m.unitIndex)
        ).size;
        const realCost = costById.get(line.id) ?? 0;
        const bought = realCost > 0 ? Math.min(qty, Math.max(1, boughtUnits)) : 0;
        const owned = Math.min(qty - bought, ownedUnits);
        const rest = Math.max(0, qty - bought - owned);
        let m: number | null = owned * unitRev;
        if (bought > 0) m += bought * unitRev - realCost;
        if (rest > 0) {
          const unit =
            pickBuyChf(quotes.get(String(line.gtin ?? "").trim()), false) ??
            storedBuy(line.supplierVariantId ? gxPrices.byVariantId.get(line.supplierVariantId) : undefined) ??
            storedBuy(line.gtin ? gxPrices.byGtin.get(line.gtin) : undefined);
          const est = estimateUnboughtMarginChf(rest * unitRev, rest, unit);
          m = est == null ? null : m + est;
          estimated = true;
        }
        margin = m;
      }
    }
    if (margin != null) {
      galaxusMargin += margin;
      if (estimated) galaxusMarginEstimated += margin;
    }
    const key = line.orderId;
    const g =
      gxOrders.get(key) ??
      {
        ref: line.order?.orderNumber ?? line.order?.galaxusOrderId ?? key.slice(0, 8),
        title: line.productName,
        lines: 0,
        sales: 0,
        margin: 0,
        hasMargin: false,
        estimated: false,
        at: line.order?.orderDate ?? now,
      };
    g.lines += 1;
    g.sales += revenue;
    if (margin != null) {
      g.margin += margin;
      g.hasMargin = true;
      if (estimated) g.estimated = true;
    }
    gxOrders.set(key, g);
  }
  for (const [id, g] of gxOrders) {
    sales.push({
      id: `galaxus:${id}`,
      channel: "galaxus",
      ref: g.ref,
      title: g.title,
      extraItems: g.lines - 1,
      imageUrl: null,
      salesChf: g.sales,
      marginChf: g.hasMargin ? g.margin : null,
      marginEstimated: g.estimated,
      at: g.at.toISOString(),
    });
  }

  sales.sort((a, b) => b.at.localeCompare(a.at));

  return {
    generatedAt: now.toISOString(),
    day: todayKey,
    totals: {
      salesChf: Math.round((shopifySales + galaxusSales) * 100) / 100,
      marginChf: Math.round((shopifyMargin + galaxusMargin) * 100) / 100,
      adsSpendChf: Math.round(toNumberSafe(adsRow?.amountChf, 0) * 100) / 100,
      netMarginChf:
        Math.round((shopifyMargin + galaxusMargin - toNumberSafe(adsRow?.amountChf, 0)) * 100) / 100,
      orders: shopifyOrders + gxOrders.size,
    },
    shopify: {
      salesChf: Math.round(shopifySales * 100) / 100,
      marginChf: Math.round(shopifyMargin * 100) / 100,
      orders: shopifyOrders,
      marginEstimatedChf: Math.round(shopifyMarginEstimated * 100) / 100,
      marginPending: shopifyMarginPending,
      live: shopifyLive != null,
    },
    galaxus: {
      salesChf: Math.round(galaxusSales * 100) / 100,
      marginChf: Math.round(galaxusMargin * 100) / 100,
      marginEstimatedChf: Math.round(galaxusMarginEstimated * 100) / 100,
      orders: gxOrders.size,
    },
    // Every sale of the day: the TV only plays the sound for ids it has never seen.
    allIds: sales.map((x) => x.id),
    sales: sales.slice(0, 15),
  };
}

export async function GET() {
  try {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) return NextResponse.json(cache.body);
    if (!inflight) {
      inflight = build().finally(() => {
        inflight = null;
      });
    }
    const body = await inflight;
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (error: unknown) {
    console.error("[tv/feed] error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "tv feed failed" },
      { status: 500 }
    );
  }
}
