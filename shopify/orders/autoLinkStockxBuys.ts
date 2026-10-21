/**
 * Cron-safe Shopify ↔ StockX auto-link (same rules as dashboard HIGH auto-save).
 *
 * After StockX token refresh: fetch recent buys (PENDING + short HISTORICAL) on the
 * Shopify StockX account only, match unmatched paid Shopify lines via
 * `matchShopifyToSupplier`, persist HIGH-confidence links only.
 *
 * Medium / low / ambiguous → skip auto-write (no wrong links). Medium → ops
 * email (deduped) so yellow lines can be linked by hand. No customer email —
 * AWB/enrich cron advances milestones with lastMilestoneKey gates (no reblast).
 */
import { prisma } from "@/app/lib/prisma";
import {
  buildStockxOrderClaimIndex,
  findStockxOrderClaim,
} from "@/app/lib/stockxCrossChannelClaims";
import { toShopifyOrderGid } from "@/app/lib/swissPostCustomerTracking";
import {
  isPackageProtectionShopifyLine,
  isShopifyFinancialRefunded,
  matchShopifyToSupplier,
  type NormalizedSupplierOrder,
  type ShopifyLineItem,
} from "@/app/utils/matching";
import { toShopifyCreatedAtStorage } from "@/app/utils/shopifySellDate";
import { getCachedStockxBuyingOrders } from "@/galaxus/stx/buyingOrdersCache";
import type { StockxBuyingNode } from "@/galaxus/stx/stockxClient";
import { shopifyGraphQL, type ShopifyGraphQLResult } from "@/lib/shopifyAdmin";
import { resolveStockxBearerToken } from "@/lib/stockxToken";
import {
  emailShopifyStockxMediumCandidates,
  type MediumMatchEmailItem,
} from "@/shopify/orders/emailMediumCandidates";
import { setSupplierOrderMetafields, markOrderMatchMetafieldsSynced } from "@/shopify/orders/setSupplierMetafields";

type UnmatchedOrdersQuery = {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{
      node: {
        id: string;
        name: string;
        createdAt: string;
        displayFinancialStatus: string | null;
        displayFulfillmentStatus: string | null;
        cancelledAt: string | null;
        customer: {
          email: string | null;
          firstName: string | null;
          lastName: string | null;
        } | null;
        lineItems: {
          edges: Array<{
            node: {
              id: string;
              title: string;
              variantTitle: string | null;
              sku: string | null;
              quantity: number;
              currentQuantity: number | null;
              originalUnitPriceSet: {
                shopMoney: { amount: string; currencyCode: string };
              };
              image: { url: string | null } | null;
              variant: {
                selectedOptions: Array<{ name: string; value: string }> | null;
              } | null;
            };
          }>;
        };
      };
    }>;
  } | null;
};

async function fetchUnmatchedOrdersPage(
  query: string,
  cursor: string | null
): Promise<ShopifyGraphQLResult<UnmatchedOrdersQuery>> {
  return shopifyGraphQL<UnmatchedOrdersQuery>(query, { cursor });
}

const PENDING_PAGES = Math.max(
  1,
  Math.min(8, Number(process.env.STOCKX_SHOPIFY_AUTO_LINK_PENDING_PAGES ?? "4"))
);
const HISTORICAL_PAGES = Math.max(
  0,
  Math.min(4, Number(process.env.STOCKX_SHOPIFY_AUTO_LINK_HISTORICAL_PAGES ?? "2"))
);

/** Synthetic / non-StockX OrderMatch refs — treat as already claimed for line skip. */
const SYNTHETIC_STOCKX_REF =
  /^(ESS-|LOCAL-|PHYS-|MK-|INV-|FIX-|SAVED-|pp:)/i;

export type ShopifyStockxAutoLinkOptions = {
  days?: number;
  maxLines?: number;
  dryRun?: boolean;
  /** Stop starting new line matches after this many ms. */
  budgetMs?: number;
  /** Prefetched Shopify-account buys (tests / shared fetch). */
  prefetchedBuys?: StockxBuyingNode[];
  /** Injected bearer (tests / caller already refreshed). */
  token?: string | null;
};

