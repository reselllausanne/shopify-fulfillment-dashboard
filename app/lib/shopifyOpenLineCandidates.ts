/**
 * Verified Shopify open-line loader for the AWB fallback path.
 *
 * The old fallback trusted an OrderMatch row's freshness and hardcoded
 * `remainingQuantity: 1` — which meant a cancelled order, a fully fulfilled
 * order, or a line already picked by a sibling scan could still be selected
 * as an "open" candidate and printed a wrong label.
 *
 * This loader turns OrderMatch rows into discovery *hints only* and then
 * re-queries live Shopify state (fulfillment orders + order shipping info)
 * to filter to lines that are actually open with real remaining quantity.
 */

import { prisma } from "@/app/lib/prisma";
import {
  fetchOrderFulfillmentMap,
  fetchOrderShippingInfo,
} from "@/lib/shopifyFulfillment";
import { listAllOpenUnits } from "@/lib/shopifyOrderOpenSiblings";
import { isValidStockxBuyAfterCustomerOrder } from "@/app/lib/stockxCausal";
import {
  resolveShopifyAwbFallbackMatch,
  type InboundPackageLike,
  type OpenShopifyLineCandidate,
  type ShopifyAwbFallbackMatch,
  skuEquals,
} from "@/app/lib/shopifyAwbFallback";
import { shopifyMatchMinCreatedAt } from "@/app/lib/shopifyMatchEligibility";

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

/**
 * Pure filter — returns hints whose SKU matches the package and whose
 * causality holds (customer order created on or before StockX buy).
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
    if (!isValidStockxBuyAfterCustomerOrder(c.shopifyCreatedAt, pkg.purchaseDate)) {
      return false;
    }
    return true;
  });
}

/**
 * For each unique Shopify order in the hints, load live fulfillment state and
 * emit one verified `OpenShopifyLineCandidate` per line that:
 *   - has real `remainingQuantity > 0` from `listAllOpenUnits`
 *   - has an SKU matching the inbound package's SKU
 *   - belongs to an order that is not cancelled and not fully fulfilled
 *   - passes strict causality (order created on or before StockX purchase)
 */
export async function loadVerifiedOpenShopifyLinesForPackage(params: {
  pkg: Pick<
    InboundPackageLike,
    "sku" | "sizeEU" | "purchaseDate" | "awb" | "stockxAccountKey"
  >;
  hints: ShopifyOrderHint[];
}): Promise<OpenShopifyLineCandidate[]> {
  const { pkg, hints } = params;
  if (!pkg?.sku) return [];

  const orderIds = Array.from(
    new Set(
      hints
        .map((h) => String(h.shopifyOrderId ?? "").trim())
        .filter((id) => id.length > 0)
    )
  );
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
    const hintsForOrder = hints.filter((h) => h.shopifyOrderId === shopifyOrderId);
    const orderName =
      hintsForOrder[0]?.shopifyOrderName ??
      (info as any).name ??
      null;
    const orderCreatedAt =
      hintsForOrder[0]?.shopifyCreatedAt ??
      (info as any).createdAt ??
      null;
    if (!orderCreatedAt) continue;

    for (const unit of openUnits) {
      if (!skuEquals(pkg.sku, unit.sku)) continue;
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

  // Final causal filter is done inside the resolver, but pre-filter here too
  // so callers can inspect the verified pool directly.
  return filterVerifiedOpenCandidates(pkg, verified);
}

/**
 * End-to-end: hints → verified open lines → exact / ambiguous / none.
 * This is the function scan-awb should call for the fallback path.
 */
export async function resolveVerifiedShopifyAwbFallback(
  pkg: InboundPackageLike
): Promise<ShopifyAwbFallbackMatch> {
  if (!pkg?.sku) return { status: "none" };
  const hints = await loadShopifyOrderHintsForSku({
    sku: String(pkg.sku),
    sizeEU: pkg.sizeEU ?? null,
  });
  if (hints.length === 0) return { status: "none" };

  const verified = await loadVerifiedOpenShopifyLinesForPackage({ pkg, hints });
  if (verified.length === 0) return { status: "none" };
  return resolveShopifyAwbFallbackMatch(pkg, verified);
}
