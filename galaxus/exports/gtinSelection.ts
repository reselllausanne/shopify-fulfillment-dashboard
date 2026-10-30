import { buildProviderKey, isValidProviderKeyWithGtin } from "@/galaxus/supplier/providerKey";
import { GALAXUS_PRICE_MODEL } from "@/galaxus/edi/config";
import { validateGtin } from "@/app/lib/normalize";
import { resolveGalaxusSellExVatForChannel } from "@/galaxus/exports/pricing";
import { bwzShipChfFromManualNote } from "@/app/lib/bwzParcel";
import { shouldOmitWelPokemonFromGalaxusFeed } from "@/galaxus/exports/welFeedOmit";
import { shouldOmitStxFromGalaxusFeed } from "@/galaxus/exports/stxFeedGate";
import { hasGalaxusPrimaryImage } from "@/galaxus/exports/variantImagePresence";

type VariantCandidate = {
  mapping: any;
  variant: any;
  product: any;
  gtin: string;
  providerKey: string;
  sellPriceExVat: number;
  stock: number;
  updatedAt: Date;
};

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object") {
    const str = String(value);
    const parsed = Number.parseFloat(str);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function hasPrimaryImage(variant?: Parameters<typeof hasGalaxusPrimaryImage>[0]): boolean {
  return hasGalaxusPrimaryImage(variant);
}

type CandidateExcludeReason =
  | "MISSING_GTIN"
  | "INVALID_GTIN"
  | "ENRICHMENT_PENDING"
  | "KICKDB_NOT_FOUND"
  | "MISSING_PRODUCT_NAME"
  | "MISSING_IMAGE"
  | "INVALID_PRICE"
  | "INVALID_PROVIDER_KEY"
  | "SUPPLIER_BLOCKED"
  ;

type AccumulateOptions = {
  keyBy?: "gtin" | "providerKey";
  requireProductName?: boolean;
  requireImage?: boolean;
  /** Prefer candidates with stock > 0 over out-of-stock cheaper rows. */
  preferInStock?: boolean;
  /** Supplier prefixes that exist in `Partner` (lowercase), excluding logic handled inside pricing (e.g. `ner`). */
  galaxusPartnerKeysLower?: Set<string>;
  onExclude?: (payload: {
    reason: CandidateExcludeReason;
    supplierKey: string | null;
    mapping: any;
    variant: any;
  }) => void;
};

function extractSupplierKey(supplierVariantId?: string | null): string | null {
  if (!supplierVariantId) return null;
  const raw = supplierVariantId.trim();
  const rawKey = raw.includes(":")
    ? raw.split(":")[0]
    : raw.includes("_")
      ? raw.split("_")[0]
      : raw;
  return rawKey ? rawKey.toLowerCase() : null;
}

/** Score fields only — Phase-2 master snap keeps ~2.3M of these, not full Prisma graphs. */
export type SlimGtinWinner = {
  mappingId: string;
  providerKey: string;
  gtin: string;
  sellPriceExVat: number;
  stock: number;
  updatedAtMs: number;
};

type RankableCandidate = {
  sellPriceExVat: number;
  stock: number;
  updatedAtMs: number;
};

function isBetterRankable(
  candidate: RankableCandidate,
  existing: RankableCandidate,
  preferInStock: boolean
): boolean {
  if (preferInStock) {
    const existingInStock = existing.stock > 0;
    const candidateInStock = candidate.stock > 0;
    if (candidateInStock && !existingInStock) return true;
    if (!candidateInStock && existingInStock) return false;
  }
  const priceDelta = candidate.sellPriceExVat - existing.sellPriceExVat;
  if (priceDelta < 0) return true;
  if (priceDelta > 0) return false;
  if (candidate.stock > existing.stock) return true;
  if (candidate.stock < existing.stock) return false;
  return candidate.updatedAtMs > existing.updatedAtMs;
}