export type ShopifyStockxAutoLinkResult = {
  ok: boolean;
  error?: string;
  unmatchedLines: number;
  buysFetched: number;
  highCandidates: number;
  mediumSkipped: number;
  lowSkipped: number;
  noneSkipped: number;
  linked: number;
  dryRunWouldLink: number;
  skippedNoCost: number;
  skippedClaimed: number;
  budgetExhausted: boolean;
  mediumEmailed: number;
  mediumEmailDeduped: number;
  mediumEmailSent: boolean;
  items: Array<{
    shopifyOrderName: string;
    shopifyLineItemId: string;
    stockxOrderNumber: string;
    score: number;
    dryRun?: boolean;
  }>;
};

export type UnmatchedShopifyLine = ShopifyLineItem & { qty: number };

function gidToNumericId(gid: string): string {
  const s = String(gid || "");
  const m = s.match(/\/(\d+)\s*$/);
  return m ? m[1] : s;
}

function toLineItemGid(idOrGid: string): string {
  const raw = String(idOrGid || "").trim();
  if (!raw || raw.startsWith("gid://")) return raw;
  return `gid://shopify/LineItem/${raw.replace(/\D/g, "")}`;
}

export function isStockxBuyMatchableForAutoLink(
  statusKey: string | null | undefined
): boolean {
  const key = String(statusKey ?? "").trim().toUpperCase();
  if (!key) return true;
  if (key.includes("CANCEL")) return false;
  if (key.includes("REFUND")) return false;
  return true;
}

/** Normalize a StockX buying-list node for `matchShopifyToSupplier`. */
export function normalizeStockxBuyingNodeForShopifyMatch(
  n: StockxBuyingNode | Record<string, unknown>
): NormalizedSupplierOrder | null {
  const orderNumber = String((n as any).orderNumber ?? "").trim();
  const orderId = String((n as any).orderId ?? "").trim();
  if (!orderNumber || !orderId) return null;

  const purchaseDate = String(
    (n as any).creationDate ?? (n as any).purchaseDate ?? ""
  );
  const variantAny = (n as any).productVariant ?? {};
  const productAny = variantAny?.product ?? {};
  const localizedSize = String((n as any).localizedSizeTitle ?? "");
  const sizeType = String((n as any).localizedSizeType ?? "").toUpperCase();
  const sizeEU = sizeType.includes("EU")
    ? localizedSize.replace(/^EU\s*/i, "")
    : localizedSize ||
      variantAny?.traits?.size ||
      variantAny?.sizeChart?.baseSize ||
      null;
  const urlKey = String(productAny?.urlKey ?? productAny?.url_key ?? "").trim() || null;
  const skuKey = String(
    variantAny?.styleId ??
      variantAny?.model ??
      productAny?.styleId ??
      urlKey ??
      productAny?.model ??
      ""
  );

  return {
    supplierOrderNumber: orderNumber,
    chainId: String((n as any).chainId ?? ""),
    orderId,
    supplierSource: "STOCKX",
    purchaseDate,
    offerAmount: typeof (n as any).amount === "number" ? (n as any).amount : null,
    totalTTC: null,
    productTitle: String(productAny?.title ?? productAny?.name ?? "—"),
    productName: productAny?.name ?? productAny?.title ?? undefined,
    skuKey,
    sizeEU: sizeEU ? String(sizeEU) : null,
    statusKey: (n as any).state?.statusKey ?? null,
    statusTitle: (n as any).state?.statusTitle ?? null,
    currencyCode: (n as any).currencyCode ?? "CHF",
    estimatedDeliveryDate:
      (n as any).estimatedDeliveryDateRange?.estimatedDeliveryDate ?? null,
    latestEstimatedDeliveryDate:
      (n as any).estimatedDeliveryDateRange?.latestEstimatedDeliveryDate ?? null,
    productVariantId: String(variantAny?.id ?? "").trim() || undefined,
    awb: (n as any).awb ?? null,
    trackingUrl: (n as any).trackingUrl ?? null,
    urlKey,
  };
}

/**
 * Cron auto-write gate: HIGH only, real StockX buy, non-zero cost, not synthetic.
 * Ambiguous matches are already downgraded to medium inside matchShopifyToSupplier.
 */
