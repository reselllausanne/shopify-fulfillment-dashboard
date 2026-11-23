import { NextResponse } from "next/server";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";
import { resolveOrderMatchCost } from "@/app/utils/matching";
import { shopifySellDateUtcWindow, SHOPIFY_SELL_TIMEZONE } from "@/app/utils/shopifySellDate";
import { galaxusLineNetRevenueChf } from "@/galaxus/orders/margin";
import { isNerGalaxusMarketplaceLine, nerMarginFromCaChf } from "@/galaxus/orders/nerMarketplaceMargin";
import { galaxusLineStockxCostChfByLineId } from "@/galaxus/orders/galaxusLineStockxCostMetrics";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { liveBuyChfCached, refreshLiveBuy } from "@/app/lib/tvLiveBuy";
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
        currentTotalPriceSet {
          shopMoney {
            amount
          }
        }
        fulfillmentOrders(first: 5) {
          nodes {
            assignedLocation {
              name
            }
            lineItems(first: 20) {
              nodes {
                totalQuantity
                lineItem {
                  id
                }
              }
            }
          }
        }
        lineItems(first: 10) {
          nodes {
            id
            title
            quantity
            discountedUnitPriceSet {
              shopMoney {
                amount
              }
            }
            variant {
              barcode
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
      quantity?: number;
      discountedUnitPriceSet?: { shopMoney?: { amount?: string } };
      variant?: { barcode?: string | null } | null;
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
      { first: 100, after, q: `created_at:>=${startIso}` },
      { estimatedQueryCost: 120 }
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
        shopifyProductTitle: true,
        shopifySku: true,
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
    fetchShopifyToday(startIso).catch((err) => {
      console.warn("[tv/feed] shopify live fetch failed", err?.message ?? err);
      return null;
    }),
  ]);

  // ---- Shopify margin from matched lines (by order name) ----
  const marginByOrder = new Map<string, { margin: number; sales: number; image: string | null }>();
  for (const m of matches) {
    const { cost, fullMargin } = resolveOrderMatchCost(m);
    const base = toNumberSafe(m.shopifyTotalPrice, 0) + toNumberSafe(m.manualRevenueAdjustment, 0);
    const pct = toNumberSafe(m.returnFeePercent, 0);
    const fee = m.returnReason
      ? toNumberSafe(m.returnFeeAmountChf, pct > 0 ? (toNumberSafe(m.shopifyTotalPrice, 0) * pct) / 100 : 0)
      : 0;
    const revenue = m.returnReason ? fee : base;
    if (!fullMargin && !m.returnReason && (cost <= 0 || revenue <= 0)) continue;
    const prev = marginByOrder.get(m.shopifyOrderName) ?? { margin: 0, sales: 0, image: null };
    prev.margin += revenue - cost;
    prev.sales += revenue;
    prev.image = prev.image ?? m.shopifyLineItemImageUrl ?? null;
    marginByOrder.set(m.shopifyOrderName, prev);
  }

  const sales: TvSale[] = [];
  let shopifySales = 0;
  let shopifyOrders = 0;

  const shopPrices = await loadBuyPrices(
    [],
    (shopifyLive ?? []).flatMap((o) => (o.lineItems?.nodes ?? []).map((li) => li.variant?.barcode ?? ""))
  );
  let shopifyMarginEstimated = 0;
  refreshLiveBuy(
    (shopifyLive ?? [])
      .filter((o) => !o.cancelledAt && !marginByOrder.has(o.name))
      .flatMap((o) => (o.lineItems?.nodes ?? []).map((li) => li.variant?.barcode))
  );

  if (shopifyLive) {
    for (const o of shopifyLive) {
      if (o.cancelledAt) continue;
      const total = toNumberSafe(o.currentTotalPriceSet?.shopMoney?.amount, 0);
      shopifySales += total;
      shopifyOrders += 1;
      const items = o.lineItems?.nodes ?? [];
      const first = items[0];
      let marginChf: number | null = marginByOrder.has(o.name) ? marginByOrder.get(o.name)!.margin : null;
      let marginEstimated = false;
      if (marginChf == null) {
        // Lines fulfilled from a physical site (e.g. Warehouse Bussigny): stock already expensed → 100% margin.
        const physicalLineIds = new Set<string>();
        for (const fo of o.fulfillmentOrders?.nodes ?? []) {
          if (!isPhysicalFulfillmentLocationName(fo.assignedLocation?.name)) continue;
          for (const l of fo.lineItems?.nodes ?? []) {
            if (l.lineItem?.id) physicalLineIds.add(l.lineItem.id);
          }
        }
        let est = 0;
        let known = 0;
        let physicalOnly = items.length > 0;
        for (const li of items) {
          const qty0 = Math.max(1, li.quantity ?? 1);
          const price0 = toNumberSafe(li.discountedUnitPriceSet?.shopMoney?.amount, 0);
          if (li.id && physicalLineIds.has(li.id)) {
            est += price0 * qty0;
            known += 1;
            continue;
          }
          physicalOnly = false;
          const gtin = li.variant?.barcode ?? "";
          const qty = Math.max(1, li.quantity ?? 1);
          const price = toNumberSafe(li.discountedUnitPriceSet?.shopMoney?.amount, 0);
          if (price <= 0) continue;
          const unit = liveBuyChfCached(gtin) ?? (gtin ? shopPrices.byGtin.get(gtin) : undefined);
          // No buy price anywhere: assume 20% margin.
          est += unit && unit > 0 ? (price - unit) * qty : price * qty * 0.2;
          known += 1;
        }
        if (known > 0) {
          marginChf = est;
          marginEstimated = !physicalOnly;
          shopifyMarginEstimated += est;
        }
      }
      sales.push({
        id: `shopify:${o.id}`,
        channel: "shopify",
        ref: o.name,
        title: first?.title ?? "Commande Shopify",
        extraItems: Math.max(0, items.length - 1),
        imageUrl: first?.image?.url ?? marginByOrder.get(o.name)?.image ?? null,
        salesChf: total,
        marginChf,
        marginEstimated,
        at: o.createdAt,
      });
    }
  } else {
    // Fallback: DB matches only (may lag live orders).
    const seen = new Map<string, TvSale>();
    for (const m of matches) {
      const agg = marginByOrder.get(m.shopifyOrderName);
      if (!agg || seen.has(m.shopifyOrderName)) continue;
      shopifySales += agg.sales;
      shopifyOrders += 1;
      seen.set(m.shopifyOrderName, {
        id: `shopify:${m.shopifyOrderName}`,
        channel: "shopify",
        ref: m.shopifyOrderName,
        title: m.shopifyProductTitle,
        extraItems: 0,
        imageUrl: agg.image,
        salesChf: agg.sales,
        marginChf: agg.margin,
        marginEstimated: false,
        at: (m.shopifyCreatedAt ?? now).toISOString(),
      });
    }
    sales.push(...seen.values());
  }

  let shopifyMargin = shopifyMarginEstimated;
  for (const v of marginByOrder.values()) shopifyMargin += v.margin;
  const shopifyMarginPending = shopifyLive
    ? sales.filter((x) => x.channel === "shopify" && x.marginChf == null).length
    : 0;

  // ---- Galaxus ----
  const costById = await galaxusLineStockxCostChfByLineId(galaxusLines);
  const gxOrders = new Map<
    string,
    { ref: string; title: string; lines: number; sales: number; margin: number; hasMargin: boolean; estimated: boolean; at: Date }
  >();
  let galaxusSales = 0;
  let galaxusMargin = 0;
  let galaxusMarginEstimated = 0;
  const gxPrices = await loadBuyPrices(
    galaxusLines.map((l) => l.supplierVariantId ?? ""),
    galaxusLines.map((l) => l.gtin ?? "")
  );
  // Fallback when no buy price exists anywhere: assume 20% margin.
  const FALLBACK_MARGIN = 0.2;
  const isLocal = (m: { stockxOrderNumber?: string | null }) =>
    String(m.stockxOrderNumber ?? "").toUpperCase().startsWith("LOCAL-STOCK");
  // Live KicksDB buy price for every STX pair still without a real purchase (refreshes in background).
  refreshLiveBuy(
    galaxusLines
      .filter((l) => !isNerGalaxusMarketplaceLine(l) && (costById.get(l.id) ?? 0) <= 0)
      .map((l) => l.gtin)
  );

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
      // Per unit: owned local stock = 100%, real purchase = revenue - cost, rest = live/DB buy price (else 20%).
      const qty = Math.max(1, line.quantity ?? 1);
      const unitRev = revenue / qty;
      const ownedUnits = new Set(line.stockxMatches.filter(isLocal).map((m) => m.unitIndex)).size;
      const boughtUnits = new Set(
        line.stockxMatches.filter((m) => !isLocal(m) && Number(m.stockxAmount) > 0).map((m) => m.unitIndex)
      ).size;
      const realCost = costById.get(line.id) ?? 0;
      const bought = realCost > 0 ? Math.min(qty, Math.max(1, boughtUnits)) : 0;
      const owned = Math.min(qty - bought, ownedUnits);
      const rest = Math.max(0, qty - bought - owned);
      let m = owned * unitRev;
      if (bought > 0) m += bought * unitRev - realCost;
      if (rest > 0) {
        const unit =
          liveBuyChfCached(line.gtin) ??
          (line.supplierVariantId ? gxPrices.byVariantId.get(line.supplierVariantId) : undefined) ??
          (line.gtin ? gxPrices.byGtin.get(line.gtin) : undefined);
        m += unit && unit > 0 ? rest * (unitRev - unit) : rest * unitRev * FALLBACK_MARGIN;
        estimated = true;
      }
      margin = m;
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
      marginEstimatedChf: Math.round(shopifyMarginEstimated),
      marginPending: shopifyMarginPending,
      live: shopifyLive != null,
    },
    galaxus: {
      salesChf: Math.round(galaxusSales * 100) / 100,
      marginChf: Math.round(galaxusMargin * 100) / 100,
      marginEstimatedChf: Math.round(galaxusMarginEstimated),
      orders: gxOrders.size,
    },
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
