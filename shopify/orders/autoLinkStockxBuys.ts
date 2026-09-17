import { prisma } from "@/app/lib/prisma";
import { toShopifyCreatedAtStorage } from "@/app/utils/shopifySellDate";
import { resolveInStockEssential } from "@/app/utils/matching";
import {
  buildStockxOrderClaimIndex,
  findStockxOrderClaim,
  registerStockxOrderClaim,
} from "@/app/lib/stockxCrossChannelClaims";
import { applyStockxDetailsToDecathlonMatchFields } from "@/decathlon/stx/manualStockxEnrich";
import {
  extractStockxVariantId,
  fetchRecentStockxBuyingOrders,
  fetchStockxBuyOrderDetailsFull,
  synthesizeBuyOrderDetailsFromListNode,
} from "@/galaxus/stx/stockxClient";
import {
  isValidGalaxusStockxCausalBuy,
  signedHoursAfterSale,
} from "@/galaxus/orders/autoLinkStockxBuys";
import { listStockxAccountTokens, resolveStockxBearerToken } from "@/lib/stockxToken";
import { fetchUnmatchedShopifyLines, type UnmatchedShopifyLine } from "@/shopify/orders/unmatchedShopifyLines";
import { resolveStockxVariantIdForShopifyLine } from "@/shopify/orders/resolveStockxVariant";

export type AutoLinkShopifyStockxOptions = {
  days?: number;
  limit?: number;
  apply?: boolean;
  prefetchedBuys?: Array<{
    node: Awaited<ReturnType<typeof fetchRecentStockxBuyingOrders>>[number];
    token: string;
  }>;
};

export type AutoLinkShopifyStockxResult = {
  scanned: number;
  linked: number;
  awbFilled: number;
  noVariant: number;
  noCandidates: number;
  claimedElsewhere: number;
  skippedEssential: number;
  reason: "linked" | "nothing_to_link" | "no_token" | "dry_run" | "no_candidates";
};

function computeTimeDiffHours(orderDate: unknown, purchaseDate: unknown): number | null {
  const signed = signedHoursAfterSale(orderDate, purchaseDate);
  return signed == null ? null : Math.abs(signed);
}

function isStockxOrderMatchable(statusKey: string | null | undefined): boolean {
  const key = String(statusKey ?? "").trim().toUpperCase();
  if (!key) return true;
  if (key.includes("CANCEL")) return false;
  if (key.includes("REFUND")) return false;
  return true;
}

async function loadBuyingOrders(options?: AutoLinkShopifyStockxOptions) {
  type BuyCandidate = {
    node: Awaited<ReturnType<typeof fetchRecentStockxBuyingOrders>>[number];
    token: string;
  };
  const buyingOrders: BuyCandidate[] = [];
  const seenBuy = new Set<string>();
  const pushBuy = (node: BuyCandidate["node"], token: string) => {
    const key = `${String(node.orderId ?? "").trim()}::${String(node.orderNumber ?? "").trim()}`;
    if (key === "::" || seenBuy.has(key)) return;
    seenBuy.add(key);
    buyingOrders.push({ node, token });
  };

  if (options?.prefetchedBuys?.length) {
    for (const row of options.prefetchedBuys) pushBuy(row.node, row.token);
    return buyingOrders;
  }

  const auth = await resolveStockxBearerToken();
  const accountTokens = await listStockxAccountTokens();
  const tokens =
    accountTokens.length > 0
      ? accountTokens
      : auth
        ? [{ token: auth.token, source: auth.source, customerUuid: null }]
        : [];
  if (tokens.length === 0) return buyingOrders;

  for (const account of tokens) {
    const pending = await fetchRecentStockxBuyingOrders(account.token, {
      first: 100,
      maxPages: 8,
      state: "PENDING",
    }).catch((err: any) => {
      console.warn("[SHOPIFY][STX][AUTO_LINK] PENDING list failed", {
        source: account.source,
        error: err?.message ?? err,
      });
      return [] as Awaited<ReturnType<typeof fetchRecentStockxBuyingOrders>>;
    });
    const historical = await fetchRecentStockxBuyingOrders(account.token, {
      first: 100,
      maxPages: 4,
      state: "HISTORICAL",
    }).catch((err: any) => {
      console.warn("[SHOPIFY][STX][AUTO_LINK] HISTORICAL list failed", {
        source: account.source,
        error: err?.message ?? err,
      });
      return [] as Awaited<ReturnType<typeof fetchRecentStockxBuyingOrders>>;
    });
    for (const node of [...pending, ...historical]) pushBuy(node, account.token);
  }
  return buyingOrders;
}

function shouldSkipAsOwnedStock(line: UnmatchedShopifyLine): boolean {
  if (Number(line.physicalStockQty ?? 0) > 0 && resolveInStockEssential(line.sku, line.title)) {
    return true;
  }
  return false;
}

