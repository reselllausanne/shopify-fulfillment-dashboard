/**
 * Verified Shopify open-line loader for the AWB fallback path.
 *
 * The old fallback trusted an OrderMatch row's freshness and hardcoded
 * `remainingQuantity: 1` — which meant a cancelled order, a fully fulfilled
 * order, or a line already picked by a sibling scan could still be selected
 * as an "open" candidate and printed a wrong label.
 *
 * Discovery sources (hints only):
 *   - OrderMatch rows with empty AWB for the SKU
 *   - live Shopify open orders searched by variant SKU (covers orders that were
 *     never matched to a StockX buy — no OrderMatch row at all)
 * Every hint is re-verified against live Shopify state (fulfillment orders +
 * order shipping info) to keep only lines that are actually open.
 */

import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import {
  fetchOrderFulfillmentMap,
  fetchOrderShippingInfo,
} from "@/lib/shopifyFulfillment";
import { listAllOpenUnits } from "@/lib/shopifyOrderOpenSiblings";
import { isValidStockxBuyAfterCustomerOrder } from "@/app/lib/stockxCausal";
import {
  dropLinesLinkedElsewhere,
  resolveShopifyAwbFallbackMatch,
  type InboundPackageLike,
  type OpenShopifyLineCandidate,
  type ShopifyAwbFallbackMatch,
  shopifySkuBase,
  skuEquals,
  sortOpenLinesFifo,
} from "@/app/lib/shopifyAwbFallback";
import { shopifyMatchMinCreatedAt } from "@/app/lib/shopifyMatchEligibility";
import { toShopifyOrderGid } from "@/app/lib/swissPostCustomerTracking";

/** Max Shopify orders verified live per scan (2 API calls each). */
const MAX_ORDERS_VERIFIED = 12;
const MAX_SKUS_PER_SEARCH = 25;

export type ShopifyOrderHint = {
  shopifyOrderId: string;
  shopifyOrderName: string | null;
  shopifyLineItemId: string | null;
  shopifySku: string | null;
  shopifySizeEU: string | null;
  shopifyProductTitle: string | null;
  shopifyCreatedAt: string | Date | null;
};

/**
 * Load OrderMatch rows keyed on the package SKU as *hints* for which Shopify
 * orders to inspect. These rows are NOT treated as authoritative open lines;
 * caller must verify each hint against live Shopify state.
 */
export async function loadShopifyOrderHintsForSku(params: {
  sku: string;
  sizeEU?: string | null;
  minCreatedAt?: Date;
}): Promise<ShopifyOrderHint[]> {
  const sku = String(params.sku ?? "").trim();
  if (!sku) return [];
  const minCreatedAt = params.minCreatedAt ?? shopifyMatchMinCreatedAt();
  // Discovery only — size filtered later (StockX US vs Shopify EU / SKU suffix).
  void params.sizeEU;

  const rows = await prisma.orderMatch.findMany({
    where: {
      shopifyCreatedAt: { gte: minCreatedAt },
      AND: [
        {
          OR: [{ stockxAwb: null }, { stockxAwb: "" }],
        },
        {
          // Shopify SKUs often embed size: BASE-42 / BASE-XL
          OR: [
            { shopifySku: { equals: sku, mode: "insensitive" } },
            { shopifySku: { startsWith: `${sku}-`, mode: "insensitive" } },
          ],
        },
      ],
    },
    orderBy: { shopifyCreatedAt: "asc" },
    take: 60,
    select: {
      shopifyOrderId: true,
      shopifyOrderName: true,
      shopifyLineItemId: true,
      shopifySku: true,
      shopifySizeEU: true,
      shopifyProductTitle: true,
      shopifyCreatedAt: true,
    },
  });
  return rows as ShopifyOrderHint[];
}

function escapeSearchValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Shopify orders search: open (unfulfilled/partial), not cancelled, in window, any of the SKUs. */
export function buildOpenOrdersBySkuSearchQuery(skus: string[], minCreatedAt: Date): string | null {
  const unique = Array.from(
    new Set(skus.map((s) => String(s ?? "").trim()).filter(Boolean))
  ).slice(0, MAX_SKUS_PER_SEARCH);
  if (unique.length === 0) return null;
  const skuClause = unique.map((s) => `sku:"${escapeSearchValue(s)}"`).join(" OR ");
  const ymd = minCreatedAt.toISOString().slice(0, 10);
  return `(${skuClause}) (fulfillment_status:unfulfilled OR fulfillment_status:partial) -status:cancelled created:>=${ymd}`;
}

const OPEN_ORDERS_BY_SKU_QUERY = /* GraphQL */ `
  query ScanOpenOrdersBySku($first: Int!, $query: String!) {
    orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: false) {
      nodes {
        id
        name
        createdAt
        cancelledAt
      }
    }
  }
`;

/**
 * Live Shopify discovery: open orders containing any of the SKUs, oldest first.
 * Returns order-level hints (line verification happens afterwards).
 */
export async function discoverOpenShopifyOrderHintsBySku(params: {
  skus: string[];
  minCreatedAt?: Date;
  limit?: number;
}): Promise<ShopifyOrderHint[]> {
  const minCreatedAt = params.minCreatedAt ?? shopifyMatchMinCreatedAt();
  const query = buildOpenOrdersBySkuSearchQuery(params.skus, minCreatedAt);
  if (!query) return [];
  try {
    const { data, errors } = await shopifyGraphQL<{
      orders: {
        nodes: Array<{ id: string; name: string; createdAt: string; cancelledAt: string | null }>;
      };
    }>(OPEN_ORDERS_BY_SKU_QUERY, { first: params.limit ?? MAX_ORDERS_VERIFIED, query });
    if (errors?.length) {
      console.warn("[SHOPIFY-OPEN-DISCOVER] search errors", errors);
      return [];
    }
    return (data?.orders?.nodes ?? [])
      .filter((o) => o?.id && !o.cancelledAt)
      .filter((o) => new Date(o.createdAt).getTime() >= minCreatedAt.getTime())
      .map((o) => ({
        shopifyOrderId: o.id,
        shopifyOrderName: o.name ?? null,
        shopifyLineItemId: null,
        shopifySku: null,
        shopifySizeEU: null,
        shopifyProductTitle: null,
        shopifyCreatedAt: o.createdAt,
      }));
  } catch (err: any) {
    console.warn("[SHOPIFY-OPEN-DISCOVER] search failed", err?.message || String(err));
    return [];
  }
}

/**
 * Shopify variant SKUs that may carry the inbound style SKU: mirror rows with
 * SKU = base / base-<size>, plus catalog (SupplierVariant.supplierSku → GTIN →
 * Shopify variant SKU).
 */
export async function resolveShopifySkusForStyle(styleSku: string): Promise<string[]> {
  const sku = String(styleSku ?? "").trim();
  if (!sku) return [];
  const base = shopifySkuBase(sku) || sku;
  const catalog = await prisma.supplierVariant.findMany({
    where: {
      OR: [
        { supplierSku: { equals: sku, mode: "insensitive" } },
        { supplierSku: { equals: base, mode: "insensitive" } },
      ],
      gtin: { not: null },
    },
    select: { gtin: true },
    take: 60,
  });
  const gtins = Array.from(
    new Set(catalog.map((r) => String(r.gtin ?? "").trim()).filter(Boolean))
  );
  const mirror = await prisma.shopifyVariantLocationStock.findMany({
    where: {
      sku: { not: null },
      OR: [
        { sku: { equals: sku, mode: "insensitive" } },
        { sku: { startsWith: `${sku}-`, mode: "insensitive" } },
        ...(base !== sku
          ? [
              { sku: { equals: base, mode: "insensitive" as const } },
              { sku: { startsWith: `${base}-`, mode: "insensitive" as const } },
            ]
          : []),
        ...(gtins.length ? [{ gtin: { in: gtins } }] : []),
      ],
    },
    select: { sku: true },
    distinct: ["sku"],
    take: 80,
  });
  return Array.from(
    new Set([sku, ...mirror.map((r) => String(r.sku ?? "").trim()).filter(Boolean)])
  );
}

