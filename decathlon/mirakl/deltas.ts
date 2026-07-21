import { prisma } from "@/app/lib/prisma";
import {
  createDecathlonExclusionSummary,
  loadDecathlonCandidates,
  parseDecimal,
  recordDecathlonExclusion,
} from "@/decathlon/exports/mapping";
import type { DecathlonExclusionSummary, DecathlonExportCandidate } from "@/decathlon/exports/types";
import {
  computeDecathlonOfferListPriceFromBuyNowForSupplier,
  decathlonOfferListPriceFromManualLockedPrice,
  readDecathlonStxMaxListPriceChf,
  resolveDecathlonBuyNow,
} from "@/decathlon/exports/pricing";
import {
  extractDecathlonOfferSupplierKey,
  decathlonStxListPriceContextFromCandidate,
  isDecathlonStxOfferDelisted,
  resolveDecathlonStxOfferBuyNow,
  resolveDecathlonStxOfferStock,
} from "@/decathlon/exports/stxOfferPolicy";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import { loadPartnerKeysLowerFromDb } from "@/galaxus/exports/partnerPricing";
import { classifyProductPricingKind, computeChannelVariantPrice } from "@/inventory/pricingPolicy";
import {
  isPhysicalMergeEnabled,
  loadPhysicalMirrorStockByGtin,
  mergePhysicalWithDropship,
  type PhysicalStockMap,
} from "@/shopify/inventory/physicalAvailability";

export type DecathlonSyncRow = {
  providerKey: string;
  gtin: string;
  offerSku: string;
  supplierVariantId: string | null;
  price: string | null;
  stock: number | null;
};

export type DecathlonDeltaResult = {
  candidates: DecathlonExportCandidate[];
  newOffers: DecathlonSyncRow[];
  stockUpdates: DecathlonSyncRow[];
  priceUpdates: DecathlonSyncRow[];
  summary: {
    scanned: number;
    eligible: number;
    newOffers: number;
    stockUpdates: number;
    priceUpdates: number;
    skippedMissingPrice: number;
    skippedMissingStock: number;
    limitApplied?: number;
  };
  exclusions: DecathlonExclusionSummary;
};

