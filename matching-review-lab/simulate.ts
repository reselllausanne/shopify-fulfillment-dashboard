/**
 * Dry-run matching simulation for Matching Review Lab.
 * Reuses matchShopifyToSupplier + Galaxus VARIANT_ID causal FIFO.
 * Never writes OrderMatch / GalaxusStockxMatch.
 *
 * Product identity first (name → SKU → size inside prod matcher). Causal is a
 * hard filter inside those paths — not a reason to spam every unrelated buy.
 */

import {
  matchShopifyToSupplier,
  type MatchCandidate,
  type NormalizedSupplierOrder,
} from "@/app/utils/matching";
import {
  computeCausalTimeDiffHours,
  isValidStockxBuyAfterCustomerOrder,
} from "@/app/lib/stockxCausal";
import {
  localStockMatchRef,
  shouldAutoLocalStockMatch,
} from "@/galaxus/orders/localStockMatch";
import { resolveInStockFixedPrice } from "@/shopify/inventory/inStockFixedPrice";
import { accountKeyMatchesChannel } from "./accountKeys";
import { requiresGenderOrSizeSystemReview } from "./genderReview";
import { normalizeSkuKey } from "./normalize";
import type {
  LabClientUnit,
  LabMatchProposal,
  LabSimulateBatchResult,
  LabStockxBuy,
  StockxAccountKey,
} from "./types";

export type SimulateOptions = {
  /** StockX buys already claimed (1:1 consumption). */
  consumedBuyNumbers?: Set<string>;
  consumedBuyOrderIds?: Set<string>;
  /** When true, refuse buys whose accountKey does not match unit channel. */
  enforceAccountSeparation?: boolean;
};

function asNormalized(buy: LabStockxBuy): NormalizedSupplierOrder {
  return {
    chainId: buy.chainId,
    orderId: buy.orderId,
    supplierOrderNumber: buy.supplierOrderNumber,
    supplierSource: buy.supplierSource,
    purchaseDate: buy.purchaseDate,
    offerAmount: buy.offerAmount,
    totalTTC: buy.totalTTC,
    productTitle: buy.productTitle,
    productName: buy.productName,
    skuKey: buy.skuKey,
    sizeEU: buy.sizeEU,
    statusKey: buy.statusKey,
    statusTitle: buy.statusTitle,
    currencyCode: buy.currencyCode,
    estimatedDeliveryDate: buy.estimatedDeliveryDate,
    latestEstimatedDeliveryDate: buy.latestEstimatedDeliveryDate,
    productVariantId: buy.productVariantId ?? undefined,
    awb: buy.awb,
    trackingUrl: buy.trackingUrl,
    stockxCheckoutType: buy.stockxCheckoutType,
    stockxStates: buy.stockxStates,
    localStockLot: buy.localStockLot,
  };
}

/** Mirror prod name gate (≥95% word overlap) for near-miss refusals only. */
function productNameLooksSame(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const n1 = norm(a);
  const n2 = norm(b);
  if (!n1 || !n2) return false;
  if (n1 === n2) return true;
  const words1 = new Set(n1.split(/\s+/).filter((w) => w.length > 2 && !/^\d+(\.\d+)?$/.test(w)));
  const words2 = new Set(n2.split(/\s+/).filter((w) => w.length > 2 && !/^\d+(\.\d+)?$/.test(w)));
  if (words1.size === 0 || words2.size === 0) return false;
  const intersection = [...words1].filter((w) => words2.has(w)).length;
  const union = new Set([...words1, ...words2]).size;
  return union > 0 && intersection / union >= 0.95;
}

/**
 * Same product family as the client unit? Name / SKU / variant — not date.
 * Used only to decide whether WRONG_CAUSAL_DATE is a meaningful refusal.
 */
