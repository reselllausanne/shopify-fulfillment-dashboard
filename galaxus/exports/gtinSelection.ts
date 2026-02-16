import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import { GALAXUS_PRICE_MODEL } from "@/galaxus/edi/config";
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

function extractSupplierKey(supplierVariantId?: string | null): string | null {
  if (!supplierVariantId) return null;
  const rawKey = supplierVariantId.split(":")[0];
  return rawKey ? rawKey.toLowerCase() : null;
}

export function accumulateBestCandidates(
  mappings: any[],
  bestByGtin: Map<string, VariantCandidate>,
  resolveOverrides?: ResolveOverrides
) {
  const isMerchant = GALAXUS_PRICE_MODEL === "merchant";

  for (const mapping of mappings) {
    const gtin = String(mapping.gtin ?? "").trim();
    if (!gtin) continue;

    const variant = mapping.supplierVariant ?? null;
    if (!variant) continue;

    const productName = variant?.supplierProductName ?? null;
    if (!productName) continue;

    const product = mapping.kickdbVariant?.product ?? null;
    if (!hasPrimaryImage(variant?.images, product?.imageUrl ?? null)) continue;

    const buyPrice = parseNumber(variant?.price);
    if (!buyPrice || buyPrice <= 0) continue;

    let sellPriceExVat = buyPrice;
    if (!isMerchant) {
      const supplierKey = extractSupplierKey(variant?.supplierVariantId ?? null);
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
    if (!providerKey) continue;

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
