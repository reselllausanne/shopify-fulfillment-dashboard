import { buildProviderKey, isValidProviderKeyWithGtin } from "@/galaxus/supplier/providerKey";
import { GALAXUS_PRICE_MODEL } from "@/galaxus/edi/config";
import { validateGtin } from "@/app/lib/normalize";
import {
  computeGalaxusSellPriceExVat,
  resolvePricingOverrides,
  type PricingOverrides,
} from "@/galaxus/exports/pricing";

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

function hasPrimaryImage(images: unknown, fallbackUrl?: string | null): boolean {
  if (Array.isArray(images)) {
    const ok = images.some((value) => typeof value === "string" && value.length > 0 && isAbsoluteUrl(value));
    if (ok) return true;
  }
  return typeof fallbackUrl === "string" && fallbackUrl.length > 0 && isAbsoluteUrl(fallbackUrl);
}

type ResolveOverrides = (supplierKey: string | null) => PricingOverrides | null;

type CandidateExcludeReason =
  | "MISSING_GTIN"
  | "INVALID_GTIN"
  | "ENRICHMENT_PENDING"
  | "KICKDB_NOT_FOUND"
  | "MISSING_PRODUCT_NAME"
  | "MISSING_IMAGE"
  | "INVALID_PRICE"
  | "INVALID_PROVIDER_KEY"
  | "TRM_DISABLED";

type AccumulateOptions = {
  includeTrm?: boolean;
  onExclude?: (payload: {
    reason: CandidateExcludeReason;
    supplierKey: string | null;
    mapping: any;
    variant: any;
  }) => void;
};

function extractSupplierKey(supplierVariantId?: string | null): string | null {
  if (!supplierVariantId) return null;
  const rawKey = supplierVariantId.split(":")[0];
  return rawKey ? rawKey.toLowerCase() : null;
}

export function accumulateBestCandidates(
  mappings: any[],
  bestByGtin: Map<string, VariantCandidate>,
  resolveOverrides?: ResolveOverrides,
  options?: AccumulateOptions
) {
  const isMerchant = GALAXUS_PRICE_MODEL === "merchant";
  const includeTrm = options?.includeTrm !== false;

  for (const mapping of mappings) {
    const variant = mapping.supplierVariant ?? null;
    if (!variant) continue;
    const supplierKey = extractSupplierKey(variant?.supplierVariantId ?? null);

    if (supplierKey === "trm" && !includeTrm) {
      options?.onExclude?.({
        reason: "TRM_DISABLED",
        supplierKey,
        mapping,
        variant,
      });
      continue;
    }

    const gtin = String(mapping.gtin ?? variant?.gtin ?? "").trim();
    if (supplierKey === "trm") {
      const status = String(mapping?.status ?? "");
      const productNotFound =
        Boolean(mapping?.kickdbVariant?.notFound) || Boolean(mapping?.kickdbVariant?.product?.notFound);
      if (!gtin) {
        const reason: CandidateExcludeReason =
          productNotFound || status === "NOT_FOUND"
            ? "KICKDB_NOT_FOUND"
            : status === "PENDING_GTIN" || status === "AMBIGUOUS_GTIN"
              ? "ENRICHMENT_PENDING"
              : "MISSING_GTIN";
        options?.onExclude?.({
          reason,
          supplierKey,
          mapping,
          variant,
        });
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
    } else if (!gtin) {
      continue;
    }

    const productName = variant?.supplierProductName ?? null;
    if (!productName) {
      options?.onExclude?.({
        reason: "MISSING_PRODUCT_NAME",
        supplierKey,
        mapping,
        variant,
      });
      continue;
    }

    const product = mapping.kickdbVariant?.product ?? null;
    if (!hasPrimaryImage(variant?.images, product?.imageUrl ?? null)) {
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
      const overrides = resolvePricingOverrides(resolveOverrides?.(supplierKey) ?? null);

      sellPriceExVat = computeGalaxusSellPriceExVat({
        buyPriceExVatCHF: buyPrice,
        shippingPerPairCHF: overrides.shippingPerPair,
        targetNetMargin: overrides.targetMargin,
        bufferPerPairCHF: overrides.bufferPerPair,
        roundTo: overrides.roundTo,
        vatRate: overrides.vatRate,
      }).sellPriceExVatCHF;
    }

    const stock = Number.parseInt(String(variant?.stock ?? 0), 10);
    const updatedAt = new Date(variant?.updatedAt ?? mapping.updatedAt ?? Date.now());

    const providerKey = buildProviderKey(gtin, variant?.supplierVariantId) ?? mapping.providerKey;
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

    const existing = bestByGtin.get(gtin);
    if (!existing) {
      bestByGtin.set(gtin, candidate);
      continue;
    }

    const priceDelta = candidate.sellPriceExVat - existing.sellPriceExVat;
    if (priceDelta < 0) {
      bestByGtin.set(gtin, candidate);
      continue;
    }
    if (priceDelta > 0) continue;

    if (candidate.stock > existing.stock) {
      bestByGtin.set(gtin, candidate);
      continue;
    }
    if (candidate.stock < existing.stock) continue;

    if (candidate.updatedAt > existing.updatedAt) {
      bestByGtin.set(gtin, candidate);
    }
  }

  return bestByGtin;
}