function isSameProductCandidate(unit: LabClientUnit, buy: LabStockxBuy): boolean {
  const unitVid = String(unit.stockxVariantId ?? "").trim();
  const buyVid = String(buy.productVariantId ?? "").trim();
  if (unitVid && buyVid && unitVid === buyVid) return true;

  const unitSku = normalizeSkuKey(unit.sku || unit.styleId);
  const buySku = normalizeSkuKey(buy.skuKey);
  if (unitSku && buySku && unitSku.length >= 6 && buySku.length >= 6) {
    if (unitSku === buySku || unitSku.includes(buySku) || buySku.includes(unitSku)) {
      return true;
    }
  }

  const clientTitle = String(unit.productTitle ?? unit.shopifyLine?.title ?? "");
  const buyTitle = String(buy.productTitle ?? buy.productName ?? "");
  return productNameLooksSame(clientTitle, buyTitle);
}

/**
 * Pre-filter like Galaxus match route: claim + account only.
 * Causal stays inside VARIANT_ID / matchShopifyToSupplier (prod).
 */
function filterAvailableBuys(
  unit: LabClientUnit,
  buys: LabStockxBuy[],
  usedNumbers: Set<string>,
  usedIds: Set<string>,
  enforceAccount: boolean
): { available: LabStockxBuy[]; refusals: string[]; productNearMisses: LabStockxBuy[] } {
  const refusals: string[] = [];
  const available: LabStockxBuy[] = [];
  const productNearMisses: LabStockxBuy[] = [];

  for (const buy of buys) {
    const num = String(buy.supplierOrderNumber ?? "").trim();
    const id = String(buy.orderId ?? "").trim();
    if (num && usedNumbers.has(num)) {
      if (isSameProductCandidate(unit, buy)) {
        refusals.push(`ALREADY_CONSUMED:${num}`);
      }
      continue;
    }
    if (id && usedIds.has(id)) {
      if (isSameProductCandidate(unit, buy)) {
        refusals.push(`ALREADY_CONSUMED_ID:${id}`);
      }
      continue;
    }
    if (enforceAccount && !accountKeyMatchesChannel(unit.channel, buy.stockxAccountKey)) {
      if (isSameProductCandidate(unit, buy)) {
        refusals.push(`WRONG_STOCKX_ACCOUNT:${buy.stockxAccountKey}`);
      }
      continue;
    }

    // Same product but buy before sale → meaningful causal refusal (not every buy).
    if (
      isSameProductCandidate(unit, buy) &&
      !isValidStockxBuyAfterCustomerOrder(unit.orderDate, buy.purchaseDate)
    ) {
      refusals.push(`WRONG_CAUSAL_DATE:${num || id}`);
      productNearMisses.push(buy);
      continue;
    }

    available.push(buy);
  }
  return { available, refusals, productNearMisses };
}

/** Galaxus primary path: exact StockX variantId + causal FIFO (mirrors match route). */
export function simulateGalaxusVariantMatch(
  unit: LabClientUnit,
  available: LabStockxBuy[]
): MatchCandidate | null {
  const variantId = String(unit.stockxVariantId ?? "").trim();
  if (!variantId) return null;

  const scored = available
    .filter((b) => String(b.productVariantId ?? "").trim() === variantId)
    .map((b) => ({
      buy: b,
      timeDiff: computeCausalTimeDiffHours(unit.orderDate, b.purchaseDate),
      isCausal: isValidStockxBuyAfterCustomerOrder(unit.orderDate, b.purchaseDate),
    }))
    .filter((c) => c.timeDiff != null && c.isCausal)
    .sort((a, b) => (a.timeDiff ?? 0) - (b.timeDiff ?? 0));

  if (scored.length === 0) return null;
  const best = scored[0]!;
  return {
    supplierOrder: asNormalized(best.buy),
    score: 999,
    confidence: "high",
    reasons: ["VARIANT_ID", `account:${best.buy.stockxAccountKey}`],
    timeDiffHours: best.timeDiff ?? 0,
    overThreshold: false,
  };
}

/**
 * Shopify/Galaxus warehouse lane: Essentials/Bape/… fixed margins, or physical
 * mirror stock (Money Kickz / Bussigny). No StockX buy expected.
 */
