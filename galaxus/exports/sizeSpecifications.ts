import {
  classifyGalaxusProductKind,
  isFootwearKind,
  isGalaxusLengthCmKind,
  requiresGalaxusSizeSpec,
  resolveGalaxusProductCategoryPath,
  type GalaxusProductKind,
} from "@/galaxus/exports/productClassification";
import { defaultGalaxusProductKind } from "@/galaxus/exports/galaxusCategoryPaths";
import { FALLBACK_SIZE_CHARTS } from "@/galaxus/kickdb/sizeCharts";

export const GALAXUS_CLOTHING_SIZE_KEY = "Clothing size";
export const GALAXUS_SHOE_SIZE_KEY = "Shoe size (EU)";
export const GALAXUS_LENGTH_CM_KEY = "Length (cm)";

type ExportClassificationInput = {
  supplierTitle?: string | null;
  supplierSku?: string | null;
  kickdbTitle?: string | null;
  kickdbDescription?: string | null;
  breadcrumbAliases?: string[] | null;
  productType?: string | null;
  brand?: string | null;
  sizeRaw?: string | null;
  supplierKey?: string | null;
  supplierProductType?: string | null;
};

function sanitizeText(value?: string | null): string {
  if (!value) return "";
  return String(value).replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
}

function resolveExportKind(input: ExportClassificationInput): GalaxusProductKind {
  // 1. KickDB structured signals (breadcrumbs/product_type/brand) — deterministic.
  // sizeRaw must be here too: the classifier never returns "unknown" (it falls back to the
  // supplier default), so without it an "XL" jersey became sneakers → Shoe size (EU)=XL while
  // the master feed (which passes sizeRaw) put it under Bekleidung.
  const structuredKind = classifyGalaxusProductKind({
    breadcrumbAliases: input.breadcrumbAliases ?? null,
    productType: input.productType ?? null,
    brand: input.brand ?? null,
    supplierKey: input.supplierKey ?? null,
    supplierProductType: input.supplierProductType ?? null,
    title: input.supplierTitle ?? input.kickdbTitle ?? null,
    sizeRaw: input.sizeRaw ?? null,
  });
  if (structuredKind !== "unknown") return structuredKind;

  // 2. Supplier title regex.
  const supplierTitle = sanitizeText(input.supplierTitle);
  const supplierSku = sanitizeText(input.supplierSku);
  const supplierKind = classifyGalaxusProductKind({
    title: supplierTitle,
    category: supplierSku || null,
    brand: input.brand ?? null,
    supplierKey: input.supplierKey ?? null,
    supplierProductType: input.supplierProductType ?? null,
  });
  if (supplierKind !== "unknown") return supplierKind;

  // 3. KickDB title/description regex.
  const kickdbKind = classifyGalaxusProductKind({
    title: input.kickdbTitle ?? null,
    description: input.kickdbDescription ?? null,
    brand: input.brand ?? null,
    supplierKey: input.supplierKey ?? null,
  });
  if (kickdbKind !== "unknown") return kickdbKind;

  // 4. sizeRaw heuristic (numeric EU = footwear, alpha = apparel).
  return (
    classifyGalaxusProductKind({
      sizeRaw: input.sizeRaw ?? null,
      brand: input.brand ?? null,
      supplierKey: input.supplierKey ?? null,
    }) ?? defaultGalaxusProductKind(input.supplierKey)
  );
}

export function resolveGalaxusExportClassification(
  input: ExportClassificationInput
): { kind: GalaxusProductKind; categoryPath: string; isFootwear: boolean; requiresSizeSpec: boolean } {
  const supplierTitle = sanitizeText(input.supplierTitle);
  const kind = resolveExportKind(input);
  const categoryPath = resolveGalaxusProductCategoryPath({
    title: supplierTitle || input.kickdbTitle || null,
    description: input.kickdbDescription ?? null,
    breadcrumbAliases: input.breadcrumbAliases ?? null,
    productType: input.productType ?? null,
    brand: input.brand ?? null,
    sizeRaw: input.sizeRaw ?? null,
    supplierKey: input.supplierKey ?? null,
    supplierProductType: input.supplierProductType ?? null,
  });

  return {
    kind,
    categoryPath,
    isFootwear: isFootwearKind(kind),
    requiresSizeSpec: requiresGalaxusSizeSpec(kind),
  };
}

const FRACTIONAL_EU_SIZE_RE = /^\d+\s+\d+\s*\/\s*\d+$/;

function buildFractionalAdidasToGalaxusEuMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const gender of ["men", "women", "youth"] as const) {
    const adidas = FALLBACK_SIZE_CHARTS.find((entry) => entry.brand === "adidas" && entry.gender === gender);
    const standard = FALLBACK_SIZE_CHARTS.find((entry) => entry.brand === "Nike" && entry.gender === gender);
    if (!adidas || !standard) continue;

    const len = Math.min(adidas.sizes.EU.length, standard.sizes.EU.length);
    for (let i = 0; i < len; i += 1) {
      const adidasEu = adidas.sizes.EU[i]?.trim();
      const galaxusEu = standard.sizes.EU[i]?.trim();
      if (!adidasEu || !galaxusEu || !adidasEu.includes("/")) continue;
      map.set(adidasEu.replace(/\s+/g, " "), galaxusEu);
    }
  }
  return map;
}