/** Concatenate hint sources; order-level dedupe happens in loadLiveOpenShopifyLines. */
export function mergeOrderHints(...lists: ShopifyOrderHint[][]): ShopifyOrderHint[] {
  return lists.flat().filter((h) => String(h.shopifyOrderId ?? "").trim().length > 0);
}

/**
 * Pure filter — returns hints whose SKU matches the package and whose
 * causality holds (customer order created on or before StockX buy).
 * Unknown purchase date → causality not checked (caller must not auto-link).
 * Exposed for tests so the discovery vs. verification split stays honest.
 */
export function filterVerifiedOpenCandidates(
  pkg: Pick<InboundPackageLike, "sku" | "purchaseDate">,
  candidates: OpenShopifyLineCandidate[]
): OpenShopifyLineCandidate[] {
  if (!pkg?.sku) return [];
  return (candidates ?? []).filter((c) => {
    if (!c.shopifyLineItemId) return false;
    if (!(Number(c.remainingQuantity) > 0)) return false;
    if (!skuEquals(pkg.sku, c.shopifySku)) return false;
    if (
      pkg.purchaseDate &&
      !isValidStockxBuyAfterCustomerOrder(c.shopifyCreatedAt, pkg.purchaseDate)
    ) {
      return false;
    }
    return true;
  });
}

/**
 * For each unique Shopify order in the hints (oldest first, capped), load live
 * fulfillment state and emit one candidate per open line accepted by
 * `acceptSku`. Cancelled / fully fulfilled orders are dropped.
 */
export async function loadLiveOpenShopifyLines(params: {
  hints: ShopifyOrderHint[];
  acceptSku: (sku: string | null) => boolean;
}): Promise<OpenShopifyLineCandidate[]> {
  const { hints, acceptSku } = params;
  const createdMs = (h: ShopifyOrderHint) => {
    const t = h.shopifyCreatedAt ? new Date(h.shopifyCreatedAt).getTime() : NaN;
    return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
  };
  const orderIds = Array.from(
    new Set(
      [...hints]
        .sort((a, b) => createdMs(a) - createdMs(b))
        .map((h) => toShopifyOrderGid(h.shopifyOrderId))
        .filter((id) => id.length > 0)
    )
  ).slice(0, MAX_ORDERS_VERIFIED);
  if (orderIds.length === 0) return [];

  // Bulk-load cancelled markers so we can skip whole orders cheaply.
  const cancelled = await prisma.shopifyOrder.findMany({
    where: { shopifyOrderId: { in: orderIds }, cancelledAt: { not: null } },
    select: { shopifyOrderId: true },
  });
  const cancelledSet = new Set(cancelled.map((r) => r.shopifyOrderId));

  const verified: OpenShopifyLineCandidate[] = [];

  for (const shopifyOrderId of orderIds) {
    if (cancelledSet.has(shopifyOrderId)) continue;

    let map: Awaited<ReturnType<typeof fetchOrderFulfillmentMap>>;
    let info: Awaited<ReturnType<typeof fetchOrderShippingInfo>>;
    try {
      [map, info] = await Promise.all([
        fetchOrderFulfillmentMap(shopifyOrderId),
        fetchOrderShippingInfo(shopifyOrderId),
      ]);
    } catch (err: any) {
      console.warn("[SHOPIFY-OPEN-VERIFY] load failed", {
        shopifyOrderId,
        error: err?.message || String(err),
      });
      continue;
    }
    if (!map?.order || !info?.lineItems?.nodes) continue;
    if (info.cancelledAt) continue;

    const openUnits = listAllOpenUnits({
      orderLineItems: info.lineItems.nodes,
      fulfillmentOrders: map.order.fulfillmentOrders.nodes,
    });
    if (openUnits.length === 0) continue; // fully fulfilled

    // Hint row(s) for this order — used to attach display metadata & created date.
    const hintsForOrder = hints.filter(
      (h) => toShopifyOrderGid(h.shopifyOrderId) === shopifyOrderId
    );
    const orderName =
      hintsForOrder.find((h) => h.shopifyOrderName)?.shopifyOrderName ??
      (info as any).name ??
      null;
    const orderCreatedAt =
      hintsForOrder.find((h) => h.shopifyCreatedAt)?.shopifyCreatedAt ??
      (info as any).createdAt ??
      null;
    if (!orderCreatedAt) continue;

    for (const unit of openUnits) {
      if (!acceptSku(unit.sku)) continue;
      if (!(Number(unit.remainingQuantity) > 0)) continue;
      verified.push({
        shopifyOrderId,
        shopifyOrderName: orderName,
        shopifyLineItemId: unit.lineItemId,
        shopifySku: unit.sku,
        shopifySizeEU: unit.variantTitle,
        shopifyProductTitle: unit.title,
        shopifyCreatedAt: orderCreatedAt,
        remainingQuantity: Number(unit.remainingQuantity),
      });
    }
  }
  return sortOpenLinesFifo(verified);
}