export function simulateFixedPriceOrLocalStock(
  unit: LabClientUnit
): { candidate: MatchCandidate; matchMethod: "FIXED_PRICE" | "LOCAL_STOCK" } | null {
  const fixed = resolveInStockFixedPrice({
    sku: unit.sku || unit.styleId,
    title: unit.productTitle,
  });
  const physicalQty = Number(unit.shopifyLine.physicalStockQty ?? 0);
  const auto = shouldAutoLocalStockMatch({
    productName: unit.productTitle,
    supplierSku: unit.sku,
    styleSku: unit.styleId,
    shopifySku: unit.sku,
    physicalStock: {
      qty: physicalQty,
      locationName: null,
    },
  });
  if (!auto.ok) return null;

  const ref = localStockMatchRef(unit.orderNumber, unit.unitIndex + 1);
  const isFixed = Boolean(fixed);
  const label = fixed?.label ?? "Local / warehouse stock";
  const sellNote =
    fixed?.sellChf != null && fixed?.expressChf != null
      ? `sell ${fixed.sellChf}/${fixed.expressChf} CHF`
      : null;

  const supplierOrder: NormalizedSupplierOrder = {
    chainId: "",
    orderId: ref,
    supplierOrderNumber: ref,
    supplierSource: "LOCAL",
    purchaseDate: unit.orderDate,
    offerAmount: auto.costChf,
    totalTTC: auto.costChf,
    productTitle: unit.productTitle,
    skuKey: unit.sku || unit.styleId || "",
    sizeEU: unit.sizeRaw,
    statusKey: isFixed ? "ESSENTIAL_STOCK" : "LOCAL_STOCK",
    statusTitle: label,
    currencyCode: unit.shopifyLine.currencyCode || "CHF",
    estimatedDeliveryDate: null,
    productVariantId: undefined,
    awb: null,
    trackingUrl: null,
  };

  const reasons = [
    auto.reason,
    fixed?.matchReason ?? "LOCAL_PHYSICAL_STOCK",
    ...(sellNote ? [sellNote] : []),
    `cost ${auto.costChf} CHF (dashboard margin)`,
  ];

  return {
    matchMethod: isFixed ? "FIXED_PRICE" : "LOCAL_STOCK",
    candidate: {
      supplierOrder,
      score: 1000,
      confidence: "high",
      reasons,
      timeDiffHours: 0,
      overThreshold: true,
    },
  };
}