/**
 * Assign unclaimed StockX buys to unmatched Shopify lines.
 * Same identity as Galaxus: exact variant id + causal FIFO + claim index + AWB from details.
 */
export async function autoLinkUnclaimedStockxBuysForShopifyOrders(
  options?: AutoLinkShopifyStockxOptions
): Promise<AutoLinkShopifyStockxResult> {
  const days = Math.min(365, Math.max(1, options?.days ?? 21));
  const limit = Math.max(1, options?.limit ?? 200);
  const apply = options?.apply !== false;

  const empty: AutoLinkShopifyStockxResult = {
    scanned: 0,
    linked: 0,
    awbFilled: 0,
    noVariant: 0,
    noCandidates: 0,
    claimedElsewhere: 0,
    skippedEssential: 0,
    reason: "nothing_to_link",
  };

  const shop = await fetchUnmatchedShopifyLines(days);
  const lines = [...shop.lines].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  empty.scanned = lines.length;
  if (lines.length === 0) return empty;

  const buyingOrders = await loadBuyingOrders(options);
  if (buyingOrders.length === 0) {
    return { ...empty, reason: "no_token" };
  }

  const claimIndex = await buildStockxOrderClaimIndex({
    stockxOrderIds: buyingOrders.map((o) => o.node.orderId),
    stockxOrderNumbers: buyingOrders.map((o) => o.node.orderNumber),
  });

  let linked = 0;
  let awbFilled = 0;
  let noVariant = 0;
  let noCandidates = 0;
  let claimedElsewhere = 0;
  let skippedEssential = 0;

  for (const line of lines) {
    if (linked >= limit) break;
    if (shouldSkipAsOwnedStock(line)) {
      skippedEssential += 1;
      continue;
    }

    const variantId = await resolveStockxVariantIdForShopifyLine(line);
    if (!variantId) {
      noVariant += 1;
      continue;
    }

    const candidates = buyingOrders
      .filter(({ node }) => {
        const vid = extractStockxVariantId(node, null);
        if (!vid || vid !== variantId) return false;
        if (!isStockxOrderMatchable(node?.state?.statusKey ?? null)) return false;
        if (findStockxOrderClaim(claimIndex, node.orderId, node.orderNumber)) return false;
        return isValidGalaxusStockxCausalBuy(
          line.createdAt,
          node.purchaseDate ?? node.creationDate ?? null
        );
      })
      .map(({ node, token }) => ({
        node,
        token,
        hoursAfter: signedHoursAfterSale(
          line.createdAt,
          node.purchaseDate ?? node.creationDate ?? null
        ),
      }))
      .filter((c) => c.hoursAfter != null)
      .sort((a, b) => (a.hoursAfter ?? 0) - (b.hoursAfter ?? 0));

    if (candidates.length === 0) {
      noCandidates += 1;
      continue;
    }

    const { node, token } = candidates[0];
    const chainId = String(node.chainId ?? "").trim();
    const buyOrderId = String(node.orderId ?? "").trim();
    if (!chainId || !buyOrderId) {
      noCandidates += 1;
      continue;
    }

    let details: Awaited<ReturnType<typeof fetchStockxBuyOrderDetailsFull>>;
    try {
      details = await fetchStockxBuyOrderDetailsFull(token, { chainId, orderId: buyOrderId });
      if (!details?.order) details = synthesizeBuyOrderDetailsFromListNode(node);
    } catch {
      details = synthesizeBuyOrderDetailsFromListNode(node);
    }

    const auto = applyStockxDetailsToDecathlonMatchFields(node, details, {
      matchReasons: ["AUTO_LINK_VARIANT"],
    });
    const stockxOrderNumber =
      String(auto.stockxOrderNumber ?? node.orderNumber ?? buyOrderId).trim() || buyOrderId;
    const stockxAmount =
      auto.stockxAmount != null && Number.isFinite(Number(auto.stockxAmount))
        ? Number(auto.stockxAmount)
        : null;

    if (findStockxOrderClaim(claimIndex, buyOrderId, stockxOrderNumber)) {
      claimedElsewhere += 1;
      continue;
    }

    const existing = await prisma.orderMatch.findFirst({
      where: {
        OR: [
          ...(buyOrderId ? [{ stockxOrderId: buyOrderId }] : []),
          ...(stockxOrderNumber ? [{ stockxOrderNumber }] : []),
        ],
      },
      select: { id: true, shopifyOrderName: true },
    });
    if (existing) {
      claimedElsewhere += 1;
      registerStockxOrderClaim(claimIndex, {
        channel: "shopify",
        matchId: existing.id,
        stockxOrderId: buyOrderId,
        stockxOrderNumber,
      });
      continue;
    }

    const revenue = Number(line.totalPrice) || 0;
    const supplierCost = stockxAmount ?? 0;
    const marginAmount = Number((revenue - supplierCost).toFixed(2));
    const marginPercent = revenue > 0 ? Number(((marginAmount / revenue) * 100).toFixed(2)) : 0;
    const createdAt = toShopifyCreatedAtStorage(new Date(line.createdAt));
    const awb = auto.stockxAwb ?? null;

    if (!apply) {
      linked += 1;
      if (awb) awbFilled += 1;
      registerStockxOrderClaim(claimIndex, {
        channel: "shopify",
        matchId: `dry:${line.lineItemId}`,
        stockxOrderId: buyOrderId,
        stockxOrderNumber,
      });
      continue;
    }

    await prisma.orderMatch.upsert({
      where: { shopifyLineItemId: line.lineItemId },
      create: {
        shopifyOrderId: line.shopifyOrderId,
        shopifyOrderName: line.orderName,
        shopifyLineItemId: line.lineItemId,
        shopifyProductTitle: line.title,
        shopifySku: line.sku ?? null,
        shopifySizeEU: line.sizeEU ?? null,
        shopifyTotalPrice: revenue,
        shopifyCurrencyCode: line.currencyCode || "CHF",
        shopifyCreatedAt: createdAt,
        shopifyCustomerEmail: line.customerEmail ?? null,
        shopifyCustomerFirstName: line.customerFirstName ?? null,
        shopifyCustomerLastName: line.customerLastName ?? null,
        shopifyLineItemImageUrl: line.lineItemImageUrl ?? null,
        supplierSource: "STOCKX",
        stockxOrderNumber,
        stockxChainId: auto.stockxChainId,
        stockxOrderId: buyOrderId,
        stockxProductName: auto.stockxProductName || line.title,
        stockxSizeEU: auto.stockxSizeEU || line.sizeEU || null,
        stockxSkuKey: auto.stockxSkuKey || line.sku || null,
        stockxPurchaseDate: auto.stockxPurchaseDate,
        matchConfidence: "high",
        matchScore: 1,
        matchType: "AUTO_LINK_VARIANT",
        matchReasons: JSON.stringify(["AUTO_LINK_VARIANT", `variant:${variantId}`]),
        timeDiffHours: computeTimeDiffHours(line.createdAt, node.purchaseDate ?? node.creationDate),
        stockxStatus: auto.stockxStatus || "MATCHED",
        stockxAwb: awb,
        stockxTrackingUrl: auto.stockxTrackingUrl,
        stockxEstimatedDelivery: auto.stockxEstimatedDelivery,
        stockxLatestEstimatedDelivery: auto.stockxLatestEstimatedDelivery,
        stockxCheckoutType: auto.stockxCheckoutType,
        stockxStates: auto.stockxStates ?? undefined,
        supplierCost,
        marginAmount,
        marginPercent,
        shopifyMetafieldsSynced: false,
      },
      update: {
        supplierSource: "STOCKX",
        stockxOrderNumber,
        stockxChainId: auto.stockxChainId,
        stockxOrderId: buyOrderId,
        stockxProductName: auto.stockxProductName || undefined,
        stockxSizeEU: auto.stockxSizeEU || undefined,
        stockxSkuKey: auto.stockxSkuKey || undefined,
        stockxPurchaseDate: auto.stockxPurchaseDate ?? undefined,
        matchConfidence: "high",
        matchScore: 1,
        matchType: "AUTO_LINK_VARIANT",
        matchReasons: JSON.stringify(["AUTO_LINK_VARIANT", `variant:${variantId}`]),
        timeDiffHours: computeTimeDiffHours(line.createdAt, node.purchaseDate ?? node.creationDate),
        stockxStatus: auto.stockxStatus || undefined,
        stockxAwb: awb ?? undefined,
        stockxTrackingUrl: auto.stockxTrackingUrl ?? undefined,
        stockxEstimatedDelivery: auto.stockxEstimatedDelivery ?? undefined,
        stockxLatestEstimatedDelivery: auto.stockxLatestEstimatedDelivery ?? undefined,
        supplierCost: supplierCost > 0 ? supplierCost : undefined,
        marginAmount,
        marginPercent,
      },
    });

    registerStockxOrderClaim(claimIndex, {
      channel: "shopify",
      matchId: line.lineItemId,
      stockxOrderId: buyOrderId,
      stockxOrderNumber,
    });
    linked += 1;
    if (awb) awbFilled += 1;
  }

  return {
    scanned: lines.length,
    linked,
    awbFilled,
    noVariant,
    noCandidates,
    claimedElsewhere,
    skippedEssential,
    reason: linked > 0 ? (apply ? "linked" : "dry_run") : "no_candidates",
  };
}