function parseIntSafe(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveEffectiveStock(
  candidate: DecathlonExportCandidate,
  listPriceTtc: number | null = null,
  opts?: { physicalQty?: number }
): number | null {
  const variant = candidate.variant ?? {};
  const supplierKey = extractDecathlonOfferSupplierKey(candidate);
  const supplierKeyPrefix = (supplierKey ?? "").toUpperCase();
  const physicalQty = Math.max(0, Math.floor(opts?.physicalQty ?? 0));

  // GLD/TRM stay hard-blocked even with physical present (business rule).
  if (supplierKeyPrefix === "GLD" || supplierKeyPrefix === "TRM") {
    return 0;
  }

  if (supplierKey === "stx") {
    const stxStock = resolveDecathlonStxOfferStock(candidate, listPriceTtc) ?? 0;
    if (physicalQty > 0) {
      // Delist detection: STX price cap or non-express forced stxStock to 0.
      const dropshipDelisted = stxStock === 0;
      return mergePhysicalWithDropship({
        dropshipStock: stxStock,
        physicalQty,
        dropshipDelisted,
      }).finalStock;
    }
    return stxStock;
  }

  const manualLock = Boolean(variant?.manualLock);
  const manualStock = parseIntSafe(variant?.manualStock);
  const baseStock = parseIntSafe(variant?.stock);
  const supplierStock = manualLock && manualStock !== null
    ? Math.max(0, manualStock)
    : baseStock === null
      ? null
      : Math.max(0, baseStock);
  if (supplierStock === null && physicalQty === 0) return null;
  return (supplierStock ?? 0) + physicalQty;
}

function extractDecathlonSupplierKey(candidate: DecathlonExportCandidate): string | null {
  return extractDecathlonOfferSupplierKey(candidate);
}

export function resolveEffectivePrice(
  candidate: DecathlonExportCandidate,
  partnerKeysLower: Set<string> = new Set()
): string | null {
  const applyPricingPolicy = (basePrice: number) => {
    const classification = classifyProductPricingKind({
      title: candidate?.product?.name ?? candidate?.variant?.supplierProductName ?? null,
      sizeRaw: candidate?.variant?.sizeRaw ?? null,
      sizeNormalized: candidate?.variant?.sizeNormalized ?? null,
      sizeEu: candidate?.kickdbVariant?.sizeEu ?? null,
      sizeUs: candidate?.kickdbVariant?.sizeUs ?? null,
    });
    const adjusted =
      computeChannelVariantPrice({
        channel: "DECATHLON",
        basePrice,
        classification,
      }) ?? basePrice;
    return adjusted.toFixed(2);
  };
  const variant = candidate.variant ?? {};
  const manualLock = Boolean(variant?.manualLock);
  const manualPrice = parseDecimal(variant?.manualPrice);
  const supplierKey = extractDecathlonSupplierKey(candidate);
  const buyNow = resolveDecathlonBuyNow({
    buyNowStockx: parseDecimal(variant?.price),
    manualOverride: manualPrice,
    manualLock,
  });
  if (manualLock && manualPrice && manualPrice > 0) {
    return applyPricingPolicy(decathlonOfferListPriceFromManualLockedPrice(manualPrice));
  }
  if (!buyNow || buyNow <= 0) return null;
  const base = computeDecathlonOfferListPriceFromBuyNowForSupplier(
    buyNow,
    supplierKey,
    undefined,
    supplierKey === "stx" ? decathlonStxListPriceContextFromCandidate(candidate) : undefined
  );
  if (!base || base <= 0) return null;
  return applyPricingPolicy(base);
}

function normalizePrice(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(2);
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed.toFixed(2) : null;
  }
  if (typeof value === "object" && "toString" in value) {
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed.toFixed(2) : null;
  }
  return null;
}

/**
 * Mirakl `offer-sku` must match the app provider key: `{SUPPLIER_CODE}_{GTIN}` (see `buildProviderKey`).
 * Do not append `_` + gtin again — that produced values like `NER_123_123`.
 */
export function miraklOfferSku(candidate: {
  providerKey: string;
  gtin: string;
  supplierVariantId: string | null;
}): string {
  const built = buildProviderKey(candidate.gtin, candidate.supplierVariantId);
  if (built) return built;
  return String(candidate.providerKey ?? "").trim();
}