function tryBuildVariantCandidate(
  mapping: any,
  options: AccumulateOptions | undefined,
  isMerchant: boolean,
  partnerKeysLower: Set<string>,
  requireProductName: boolean,
  requireImage: boolean
): VariantCandidate | null {
  const variant = mapping.supplierVariant ?? null;
  if (!variant) return null;
  const supplierKey =
    extractSupplierKey(variant?.supplierVariantId ?? mapping?.supplierVariantId ?? null) ??
    (mapping?.supplierKey ? String(mapping.supplierKey).trim().toLowerCase() : null) ??
    extractSupplierKey(variant?.providerKey ?? mapping?.providerKey ?? null);

  // TRM permanently blocked. GLD (Golden) is allowed — MOQ 3, DD=0, 15% landed pricing.
  if (supplierKey === "trm") {
    options?.onExclude?.({ reason: "SUPPLIER_BLOCKED", supplierKey, mapping, variant });
    return null;
  }

  // BAE stays in candidates so stock feed can emit QuantityOnStock=0 (delist).
  // Master/offer routes call isBaeFeedBlocked separately.
  if (
    shouldOmitWelPokemonFromGalaxusFeed({
      supplierKey,
      providerKey: variant?.providerKey ?? mapping?.providerKey,
      supplierVariantId: variant?.supplierVariantId ?? mapping?.supplierVariantId,
      title: variant?.supplierProductName,
      brand: variant?.supplierBrand,
      extraText: [
        mapping?.kickdbVariant?.product?.name,
        mapping?.kickdbVariant?.product?.brand,
      ]
        .filter(Boolean)
        .join(" "),
    })
  ) {
    options?.onExclude?.({
      reason: "SUPPLIER_BLOCKED",
      supplierKey: supplierKey ?? "wel",
      mapping,
      variant,
    });
    return null;
  }

  // STX feed gate — Tali policy (2026-09-09): hard cap CHF 10k, mainstream
  // brands > CHF 500 dropped, hand-curated aberrant overrides always dropped.
  // Focus + luxury/haute-couture (incl. Bearbrick / KAWS / Travis Scott) stay.
  {
    const stxGate = shouldOmitStxFromGalaxusFeed({
      supplierKey,
      providerKey: variant?.providerKey ?? mapping?.providerKey,
      supplierVariantId: variant?.supplierVariantId ?? mapping?.supplierVariantId,
      supplierBrand: variant?.supplierBrand,
      price: variant?.price ?? null,
    });
    if (stxGate.omit) {
      options?.onExclude?.({
        reason: "SUPPLIER_BLOCKED",
        supplierKey: supplierKey ?? "stx",
        mapping,
        variant,
      });
      return null;
    }
  }

  const gtin = String(mapping.gtin ?? variant?.gtin ?? "").trim();
  if (!gtin) {
    return null;
  }
  if (!validateGtin(gtin)) {
    options?.onExclude?.({
      reason: "INVALID_GTIN",
      supplierKey,
      mapping,
      variant,
    });
    return null;
  }

  const productName = variant?.supplierProductName ?? null;
  if (requireProductName && !productName) {
    options?.onExclude?.({
      reason: "MISSING_PRODUCT_NAME",
      supplierKey,
      mapping,
      variant,
    });
    return null;
  }

  const product = mapping.kickdbVariant?.product ?? null;
  if (requireImage && !hasPrimaryImage(variant)) {
    options?.onExclude?.({
      reason: "MISSING_IMAGE",
      supplierKey,
      mapping,
      variant,
    });
    return null;
  }

  const buyPrice = parseNumber(variant?.price);
  if (!buyPrice || buyPrice <= 0) {
    options?.onExclude?.({
      reason: "INVALID_PRICE",
      supplierKey,
      mapping,
      variant,
    });
    return null;
  }

  let sellPriceExVat = buyPrice;
  if (!isMerchant) {
    const bwzShip =
      String(supplierKey ?? "").toLowerCase() === "bwz"
        ? bwzShipChfFromManualNote(variant?.manualNote)
        : null;
    sellPriceExVat = resolveGalaxusSellExVatForChannel(buyPrice, supplierKey, partnerKeysLower, {
      deliveryType: variant?.deliveryType ?? null,
      shippingPerPairChf: bwzShip,
    });
  }

  const stock = Number.parseInt(String(variant?.stock ?? 0), 10);
  const updatedAt = new Date(variant?.updatedAt ?? mapping.updatedAt ?? Date.now());

  const providerKey = buildProviderKey(gtin, variant?.supplierVariantId);
  if (!providerKey || !isValidProviderKeyWithGtin(providerKey)) {
    options?.onExclude?.({
      reason: "INVALID_PROVIDER_KEY",
      supplierKey,
      mapping,
      variant,
    });
    return null;
  }

  return {
    mapping,
    variant,
    product,
    gtin,
    providerKey,
    sellPriceExVat,
    stock: Number.isFinite(stock) ? stock : 0,
    updatedAt,
  };
}

