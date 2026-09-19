/**
 * Dry-run matching simulation for Matching Review Lab.
 * Reuses matchShopifyToSupplier + Galaxus VARIANT_ID causal FIFO.
 * Never writes OrderMatch / GalaxusStockxMatch.
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
import { accountKeyMatchesChannel } from "./accountKeys";
import { requiresGenderOrSizeSystemReview } from "./genderReview";
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

function filterAvailableBuys(
  unit: LabClientUnit,
  buys: LabStockxBuy[],
  usedNumbers: Set<string>,
  usedIds: Set<string>,
  enforceAccount: boolean
): { available: LabStockxBuy[]; refusals: string[] } {
  const refusals: string[] = [];
  const available: LabStockxBuy[] = [];

  for (const buy of buys) {
    const num = String(buy.supplierOrderNumber ?? "").trim();
    const id = String(buy.orderId ?? "").trim();
    if (num && usedNumbers.has(num)) {
      refusals.push(`ALREADY_CONSUMED:${num}`);
      continue;
    }
    if (id && usedIds.has(id)) {
      refusals.push(`ALREADY_CONSUMED_ID:${id}`);
      continue;
    }
    if (enforceAccount && !accountKeyMatchesChannel(unit.channel, buy.stockxAccountKey)) {
      refusals.push(`WRONG_STOCKX_ACCOUNT:${buy.stockxAccountKey}`);
      continue;
    }
    if (!isValidStockxBuyAfterCustomerOrder(unit.orderDate, buy.purchaseDate)) {
      refusals.push(`WRONG_CAUSAL_DATE:${num || id}`);
      continue;
    }
    available.push(buy);
  }
  return { available, refusals };
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

export function simulateUnitMatch(
  unit: LabClientUnit,
  buys: LabStockxBuy[],
  usedNumbers: Set<string>,
  usedIds: Set<string>,
  options?: SimulateOptions
): LabMatchProposal {
  const enforceAccount = options?.enforceAccountSeparation !== false;
  const { available, refusals } = filterAvailableBuys(
    unit,
    buys,
    usedNumbers,
    usedIds,
    enforceAccount
  );

  let proposed: MatchCandidate | null = null;
  let matchMethod: LabMatchProposal["matchMethod"] = "NONE";
  let topCandidates: MatchCandidate[] = [];

  if (unit.channel === "GALAXUS") {
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
    if (proposed) matchMethod = "NAME_SIZE_TIME";
  }

  if (proposed?.supplierOrder) {
    const num = String(proposed.supplierOrder.supplierOrderNumber ?? "").trim();
    const id = String(proposed.supplierOrder.orderId ?? "").trim();
    if (num) usedNumbers.add(num);
    if (id) usedIds.add(id);
  }

  const buyTitle = proposed?.supplierOrder?.productTitle ?? null;
  const buySize = proposed?.supplierOrder?.sizeEU ?? null;
  const needsGenderOrSizeReview = requiresGenderOrSizeSystemReview({
    clientTitle: unit.productTitle,
    clientSize: unit.sizeRaw,
    clientVariantTitle: unit.shopifyLine.variantTitle,
    buyTitle,
    buySize,
  });

  const accountKey =
    (proposed?.supplierOrder as LabStockxBuy | undefined)?.stockxAccountKey ??
    (proposed
      ? (buys.find(
          (b) =>
            b.supplierOrderNumber === proposed!.supplierOrder.supplierOrderNumber ||
            b.orderId === proposed!.supplierOrder.orderId
        )?.stockxAccountKey ?? null)
      : null);

  const refusalReasons = [...new Set(refusals)].slice(0, 20);
  if (!proposed) {
    refusalReasons.push("NO_STOCKX_PURCHASE_OR_FILTERED");
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