export function shouldAutoApplyShopifyStockxMatch(input: {
  confidence: "high" | "medium" | "low" | "none" | string;
  stockxOrderNumber?: string | null;
  suggestedCost?: number | null;
}): boolean {
  if (String(input.confidence).toLowerCase() !== "high") return false;
  const ref = String(input.stockxOrderNumber ?? "").trim();
  if (!ref || SYNTHETIC_STOCKX_REF.test(ref)) return false;
  const cost = Number(input.suggestedCost);
  return Number.isFinite(cost) && cost > 0;
}

export type AutoLinkPick = {
  line: UnmatchedShopifyLine;
  supplier: NormalizedSupplierOrder;
  score: number;
  reasons: string[];
  timeDiffHours: number;
  suggestedCost: number;
};

export type AutoLinkReviewCandidate = {
  line: UnmatchedShopifyLine;
  supplier: NormalizedSupplierOrder;
  score: number;
  reasons: string[];
  timeDiffHours: number;
  confidence: "medium" | "low";
  suggestedCost: number | null;
};

function suggestedCostFromSupplier(supplier: NormalizedSupplierOrder): number | null {
  if (typeof supplier.offerAmount === "number" && supplier.offerAmount > 0) {
    return supplier.offerAmount;
  }
  if (typeof supplier.totalTTC === "number" && supplier.totalTTC > 0) {
    return supplier.totalTTC;
  }
  return null;
}

function toMediumEmailItem(c: AutoLinkReviewCandidate): MediumMatchEmailItem {
  return {
    shopifyOrderName: c.line.orderName,
    shopifyLineItemId: toLineItemGid(c.line.lineItemId),
    shopifyTitle: c.line.title,
    shopifySku: c.line.sku,
    shopifySizeEU: c.line.sizeEU,
    stockxOrderNumber: c.supplier.supplierOrderNumber,
    stockxOrderId: c.supplier.orderId,
    stockxTitle: c.supplier.productTitle,
    stockxSizeEU: c.supplier.sizeEU,
    stockxSkuKey: c.supplier.skuKey,
    score: c.score,
    confidence: c.confidence,
    reasons: c.reasons,
    timeDiffHours: c.timeDiffHours,
    suggestedCost: c.suggestedCost,
    urlKey: c.supplier.urlKey ?? null,
  };
}

/**
 * FIFO over Shopify lines; reserve HIGH StockX buys so one buy → one line.
 * Medium/low collected for ops email (not reserved — human decides).
 * Pure helper for tests — no I/O.
 */
export function pickHighConfidenceShopifyStockxLinks(input: {
  lines: UnmatchedShopifyLine[];
  supplierOrders: NormalizedSupplierOrder[];
  usedSupplierNumbers: Set<string>;
}): {
  picks: AutoLinkPick[];
  mediumCandidates: AutoLinkReviewCandidate[];
  lowCandidates: AutoLinkReviewCandidate[];
  mediumSkipped: number;
  lowSkipped: number;
  noneSkipped: number;
  skippedNoCost: number;
} {
  const used = new Set(input.usedSupplierNumbers);
  const sorted = [...input.lines].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const picks: AutoLinkPick[] = [];
  const mediumCandidates: AutoLinkReviewCandidate[] = [];
  const lowCandidates: AutoLinkReviewCandidate[] = [];
  let mediumSkipped = 0;
  let lowSkipped = 0;
  let noneSkipped = 0;
  let skippedNoCost = 0;

  for (const line of sorted) {
    if (isShopifyFinancialRefunded(line.displayFinancialStatus)) {
      noneSkipped += 1;
      continue;
    }
    const result = matchShopifyToSupplier(line, input.supplierOrders, used, null);
    const best = result.bestMatch;
    if (!best) {
      noneSkipped += 1;
      continue;
    }
    if (best.confidence === "medium") {
      mediumSkipped += 1;
      mediumCandidates.push({
        line,
        supplier: best.supplierOrder,
        score: Number(best.score) || 0,
        reasons: best.reasons ?? [],
        timeDiffHours: Number(best.timeDiffHours) || 0,
        confidence: "medium",
        suggestedCost: suggestedCostFromSupplier(best.supplierOrder),
      });
      continue;
    }
    if (best.confidence !== "high") {
      lowSkipped += 1;
      lowCandidates.push({
        line,
        supplier: best.supplierOrder,
        score: Number(best.score) || 0,
        reasons: best.reasons ?? [],
        timeDiffHours: Number(best.timeDiffHours) || 0,
        confidence: "low",
        suggestedCost: suggestedCostFromSupplier(best.supplierOrder),
      });
      continue;
    }

    const supplier = best.supplierOrder;
    const suggestedCost = suggestedCostFromSupplier(supplier);

    if (
      !shouldAutoApplyShopifyStockxMatch({
        confidence: best.confidence,
        stockxOrderNumber: supplier.supplierOrderNumber,
        suggestedCost,
      })
    ) {
      skippedNoCost += 1;
      continue;
    }

    used.add(supplier.supplierOrderNumber);
    picks.push({
      line,
      supplier,
      score: Number(best.score) || 0,
      reasons: best.reasons,
      timeDiffHours: Number(best.timeDiffHours) || 0,
      suggestedCost: Number(suggestedCost),
    });
  }

  return {
    picks,
    mediumCandidates,
    lowCandidates,
    mediumSkipped,
    lowSkipped,
    noneSkipped,
    skippedNoCost,
  };
}

