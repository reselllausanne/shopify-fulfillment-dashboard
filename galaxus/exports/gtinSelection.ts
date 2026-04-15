import { buildProviderKey, isValidProviderKeyWithGtin } from "@/galaxus/supplier/providerKey";
import { GALAXUS_PRICE_MODEL } from "@/galaxus/edi/config";
import { validateGtin } from "@/app/lib/normalize";
import { resolveGalaxusSellExVatForChannel } from "@/galaxus/exports/pricing";

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

function isAbsoluteUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function hasPrimaryImage(hostedImageUrl?: string | null): boolean {
  return typeof hostedImageUrl === "string" && hostedImageUrl.length > 0 && isAbsoluteUrl(hostedImageUrl);
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

export function accumulateBestCandidates(
  mappings: any[],
  bestByGtin: Map<string, VariantCandidate>,
  options?: AccumulateOptions
) {
  const isMerchant = GALAXUS_PRICE_MODEL === "merchant";
  const keyBy = options?.keyBy ?? "gtin";
  const requireProductName = options?.requireProductName !== false;
  const requireImage = options?.requireImage !== false;
  const partnerKeysLower = options?.galaxusPartnerKeysLower ?? new Set<string>();

  for (const mapping of mappings) {
    const variant = mapping.supplierVariant ?? null;
    if (!variant) continue;
    const supplierKey = extractSupplierKey(variant?.supplierVariantId ?? null);

    // GLD (Golden) and TRM are permanently blocked from all marketplace exports.
    if (supplierKey === "golden" || supplierKey === "gld" || supplierKey === "trm") {
      options?.onExclude?.({ reason: "SUPPLIER_BLOCKED", supplierKey, mapping, variant });
      continue;
    }

    const gtin = String(mapping.gtin ?? variant?.gtin ?? "").trim();
    if (!gtin) {
      continue;
    }
    if (!validateGtin(gtin)) {
      options?.onExclude?.({
        reason: "INVALID_GTIN",
        supplierKey,
        mapping,
        variant,
      });
      continue;
    }

    const productName = variant?.supplierProductName ?? null;
    if (requireProductName && !productName) {
      options?.onExclude?.({
        reason: "MISSING_PRODUCT_NAME",
        supplierKey,
        mapping,
        variant,
      });
      continue;
    }

    const product = mapping.kickdbVariant?.product ?? null;
    if (requireImage && !hasPrimaryImage(variant?.hostedImageUrl ?? null)) {
      options?.onExclude?.({
        reason: "MISSING_IMAGE",
        supplierKey,
        mapping,
        variant,
      });
      continue;
    }

    const buyPrice = parseNumber(variant?.price);
    if (!buyPrice || buyPrice <= 0) {
      options?.onExclude?.({
        reason: "INVALID_PRICE",
        supplierKey,
        mapping,
        variant,
      });
      continue;
    }

    let sellPriceExVat = buyPrice;
    if (!isMerchant) {
      sellPriceExVat = resolveGalaxusSellExVatForChannel(buyPrice, supplierKey, partnerKeysLower);
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
      continue;
    }

    const candidate: VariantCandidate = {
      mapping,
      variant,
      product,
      gtin,
      providerKey,
      sellPriceExVat,
      stock: Number.isFinite(stock) ? stock : 0,
      updatedAt,
    };

    const mapKey = keyBy === "providerKey" ? providerKey : gtin;
    const existing = bestByGtin.get(mapKey);
    if (!existing) {
      bestByGtin.set(mapKey, candidate);
      continue;
    }

    const priceDelta = candidate.sellPriceExVat - existing.sellPriceExVat;
    if (priceDelta < 0) {
      bestByGtin.set(mapKey, candidate);
      continue;
    }
    if (priceDelta > 0) continue;

    if (candidate.stock > existing.stock) {
      bestByGtin.set(mapKey, candidate);
      continue;
    }
    if (candidate.stock < existing.stock) continue;

    if (candidate.updatedAt > existing.updatedAt) {
      bestByGtin.set(mapKey, candidate);
    }
  }

  return bestByGtin;
}

export function filterExportCandidates<
  T extends { gtin?: string; providerKey?: string; variant?: any; mapping?: any }
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
