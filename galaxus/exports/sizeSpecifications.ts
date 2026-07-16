import {
  classifyGalaxusProductKind,
  isFootwearKind,
  requiresGalaxusSizeSpec,
  resolveGalaxusProductCategoryPath,
  type GalaxusProductKind,
} from "@/galaxus/exports/productClassification";

export const GALAXUS_CLOTHING_SIZE_KEY = "Clothing size";
export const GALAXUS_SHOE_SIZE_KEY = "Shoe size (EU)";

type ExportClassificationInput = {
  supplierTitle?: string | null;
  supplierSku?: string | null;
  kickdbTitle?: string | null;
  kickdbDescription?: string | null;
};

function sanitizeText(value?: string | null): string {
  if (!value) return "";
  return String(value).replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
}

function resolveExportKind(input: ExportClassificationInput): GalaxusProductKind {
  const supplierTitle = sanitizeText(input.supplierTitle);
  const supplierSku = sanitizeText(input.supplierSku);
  const supplierKind = classifyGalaxusProductKind({
    title: supplierTitle,
    category: supplierSku || null,
  });
  if (supplierKind !== "unknown") return supplierKind;

  const kickdbKind = classifyGalaxusProductKind({
    title: input.kickdbTitle ?? null,
    description: input.kickdbDescription ?? null,
  });
  if (kickdbKind !== "unknown") return kickdbKind;

  return "unknown";
}

export function resolveGalaxusExportClassification(
  input: ExportClassificationInput
): { kind: GalaxusProductKind; categoryPath: string; isFootwear: boolean; requiresSizeSpec: boolean } {
  const supplierTitle = sanitizeText(input.supplierTitle);
  const kind = resolveExportKind(input);
  const categoryPath = resolveGalaxusProductCategoryPath({
    title: supplierTitle || input.kickdbTitle || null,
    description: input.kickdbDescription ?? null,
  });

  return {
    kind,
    categoryPath,
    isFootwear: isFootwearKind(kind),
    requiresSizeSpec: requiresGalaxusSizeSpec(kind),
  };
}

export function formatGalaxusSizeSpecValue(
  sizeRaw: string | null | undefined,
  isFootwear: boolean
): string | null {
  const trimmed = String(sizeRaw ?? "").trim();
  if (!trimmed) return null;

  if (isFootwear) {
    const withoutPrefix = trimmed.replace(/^EU\s+/i, "").trim();
    if (!withoutPrefix) return null;
    if (/^(OS|ONE\s*SIZE)$/i.test(withoutPrefix)) return null;
    return withoutPrefix;
  }

  return trimmed;
}

export function resolveGalaxusSizeSpecKey(isFootwear: boolean): string {
  return isFootwear ? GALAXUS_SHOE_SIZE_KEY : GALAXUS_CLOTHING_SIZE_KEY;
}

export function buildGalaxusSizeSpecRow(input: {
  providerKey: string;
  sizeRaw?: string | null;
  sizeNormalized?: string | null;
  supplierTitle?: string | null;
  supplierSku?: string | null;
  kickdbTitle?: string | null;
  kickdbDescription?: string | null;
}): { ProviderKey: string; SpecificationKey: string; SpecificationValue: string } | null {
  const providerKey = String(input.providerKey ?? "").trim();
  if (!providerKey) return null;

  const { isFootwear, requiresSizeSpec } = resolveGalaxusExportClassification({
    supplierTitle: input.supplierTitle,
    supplierSku: input.supplierSku,
    kickdbTitle: input.kickdbTitle,
    kickdbDescription: input.kickdbDescription,
  });
  if (!requiresSizeSpec) return null;

  const sizeValue =
    formatGalaxusSizeSpecValue(input.sizeRaw, isFootwear) ??
    formatGalaxusSizeSpecValue(input.sizeNormalized, isFootwear);
  if (!sizeValue) return null;

  return {
    ProviderKey: providerKey,
    SpecificationKey: resolveGalaxusSizeSpecKey(isFootwear),
    SpecificationValue: sizeValue,
  };
}