async function fetchUnmatchedShopifyLines(days: number, maxLines: number): Promise<{
  lines: UnmatchedShopifyLine[];
  ordersScanned: number;
}> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (days - 1));
  since.setUTCHours(0, 0, 0, 0);

  const matchedSince = new Date(since.getTime() - 2 * 86_400_000);
  const matches = await prisma.orderMatch.findMany({
    where: {
      OR: [{ shopifyCreatedAt: { gte: matchedSince } }, { shopifyCreatedAt: null }],
    },
    select: { shopifyLineItemId: true },
  });
  const matchedIds = new Set(
    matches.map((m) => gidToNumericId(String(m.shopifyLineItemId)))
  );

  const query = `
    query ShopifyAutoLinkUnmatched($cursor: String) {
      orders(
        first: 25
        after: $cursor
        sortKey: CREATED_AT
        reverse: true
        query: "created_at:>=${since.toISOString().slice(0, 10)} financial_status:paid"
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
                  variant { selectedOptions { name value } }
                }
              }
            }
          }
        }
      }
    }
  `;

  const out: UnmatchedShopifyLine[] = [];
  let cursor: string | null = null;
  let ordersScanned = 0;

  for (;;) {
    const gqlRes = await fetchUnmatchedOrdersPage(query, cursor);
    const errors = gqlRes.errors;
    if (errors?.length) {
      throw new Error(errors.map((e) => e.message).join("; "));
    }
    const page = gqlRes.data.orders;
    if (!page) break;

    for (const edge of page.edges ?? []) {
      const o = edge.node;
      if (o.cancelledAt) continue;
      if (isShopifyFinancialRefunded(o.displayFinancialStatus)) continue;
      ordersScanned += 1;

      for (const liE of o.lineItems?.edges ?? []) {
        const li = liE.node;
        const title = String(li.title ?? "");
        const sku = li.sku ? String(li.sku) : null;
        if (isPackageProtectionShopifyLine(title, sku)) continue;
        const qty = Number(li.currentQuantity ?? li.quantity ?? 0);
        if (!Number.isFinite(qty) || qty <= 0) continue;

        const lineNumeric = gidToNumericId(li.id);
        if (matchedIds.has(lineNumeric)) continue;

        const sizeOpt = (li.variant?.selectedOptions ?? []).find((opt) =>
          /size/i.test(String(opt?.name ?? ""))
        );
        const sizeEU = sizeOpt?.value ? String(sizeOpt.value) : li.variantTitle || null;
        const currency = String(li.originalUnitPriceSet?.shopMoney?.currencyCode || "CHF");
        const unitPrice = Number(li.originalUnitPriceSet?.shopMoney?.amount ?? 0);
        const totalPrice = unitPrice * qty;

        out.push({
          shopifyOrderId: gidToNumericId(o.id),
          orderName: String(o.name),
          createdAt: String(o.createdAt),
          displayFinancialStatus: String(o.displayFinancialStatus ?? ""),
          displayFulfillmentStatus: o.displayFulfillmentStatus ?? null,
          customerEmail: o.customer?.email ?? null,
          customerName:
            [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(" ") || null,
          customerFirstName: o.customer?.firstName ?? null,
          customerLastName: o.customer?.lastName ?? null,
          shippingCountry: null,
          shippingCity: null,
          lineItemId: lineNumeric,
          title,
          sku,
          variantTitle: li.variantTitle ?? null,
          quantity: qty,
          price: String(unitPrice),
          totalPrice: String(totalPrice),
          currencyCode: currency,
          sizeEU,
          lineItemImageUrl: li.image?.url ?? null,
          qty,
        });

        if (out.length >= maxLines) {
          return { lines: out, ordersScanned };
        }
      }
    }

    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
    if (ordersScanned > 5_000) break;
  }

  return { lines: out, ordersScanned };
}

