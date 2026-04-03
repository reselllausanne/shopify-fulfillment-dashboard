import { prisma } from "@/app/lib/prisma";
import {
  createDecathlonExclusionSummary,
  loadDecathlonCandidates,
  parseDecimal,
  recordDecathlonExclusion,
} from "@/decathlon/exports/mapping";
import type { DecathlonExclusionSummary, DecathlonExportCandidate } from "@/decathlon/exports/types";
import {
  computeDecathlonPriceFromBuyNow,
  DECATHLON_BUY_NOW_MULTIPLIER,
  DECATHLON_NER_BUY_NOW_MULTIPLIER,
  resolveDecathlonBuyNow,
} from "@/decathlon/exports/pricing";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";

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

export function resolveEffectiveStock(candidate: DecathlonExportCandidate): number | null {
  const variant = candidate.variant ?? {};
  const manualLock = Boolean(variant?.manualLock);
  const manualStock = parseIntSafe(variant?.manualStock);
  const baseStock = parseIntSafe(variant?.stock);
  const supplierVariantId = String(variant?.supplierVariantId ?? "");
  const providerKey = String(candidate.providerKey ?? "");
  const supplierKeyPrefix =
    (supplierVariantId.split(/[:_]/)[0] || providerKey.split(/[:_]/)[0] || "").toUpperCase();
  if (supplierKeyPrefix === "GLD" || supplierKeyPrefix === "TRM") {
    return 0;
  }
  if (manualLock && manualStock !== null) {
    return Math.max(0, manualStock);
  }
  if (baseStock === null) return null;
  return Math.max(0, baseStock);
}

export function resolveEffectivePrice(candidate: DecathlonExportCandidate): string | null {
  const variant = candidate.variant ?? {};
  const manualLock = Boolean(variant?.manualLock);
  const manualPrice = parseDecimal(variant?.manualPrice);
  if (manualLock && manualPrice && manualPrice > 0) {
    return manualPrice.toFixed(2);
  }
  const buyNow = resolveDecathlonBuyNow({
    buyNowStockx: parseDecimal(variant?.price),
    manualOverride: manualPrice,
    manualLock,
  });
  if (!buyNow || buyNow <= 0) return null;
  const providerKey = String(candidate.providerKey ?? "");
  const supplierVariantId = String(variant?.supplierVariantId ?? "");
  const isNer =
    providerKey.toUpperCase().startsWith("NER_") ||
    supplierVariantId.toLowerCase().startsWith("ner_");
  const multiplier = isNer ? DECATHLON_NER_BUY_NOW_MULTIPLIER : DECATHLON_BUY_NOW_MULTIPLIER;
  const computed = computeDecathlonPriceFromBuyNow(buyNow, multiplier);
  if (!computed || computed <= 0) return null;
  return computed.toFixed(2);
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
  params?: { includeAll?: boolean; limitApplied?: number }
) {
  const newOffers: DecathlonSyncRow[] = [];
  const stockUpdates: DecathlonSyncRow[] = [];
  const priceUpdates: DecathlonSyncRow[] = [];

  let skippedMissingPrice = 0;
  let skippedMissingStock = 0;

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

    const price = resolveEffectivePrice(candidate);
    const stock = resolveEffectiveStock(candidate);
    if (price === null) {
      skippedMissingPrice += 1;
      recordDecathlonExclusion(exclusions, {
        reason: "MISSING_PRICE",
        message: "Missing price for sync",
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
      price,
      stock,
    };

    if (params?.includeAll || !sync?.offerCreatedAt) {
      if (price !== null && stock !== null) {
        newOffers.push(row);
      }
      continue;
    }

    if (stock !== null) {
      const lastStock = sync?.lastStock ?? null;
      if (lastStock === null || lastStock !== stock) {
        stockUpdates.push(row);
      }
    }

    if (price !== null) {
      const lastPrice = normalizePrice(sync?.lastPrice ?? null);
      if (lastPrice === null || lastPrice !== price) {
        priceUpdates.push(row);
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
  } as DecathlonDeltaResult["summary"];

  if (params?.limitApplied) {
    summary.limitApplied = params.limitApplied;
  }

  return { newOffers, stockUpdates, priceUpdates, summary, exclusions };
}

export async function buildDecathlonDeltas(params?: {
  limit?: number;
  includeAll?: boolean;
}): Promise<DecathlonDeltaResult> {
  const exclusions = createDecathlonExclusionSummary();
  const { candidates, scanned } = await loadDecathlonCandidates(exclusions);
  const limited =
    params?.limit && Number.isFinite(params.limit) && params.limit > 0
      ? candidates.slice(0, params.limit)
      : candidates;
  const providerKeySet = new Set<string>();
  for (const c of limited) {
    const gtin = String(c.gtin ?? "").trim();
    const sv = String(c.variant?.supplierVariantId ?? "").trim() || null;
    const raw = String(c.providerKey ?? "").trim();
    const canon = buildProviderKey(gtin, sv) ?? raw;
    if (raw) providerKeySet.add(raw);
    if (canon) providerKeySet.add(canon);
  }
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

  const computed = computeDecathlonDeltasFromCandidates(limited, syncByKey, {
    includeAll: params?.includeAll,
    limitApplied:
      params?.limit && Number.isFinite(params.limit) && params.limit > 0 ? Math.floor(params.limit) : undefined,
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