export function computeDecathlonDeltasFromCandidates(
  candidates: DecathlonExportCandidate[],
  syncByKey: Map<
    string,
    { providerKey: string; lastStock: number | null; lastPrice: unknown; offerCreatedAt: Date | null }
  >,
  params?: {
    includeAll?: boolean;
    limitApplied?: number;
    partnerKeysLower?: Set<string>;
    /** When true, emit STO01 stock=0 even if offerCreatedAt is missing (sale-driven delist). */
    includeZeroStockWithoutOffer?: boolean;
    /** Always emit a stock update for these offer SKUs at current qty. */
    forceStockProviderKeys?: Set<string>;
    /** Phase 2 — per-gtin physical mirror qty. Empty map ⇒ no merge. */
    physicalByGtin?: PhysicalStockMap;
  }
) {
  const newOffers: DecathlonSyncRow[] = [];
  const stockUpdates: DecathlonSyncRow[] = [];
  const priceUpdates: DecathlonSyncRow[] = [];
  const partnerKeysLower = params?.partnerKeysLower ?? new Set<string>();

  let skippedMissingPrice = 0;
  let skippedMissingStock = 0;
  let stxDelistedZeroStock = 0;

  const exclusions = createDecathlonExclusionSummary();
  for (const candidate of candidates) {
    const rawProviderKey = String(candidate.providerKey ?? "").trim();
    const supplierVariantId = String(candidate?.variant?.supplierVariantId ?? "").trim() || null;
    const gtin = String(candidate.gtin ?? "").trim();
    if (!rawProviderKey || !gtin) continue;

    const canonicalProviderKey = miraklOfferSku({
      providerKey: rawProviderKey,
      gtin,
      supplierVariantId,
    });
    const sync = syncByKey.get(canonicalProviderKey) ?? syncByKey.get(rawProviderKey);

    const supplierKey = extractDecathlonSupplierKey(candidate);
    const buyNow = resolveDecathlonStxOfferBuyNow(candidate);
    const price = resolveEffectivePrice(candidate, partnerKeysLower);
    const listPriceTtc = price != null ? Number(price) : null;
    const rawStxDelisted =
      supplierKey === "stx" &&
      isDecathlonStxOfferDelisted({ supplierKey, buyNow, listPriceTtc });
    const physicalQty = params?.physicalByGtin?.get(gtin)?.qty ?? 0;
    const stock = resolveEffectiveStock(candidate, listPriceTtc, { physicalQty });
    // Phase 2 override: when physical rescues an STX-delisted offer, treat it as
    // a live offer for the rest of this loop so it flows into newOffers/updates
    // instead of the delisted branch (which forces stock=0).
    const stxDelisted =
      rawStxDelisted && !(physicalQty > 0 && stock !== null && stock > 0);
    const syncPrice = price ?? normalizePrice(sync?.lastPrice ?? null);

    if (price === null && !stxDelisted) {
      skippedMissingPrice += 1;
      recordDecathlonExclusion(exclusions, {
        reason: "MISSING_PRICE",
        message: "Missing price for sync",
        providerKey: canonicalProviderKey,
        supplierVariantId,
        gtin,
      });
    } else if (stxDelisted) {
      recordDecathlonExclusion(exclusions, {
        reason: "PRICE_TOO_HIGH",
        message: `STX list exceeds ${readDecathlonStxMaxListPriceChf()} CHF cap; stock set to 0`,
        providerKey: canonicalProviderKey,
        supplierVariantId,
        gtin,
      });
    }
    if (stock === null) {
      skippedMissingStock += 1;
      recordDecathlonExclusion(exclusions, {
        reason: "MISSING_STOCK",
        message: "Missing stock for sync",
        providerKey: canonicalProviderKey,
        supplierVariantId,
        gtin,
      });
    }

    const row: DecathlonSyncRow = {
      providerKey: canonicalProviderKey,
      gtin,
      offerSku: canonicalProviderKey,
      supplierVariantId,
      price: syncPrice,
      stock,
    };

    if (stxDelisted && stock === 0) {
      stxDelistedZeroStock += 1;
    }

    const forceStock =
      params?.forceStockProviderKeys?.has(canonicalProviderKey) ||
      params?.forceStockProviderKeys?.has(rawProviderKey);

    if (params?.includeAll || !sync?.offerCreatedAt) {
      if (stxDelisted) {
        // Still clear Mirakl qty when STX is delisted and we have no offerCreatedAt row.
        if (
          stock !== null &&
          stock <= 0 &&
          (params?.includeZeroStockWithoutOffer || forceStock)
        ) {
          stockUpdates.push(row);
        }
        continue;
      }
      if (price !== null && stock !== null && stock > 0) {
        newOffers.push({ ...row, price, stock });
      } else if (
        stock !== null &&
        stock <= 0 &&
        (params?.includeZeroStockWithoutOffer || forceStock)
      ) {
        stockUpdates.push(row);
      } else if (forceStock && stock !== null) {
        stockUpdates.push(row);
      }
      continue;
    }

    if (stock !== null) {
      const lastStock = sync?.lastStock ?? null;
      if (forceStock || lastStock === null || lastStock !== stock) {
        stockUpdates.push(row);
      }
    }

    if (price !== null && !stxDelisted) {
      const lastPrice = normalizePrice(sync?.lastPrice ?? null);
      if (lastPrice === null || lastPrice !== price) {
        priceUpdates.push({ ...row, price });
      }
    }
  }

  const summary = {
    scanned: candidates.length,
    eligible: candidates.length,
    newOffers: newOffers.length,
    stockUpdates: stockUpdates.length,
    priceUpdates: priceUpdates.length,
    skippedMissingPrice,
    skippedMissingStock,
    stxDelistedZeroStock,
  } as DecathlonDeltaResult["summary"];

  if (params?.limitApplied) {
    summary.limitApplied = params.limitApplied;
  }

  return { newOffers, stockUpdates, priceUpdates, summary, exclusions };
}