export function accumulateBestCandidates(
  mappings: any[],
  bestByGtin: Map<string, VariantCandidate>,
  options?: AccumulateOptions
) {
  const isMerchant = GALAXUS_PRICE_MODEL === "merchant";
  const keyBy = options?.keyBy ?? "gtin";
  const requireProductName = options?.requireProductName !== false;
  const requireImage = options?.requireImage !== false;
  const preferInStock = options?.preferInStock === true;
  const partnerKeysLower = options?.galaxusPartnerKeysLower ?? new Set<string>();

  for (const mapping of mappings) {
    const candidate = tryBuildVariantCandidate(
      mapping,
      options,
      isMerchant,
      partnerKeysLower,
      requireProductName,
      requireImage
    );
    if (!candidate) continue;

    const mapKey = keyBy === "providerKey" ? candidate.providerKey : candidate.gtin;
    const existing = bestByGtin.get(mapKey);
    if (!existing) {
      bestByGtin.set(mapKey, candidate);
      continue;
    }

    if (
      isBetterRankable(
        {
          sellPriceExVat: candidate.sellPriceExVat,
          stock: candidate.stock,
          updatedAtMs: candidate.updatedAt.getTime(),
        },
        {
          sellPriceExVat: existing.sellPriceExVat,
          stock: existing.stock,
          updatedAtMs: existing.updatedAt.getTime(),
        },
        preferInStock
      )
    ) {
      bestByGtin.set(mapKey, candidate);
    }
  }

  return bestByGtin;
}

/**
 * Same GTIN winner rules as accumulateBestCandidates, but only keeps mappingId +
 * score fields. Peak for ~2.3M GTINs stays hundreds of MB, not multi-GB Prisma graphs.
 */
export function accumulateSlimGtinWinners(
  mappings: any[],
  bestByGtin: Map<string, SlimGtinWinner>,
  options?: AccumulateOptions
) {
  const isMerchant = GALAXUS_PRICE_MODEL === "merchant";
  const requireProductName = options?.requireProductName !== false;
  const requireImage = options?.requireImage !== false;
  const preferInStock = options?.preferInStock === true;
  const partnerKeysLower = options?.galaxusPartnerKeysLower ?? new Set<string>();

  for (const mapping of mappings) {
    const mappingId = String(mapping?.id ?? "").trim();
    if (!mappingId) continue;
    const candidate = tryBuildVariantCandidate(
      mapping,
      options,
      isMerchant,
      partnerKeysLower,
      requireProductName,
      requireImage
    );
    if (!candidate) continue;

    const slim: SlimGtinWinner = {
      mappingId,
      providerKey: candidate.providerKey,
      gtin: candidate.gtin,
      sellPriceExVat: candidate.sellPriceExVat,
      stock: candidate.stock,
      updatedAtMs: candidate.updatedAt.getTime(),
    };
    const existing = bestByGtin.get(candidate.gtin);
    if (!existing) {
      bestByGtin.set(candidate.gtin, slim);
      continue;
    }
    if (isBetterRankable(slim, existing, preferInStock)) {
      bestByGtin.set(candidate.gtin, slim);
    }
  }

  return bestByGtin;
}

export function filterExportCandidates<
  T extends { gtin?: string | null; providerKey?: string; variant?: any; mapping?: any }
>(candidates: T[]) {
  const valid: T[] = [];
  const invalidSupplierVariantIds: string[] = [];
  for (const candidate of candidates) {
    const gtin = String(candidate?.gtin ?? candidate?.mapping?.gtin ?? "").trim();
    if (!validateGtin(gtin)) {
      continue;
    }
    const supplierVariantId =
      candidate?.variant?.supplierVariantId ?? candidate?.mapping?.supplierVariantId ?? null;
    const expectedProviderKey = buildProviderKey(gtin, supplierVariantId);
    if (!expectedProviderKey || candidate?.providerKey !== expectedProviderKey) {
      if (supplierVariantId) invalidSupplierVariantIds.push(String(supplierVariantId));
      continue;
    }
    valid.push(candidate);
  }
  return { valid, invalidSupplierVariantIds };
}