const FRACTIONAL_ADIDAS_TO_GALAXUS_EU = buildFractionalAdidasToGalaxusEuMap();

function normalizeFootwearEuSizeLabel(value: string): string {
  return value.replace(/^EU\s+/i, "").replace(/\s+/g, " ").trim();
}

export function convertFractionalEuSizeForGalaxus(size: string): string {
  const normalized = size.replace(/\s+/g, " ").trim();
  if (!FRACTIONAL_EU_SIZE_RE.test(normalized)) return normalized;
  return FRACTIONAL_ADIDAS_TO_GALAXUS_EU.get(normalized) ?? normalized;
}

export function formatGalaxusSizeSpecValue(
  sizeRaw: string | null | undefined,
  kind: GalaxusProductKind
): string | null {
  const trimmed = String(sizeRaw ?? "").trim();
  if (!trimmed) return null;

  if (isGalaxusLengthCmKind(kind)) {
    const match = trimmed.replace(/,/g, ".").match(/(\d{2,3}(?:\.\d+)?)/);
    if (!match?.[1]) return null;
    const cm = Number.parseFloat(match[1]);
    if (!Number.isFinite(cm) || cm < 80 || cm > 230) return null;
    return String(cm % 1 === 0 ? Math.round(cm) : cm);
  }

  if (isFootwearKind(kind)) {
    const withoutPrefix = normalizeFootwearEuSizeLabel(trimmed);
    if (!withoutPrefix) return null;
    if (/^(OS|ONE\s*SIZE)$/i.test(withoutPrefix)) return null;
    return convertFractionalEuSizeForGalaxus(withoutPrefix);
  }

  return trimmed;
}

/**
 * NER size keys requested in the Galaxus assortment-error report (15.10.2026):
 * Galaxus product types for these kinds ask for their own size property, not Clothing size.
 */
const NER_SIZE_KEY_BY_KIND: Partial<Record<GalaxusProductKind, string>> = {
  trousers: "Trouser size",
  outdoor_pants: "Trouser size",
  ski_pants: "Trouser size",
  langlauf_pants: "Trouser size",
  shorts: "Trouser size",
  socks: "Shoe size",
  sport_socks: "Shoe size",
  sport_bra: "Bra size",
  swim_trunks: "Swimming trunks size",
  gloves: "Glove size",
  ski_gloves: "Glove size",
};

export function resolveGalaxusSizeSpecKey(kind: GalaxusProductKind, supplierKey?: string | null): string {
  if (isGalaxusLengthCmKind(kind)) return GALAXUS_LENGTH_CM_KEY;
  if (isFootwearKind(kind)) return GALAXUS_SHOE_SIZE_KEY;
  if (String(supplierKey ?? "").toLowerCase() === "ner") {
    const nerKey = NER_SIZE_KEY_BY_KIND[kind];
    if (nerKey) return nerKey;
  }
  return GALAXUS_CLOTHING_SIZE_KEY;
}

/** NER sizes carry a French-sizing suffix ("34FR", "38FR"). */
function normalizeNerSizeValue(value: string): string {
  return value.replace(/^(\d{1,3}(?:[.,]\d)?)\s*FR$/i, "$1");
}

export function buildGalaxusSizeSpecRow(input: {
  providerKey: string;
  sizeRaw?: string | null;
  sizeNormalized?: string | null;
  supplierTitle?: string | null;
  supplierSku?: string | null;
  kickdbTitle?: string | null;
  kickdbDescription?: string | null;
  breadcrumbAliases?: string[] | null;
  productType?: string | null;
  brand?: string | null;
  supplierKey?: string | null;
  supplierProductType?: string | null;
}): { ProviderKey: string; SpecificationKey: string; SpecificationValue: string } | null {
  const providerKey = String(input.providerKey ?? "").trim();
  if (!providerKey) return null;

  const { kind, requiresSizeSpec } = resolveGalaxusExportClassification({
    supplierTitle: input.supplierTitle,
    supplierSku: input.supplierSku,
    kickdbTitle: input.kickdbTitle,
    kickdbDescription: input.kickdbDescription,
    breadcrumbAliases: input.breadcrumbAliases,
    productType: input.productType,
    brand: input.brand,
    sizeRaw: input.sizeRaw ?? input.sizeNormalized ?? null,
    supplierKey: input.supplierKey,
    supplierProductType: input.supplierProductType,
  });
  if (!requiresSizeSpec) return null;

  const sizeValue =
    formatGalaxusSizeSpecValue(input.sizeRaw, kind) ??
    formatGalaxusSizeSpecValue(input.sizeNormalized, kind);
  if (!sizeValue) return null;
  const isNer = String(input.supplierKey ?? "").toLowerCase() === "ner";

  return {
    ProviderKey: providerKey,
    SpecificationKey: resolveGalaxusSizeSpecKey(kind, input.supplierKey),
    SpecificationValue: isNer ? normalizeNerSizeValue(sizeValue) : sizeValue,
  };
}