export function simulateUnitMatch(
  unit: LabClientUnit,
  buys: LabStockxBuy[],
  usedNumbers: Set<string>,
  usedIds: Set<string>,
  options?: SimulateOptions
): LabMatchProposal {
  const enforceAccount = options?.enforceAccountSeparation !== false;
  const { available, refusals, productNearMisses } = filterAvailableBuys(
    unit,
    buys,
    usedNumbers,
    usedIds,
    enforceAccount
  );

  let proposed: MatchCandidate | null = null;
  let matchMethod: LabMatchProposal["matchMethod"] = "NONE";
  let topCandidates: MatchCandidate[] = [];

  // Warehouse fixed-margin / physical stock BEFORE StockX (Shopify Essentials lane + Galaxus LOCAL_STOCK).
  const local = simulateFixedPriceOrLocalStock(unit);
  if (local) {
    proposed = local.candidate;
    matchMethod = local.matchMethod;
    topCandidates = [local.candidate];
  }

  // Galaxus/Decathlon: VARIANT_ID first (prod match route), then NAME→SKU→SIZE via matchShopifyToSupplier.
  if (!proposed && (unit.channel === "GALAXUS" || unit.channel === "DECATHLON")) {
    proposed = simulateGalaxusVariantMatch(unit, available);
    if (proposed) {
      matchMethod = "VARIANT_ID";
      topCandidates = [proposed];
    }
  }

  if (!proposed) {
    const result = matchShopifyToSupplier(
      unit.shopifyLine,
      available.map(asNormalized),
      usedNumbers
    );
    proposed = result.bestMatch;
    topCandidates = (result.allCandidates ?? []).slice(0, 5);
    if (proposed) {
      const status = String(proposed.supplierOrder.statusKey ?? "").toUpperCase();
      if (status === "ESSENTIAL_STOCK") matchMethod = "FIXED_PRICE";
      else if (status === "LOCAL_STOCK") matchMethod = "LOCAL_STOCK";
      else matchMethod = "NAME_SIZE_TIME";
    }
  }

  if (proposed?.supplierOrder) {
    const num = String(proposed.supplierOrder.supplierOrderNumber ?? "").trim();
    const id = String(proposed.supplierOrder.orderId ?? "").trim();
    // Don't consume StockX buy slots for synthetic LOCAL/ESS refs.
    const synthetic =
      proposed.supplierOrder.supplierSource === "LOCAL" ||
      num.startsWith("LOCAL-") ||
      num.startsWith("ESS-");
    if (!synthetic) {
      if (num) usedNumbers.add(num);
      if (id) usedIds.add(id);
    }
  }

  const buyTitle = proposed?.supplierOrder?.productTitle ?? null;
  const buySize = proposed?.supplierOrder?.sizeEU ?? null;
  const needsGenderOrSizeReview =
    matchMethod === "FIXED_PRICE" || matchMethod === "LOCAL_STOCK"
      ? false
      : requiresGenderOrSizeSystemReview({
          clientTitle: unit.productTitle,
          clientSize: unit.sizeRaw,
          clientVariantTitle: unit.shopifyLine.variantTitle,
          buyTitle,
          buySize,
        });

  const accountKey =
    matchMethod === "FIXED_PRICE" || matchMethod === "LOCAL_STOCK"
      ? null
      : ((proposed?.supplierOrder as LabStockxBuy | undefined)?.stockxAccountKey ??
        (proposed
          ? (buys.find(
              (b) =>
                b.supplierOrderNumber === proposed!.supplierOrder.supplierOrderNumber ||
                b.orderId === proposed!.supplierOrder.orderId
            )?.stockxAccountKey ?? null)
          : null));

  const refusalReasons = [...new Set(refusals)].slice(0, 12);
  if (!proposed) {
    if (productNearMisses.length > 0) {
      if (!refusalReasons.some((r) => r.startsWith("WRONG_CAUSAL_DATE"))) {
        refusalReasons.push("NO_STOCKX_PURCHASE");
      }
    } else {
      refusalReasons.push("NO_STOCKX_PURCHASE");
    }
  }
  if (needsGenderOrSizeReview) {
    refusalReasons.push("WOMEN_OR_GS_SENT_TO_REVIEW");
  }

  return {
    unit,
    proposed,
    topCandidates,
    matchMethod,
    refusalReasons,
    needsGenderOrSizeReview,
    stockxAccountKey: (accountKey as StockxAccountKey | null) ?? null,
  };
}

export function simulateBatch(
  units: LabClientUnit[],
  buys: LabStockxBuy[],
  options?: SimulateOptions & {
    fetchedAt?: string | null;
    fromCache?: boolean;
  }
): LabSimulateBatchResult {
  const usedNumbers = new Set(options?.consumedBuyNumbers ?? []);
  const usedIds = new Set(options?.consumedBuyOrderIds ?? []);
  const proposals: LabMatchProposal[] = [];

  for (const unit of units) {
    proposals.push(simulateUnitMatch(unit, buys, usedNumbers, usedIds, options));
  }

  const accountCounts = new Map<StockxAccountKey, number>();
  for (const b of buys) {
    accountCounts.set(b.stockxAccountKey, (accountCounts.get(b.stockxAccountKey) ?? 0) + 1);
  }

  let high = 0;
  let medium = 0;
  let low = 0;
  let withProposal = 0;
  let genderOrSizeReview = 0;
  for (const p of proposals) {
    if (p.proposed) {
      withProposal += 1;
      if (p.proposed.confidence === "high") high += 1;
      else if (p.proposed.confidence === "medium") medium += 1;
      else low += 1;
    }
    if (p.needsGenderOrSizeReview) genderOrSizeReview += 1;
  }

  return {
    simulatedAt: new Date().toISOString(),
    stockxFreshness: {
      fetchedAt: options?.fetchedAt ?? null,
      fromCache: options?.fromCache ?? false,
      buyCount: buys.length,
      accounts: Array.from(accountCounts.entries()).map(([accountKey, buyCount]) => ({
        accountKey,
        buyCount,
      })),
    },
    proposals,
    stats: {
      totalUnits: units.length,
      withProposal,
      withoutProposal: units.length - withProposal,
      high,
      medium,
      low,
      genderOrSizeReview,
    },
  };
}