async function fetchShopifyAccountBuys(token: string): Promise<StockxBuyingNode[]> {
  const dedupe = new Map<string, StockxBuyingNode>();
  for (const [state, maxPages] of [
    ["PENDING", PENDING_PAGES],
    ["HISTORICAL", HISTORICAL_PAGES],
  ] as const) {
    if (maxPages <= 0) continue;
    const res = await getCachedStockxBuyingOrders(token, {
      first: 100,
      maxPages,
      state,
    }).catch((err: any) => {
      console.warn("[SHOPIFY][STX][AUTO_LINK] buying list failed", {
        state,
        error: err?.message ?? err,
      });
      return null;
    });
    for (const node of res?.nodes ?? []) {
      const key = String(node.orderId || node.orderNumber || "");
      if (key && !dedupe.has(key)) dedupe.set(key, node);
    }
  }
  return Array.from(dedupe.values());
}

/**
 * Match recent unlinked Shopify lines to unclaimed StockX buys (Shopify account).
 * HIGH confidence + cost only. Safe for hourly cron.
 */
export async function runShopifyStockxAutoLinkSweep(
  options?: ShopifyStockxAutoLinkOptions
): Promise<ShopifyStockxAutoLinkResult> {
  const startedAt = Date.now();
  const days = Math.max(1, Math.min(60, Number(options?.days ?? 30)));
  const maxLines = Math.max(1, Math.min(500, Number(options?.maxLines ?? 200)));
  const budgetMs = Math.max(10_000, Number(options?.budgetMs ?? 180_000));
  const dryRun = Boolean(options?.dryRun);

  const result: ShopifyStockxAutoLinkResult = {
    ok: true,
    unmatchedLines: 0,
    buysFetched: 0,
    highCandidates: 0,
    mediumSkipped: 0,
    lowSkipped: 0,
    noneSkipped: 0,
    linked: 0,
    dryRunWouldLink: 0,
    skippedNoCost: 0,
    skippedClaimed: 0,
    budgetExhausted: false,
    mediumEmailed: 0,
    mediumEmailDeduped: 0,
    mediumEmailSent: false,
    items: [],
  };

  const auth = options?.token
    ? { token: options.token }
    : await resolveStockxBearerToken();
  if (!auth?.token) {
    return { ...result, ok: false, error: "no_stockx_token" };
  }

  const { lines } = await fetchUnmatchedShopifyLines(days, maxLines);
  result.unmatchedLines = lines.length;
  if (lines.length === 0) return result;

  const rawBuys =
    options?.prefetchedBuys ?? (await fetchShopifyAccountBuys(auth.token));
  result.buysFetched = rawBuys.length;

  const normalized: NormalizedSupplierOrder[] = [];
  for (const node of rawBuys) {
    const norm = normalizeStockxBuyingNodeForShopifyMatch(node);
    if (!norm) continue;
    if (!isStockxBuyMatchableForAutoLink(norm.statusKey)) continue;
    normalized.push(norm);
  }
  if (normalized.length === 0) {
    return { ...result, ok: false, error: "no_stockx_buys_fetched" };
  }

  // Exclude buys already linked on Shopify OrderMatch or Galaxus/Decathlon.
  const existingShopifyClaims = await prisma.orderMatch.findMany({
    where: { stockxOrderNumber: { not: "" } },
    select: { stockxOrderNumber: true, stockxOrderId: true },
  });
  const usedSupplierNumbers = new Set<string>();
  for (const row of existingShopifyClaims) {
    const num = String(row.stockxOrderNumber ?? "").trim();
    if (num && !SYNTHETIC_STOCKX_REF.test(num)) usedSupplierNumbers.add(num);
  }

  const crossClaims = await buildStockxOrderClaimIndex({
    stockxOrderIds: normalized.map((n) => n.orderId),
    stockxOrderNumbers: normalized.map((n) => n.supplierOrderNumber),
  });
  for (const n of normalized) {
    if (findStockxOrderClaim(crossClaims, n.orderId, n.supplierOrderNumber)) {
      usedSupplierNumbers.add(n.supplierOrderNumber);
      result.skippedClaimed += 1;
    }
  }

  const {
    picks,
    mediumCandidates,
    lowCandidates,
    mediumSkipped,
    lowSkipped,
    noneSkipped,
    skippedNoCost,
  } = pickHighConfidenceShopifyStockxLinks({
    lines,
    supplierOrders: normalized,
    usedSupplierNumbers,
  });

  result.mediumSkipped = mediumSkipped;
  result.lowSkipped = lowSkipped;
  result.noneSkipped = noneSkipped;
  result.skippedNoCost = skippedNoCost;
  result.highCandidates = picks.length;

  for (const pick of picks) {
    if (Date.now() - startedAt > budgetMs) {
      result.budgetExhausted = true;
      break;
    }

    const stockxOrderNumber = pick.supplier.supplierOrderNumber;
    const lineItemGid = toLineItemGid(pick.line.lineItemId);
    const shopifyOrderId = toShopifyOrderGid(pick.line.shopifyOrderId);
    const revenue = Number(pick.line.totalPrice) || 0;
    const supplierCost = pick.suggestedCost;
    const marginAmount = Number((revenue - supplierCost).toFixed(2));
    const marginPercent =
      revenue > 0 ? Number(((marginAmount / revenue) * 100).toFixed(2)) : 0;

    if (dryRun) {
      result.dryRunWouldLink += 1;
      result.items.push({
        shopifyOrderName: pick.line.orderName,
        shopifyLineItemId: lineItemGid,
        stockxOrderNumber,
        score: pick.score,
        dryRun: true,
      });
      continue;
    }

    try {
      const existing = await prisma.orderMatch.findUnique({
        where: { shopifyLineItemId: lineItemGid },
        select: { id: true, stockxOrderNumber: true },
      });
      if (existing) {
        const ref = String(existing.stockxOrderNumber ?? "").trim();
        if (ref && !SYNTHETIC_STOCKX_REF.test(ref)) {
          result.skippedClaimed += 1;
          continue;
        }
      }

      const other = await prisma.orderMatch.findFirst({
        where: {
          stockxOrderNumber,
          NOT: { shopifyLineItemId: lineItemGid },
        },
        select: { shopifyOrderName: true },
      });
      if (other) {
        result.skippedClaimed += 1;
        continue;
      }

      const match = await prisma.orderMatch.upsert({
        where: { shopifyLineItemId: lineItemGid },
        create: {
          shopifyOrderId,
          shopifyOrderName: pick.line.orderName,
          shopifyLineItemId: lineItemGid,
          shopifyProductTitle: pick.line.title,
          shopifySku: pick.line.sku ?? null,
          shopifySizeEU: pick.line.sizeEU ?? null,
          shopifyTotalPrice: revenue,
          shopifyCurrencyCode: pick.line.currencyCode || "CHF",
          shopifyCreatedAt: toShopifyCreatedAtStorage(new Date(pick.line.createdAt)),
          shopifyCustomerEmail: pick.line.customerEmail ?? null,
          shopifyCustomerFirstName: pick.line.customerFirstName ?? null,
          shopifyCustomerLastName: pick.line.customerLastName ?? null,
          shopifyLineItemImageUrl: pick.line.lineItemImageUrl ?? null,
          supplierSource: "STOCKX",
          stockxOrderNumber,
          stockxChainId: pick.supplier.chainId || null,
          stockxOrderId: pick.supplier.orderId || null,
          stockxProductName: pick.supplier.productTitle || pick.line.title,
          stockxSizeEU: pick.supplier.sizeEU || pick.line.sizeEU || null,
          stockxSkuKey: pick.supplier.skuKey || pick.line.sku || null,
          stockxPurchaseDate: pick.supplier.purchaseDate
            ? new Date(pick.supplier.purchaseDate)
            : null,
          matchConfidence: "high",
          matchScore: pick.score,
          matchType: "STOCKX_CRON_AUTO_LINK",
          matchReasons: JSON.stringify(pick.reasons),
          timeDiffHours: pick.timeDiffHours,
          stockxStatus: pick.supplier.statusKey || "ORDERED",
          stockxEstimatedDelivery: pick.supplier.estimatedDeliveryDate
            ? new Date(pick.supplier.estimatedDeliveryDate)
            : null,
          stockxLatestEstimatedDelivery: pick.supplier.latestEstimatedDeliveryDate
            ? new Date(pick.supplier.latestEstimatedDeliveryDate)
            : null,
          stockxAwb: pick.supplier.awb ?? null,
          stockxTrackingUrl: pick.supplier.trackingUrl ?? null,
          supplierCost,
          marginAmount,
          marginPercent,
          shopifyMetafieldsSynced: false,
          // Never touch lastMilestoneKey — AWB path must not reblast milestones.
        },
        update: {
          shopifyOrderId,
          shopifyOrderName: pick.line.orderName,
          supplierSource: "STOCKX",
          stockxOrderNumber,
          stockxChainId: pick.supplier.chainId || undefined,
          stockxOrderId: pick.supplier.orderId || undefined,
          stockxProductName: pick.supplier.productTitle || undefined,
          stockxSizeEU: pick.supplier.sizeEU || undefined,
          stockxSkuKey: pick.supplier.skuKey || undefined,
          stockxPurchaseDate: pick.supplier.purchaseDate
            ? new Date(pick.supplier.purchaseDate)
            : undefined,
          matchConfidence: "high",
          matchScore: pick.score,
          matchType: "STOCKX_CRON_AUTO_LINK",
          matchReasons: JSON.stringify(pick.reasons),
          timeDiffHours: pick.timeDiffHours,
          stockxStatus: pick.supplier.statusKey || undefined,
          supplierCost,
          marginAmount,
          marginPercent,
        },
        select: { id: true },
      });

      // Best-effort metafields (order#). AWB cron fills status/AWB next. No email.
      try {
        const meta = await setSupplierOrderMetafields({
          shopifyOrderId,
          stockxOrderNumber,
          stockxStatus: pick.supplier.statusKey || "ORDERED",
          estimatedDelivery: pick.supplier.estimatedDeliveryDate ?? null,
          supplierCost,
          marginAmount,
          marginPercent,
          skipDuplicateCheck: true,
        });
        if (meta.ok) {
          await markOrderMatchMetafieldsSynced(match.id);
        }
      } catch (err: any) {
        console.warn(
          `[SHOPIFY][STX][AUTO_LINK] metafields ${pick.line.orderName}:`,
          err?.message ?? err
        );
      }

      result.linked += 1;
      result.items.push({
        shopifyOrderName: pick.line.orderName,
        shopifyLineItemId: lineItemGid,
        stockxOrderNumber,
        score: pick.score,
      });
      console.log(
        `[SHOPIFY][STX][AUTO_LINK] ${pick.line.orderName} → ${stockxOrderNumber} (score=${pick.score})`
      );
    } catch (err: any) {
      console.warn(
        `[SHOPIFY][STX][AUTO_LINK] failed ${pick.line.orderName}:`,
        err?.message ?? err
      );
    }
  }

  // Yellow (medium): ops email once per line↔buy (7d dedupe). HIGH stays silent.
  if (mediumCandidates.length > 0) {
    try {
      const mail = await emailShopifyStockxMediumCandidates(
        mediumCandidates.map(toMediumEmailItem),
        {
          lowBrief: lowCandidates.map(toMediumEmailItem),
          dryRun,
        }
      );
      result.mediumEmailed = mail.mediumEmailed;
      result.mediumEmailDeduped = mail.mediumDeduped;
      result.mediumEmailSent = mail.sent;
    } catch (err: any) {
      console.warn(
        "[SHOPIFY][STX][AUTO_LINK] medium ops email failed:",
        err?.message ?? err
      );
    }
  }

  return result;
}