export async function loadVerifiedOpenShopifyLinesForPackage(params: {
  pkg: Pick<
    InboundPackageLike,
    "sku" | "sizeEU" | "purchaseDate" | "awb" | "stockxAccountKey"
  >;
  hints: ShopifyOrderHint[];
}): Promise<OpenShopifyLineCandidate[]> {
  const { pkg, hints } = params;
  if (!pkg?.sku) return [];
  const verified = await loadLiveOpenShopifyLines({
    hints,
    acceptSku: (sku) => skuEquals(pkg.sku, sku),
  });
  return filterVerifiedOpenCandidates(pkg, verified);
}

/** OrderMatch rows already on these lines (for dropLinesLinkedElsewhere). */
export async function loadExistingOrderMatchLinks(lineItemIds: string[]) {
  const ids = Array.from(new Set(lineItemIds.filter(Boolean)));
  if (ids.length === 0) return [];
  return prisma.orderMatch.findMany({
    where: { shopifyLineItemId: { in: ids } },
    select: { shopifyLineItemId: true, stockxAwb: true, matchType: true },
  });
}

/**
 * End-to-end: hints (OrderMatch + live Shopify search) → verified open lines →
 * exact / ambiguous / none. Works when no OrderMatch row exists for the order.
 */
export async function resolveVerifiedShopifyAwbFallback(
  pkg: InboundPackageLike,
  opts?: { scannedAwbs?: string[] }
): Promise<ShopifyAwbFallbackMatch> {
  if (!pkg?.sku) return { status: "none" };
  const [dbHints, shopifySkus] = await Promise.all([
    loadShopifyOrderHintsForSku({
      sku: String(pkg.sku),
      sizeEU: pkg.sizeEU ?? null,
    }),
    resolveShopifySkusForStyle(String(pkg.sku)),
  ]);
  const liveHints = await discoverOpenShopifyOrderHintsBySku({ skus: shopifySkus });
  const hints = mergeOrderHints(dbHints, liveHints);
  if (hints.length === 0) return { status: "none" };

  const verified = await loadVerifiedOpenShopifyLinesForPackage({ pkg, hints });
  if (verified.length === 0) return { status: "none" };
  const existing = await loadExistingOrderMatchLinks(
    verified.map((v) => v.shopifyLineItemId)
  );
  const free = dropLinesLinkedElsewhere(verified, existing, [
    String(pkg.awb ?? ""),
    ...(opts?.scannedAwbs ?? []),
  ]);
  return resolveShopifyAwbFallbackMatch(pkg, free);
}