export async function buildDecathlonDeltas(params?: {
  limit?: number;
  includeAll?: boolean;
  providerKeys?: string[];
  /** Always emit a stock row for these SKUs at current qty (even if offerCreatedAt missing). */
  ensureProviderKeys?: string[];
}): Promise<DecathlonDeltaResult> {
  const exclusions = createDecathlonExclusionSummary();
  const { candidates, scanned } = await loadDecathlonCandidates(exclusions);
  const providerKeysFilter = new Set(
    (params?.providerKeys ?? []).map((value) => String(value).trim()).filter(Boolean)
  );
  const ensureProviderKeys = new Set(
    (params?.ensureProviderKeys ?? []).map((value) => String(value).trim()).filter(Boolean)
  );
  const scopedCandidates =
    providerKeysFilter.size > 0
      ? candidates.filter((candidate) => providerKeysFilter.has(String(candidate?.providerKey ?? "").trim()))
      : candidates;
  const limited =
    params?.limit && Number.isFinite(params.limit) && params.limit > 0
      ? scopedCandidates.slice(0, params.limit)
      : scopedCandidates;
  const providerKeySet = new Set<string>();
  for (const c of limited) {
    const gtin = String(c.gtin ?? "").trim();
    const sv = String(c.variant?.supplierVariantId ?? "").trim() || null;
    const raw = String(c.providerKey ?? "").trim();
    const canon = buildProviderKey(gtin, sv) ?? raw;
    if (raw) providerKeySet.add(raw);
    if (canon) providerKeySet.add(canon);
  }
  for (const key of ensureProviderKeys) providerKeySet.add(key);
  const providerKeys = [...providerKeySet];
  const syncRows: Array<{
    providerKey: string;
    lastStock: number | null;
    lastPrice: unknown;
    offerCreatedAt: Date | null;
  }> = await (prisma as any).decathlonOfferSync.findMany({
    where: { providerKey: { in: providerKeys } },
    select: {
      providerKey: true,
      lastStock: true,
      lastPrice: true,
      offerCreatedAt: true,
    },
  });
  const syncByKey = new Map(syncRows.map((row) => [row.providerKey, row]));

  const decathlonPartnerKeysLower = await loadPartnerKeysLowerFromDb();

  // Phase 2 — physical mirror preload (flag-gated). Skipped when disabled so
  // full deltas keep their current DB cost.
  let physicalByGtin: PhysicalStockMap | undefined;
  if (isPhysicalMergeEnabled()) {
    const gtins = limited
      .map((c) => String(c.gtin ?? "").trim())
      .filter((g) => g.length > 0);
    physicalByGtin = await loadPhysicalMirrorStockByGtin(gtins);
  }

  const computed = computeDecathlonDeltasFromCandidates(limited, syncByKey, {
    includeAll: params?.includeAll,
    limitApplied:
      params?.limit && Number.isFinite(params.limit) && params.limit > 0 ? Math.floor(params.limit) : undefined,
    partnerKeysLower: decathlonPartnerKeysLower,
    // Scoped sync only: broad zero-stock without offer. Full sync uses forceStockProviderKeys instead.
    includeZeroStockWithoutOffer: providerKeysFilter.size > 0,
    forceStockProviderKeys: ensureProviderKeys.size > 0 ? ensureProviderKeys : undefined,
    physicalByGtin,
  });

  const summary = {
    ...computed.summary,
    scanned,
    eligible: limited.length,
  };

  return {
    candidates: limited,
    newOffers: computed.newOffers,
    stockUpdates: computed.stockUpdates,
    priceUpdates: computed.priceUpdates,
    summary,
    exclusions: computed.exclusions,
  };
}
