/**
 * Supplier-specific exclusion rules (self-contained — no feedIntegrity dependency).
 */

export const REICHELT_MAX_UNIT_DIMENSION_M = 1.2;

const NEON_RE =
  /\b(neon|leuchtstoff|leucht.?r[oö]hre|fluorescent|tl[- ]?r[oö]hre|g13|g5\b|t5\b|t8\b|neonr[oö]hre)\b/i;

export type ExclusionResult = {
  excluded: boolean;
  reason?: string;
  detail?: string;
};

export function extractLongestDimensionMetres(text: string): number | null {
  const blob = String(text ?? "");
  const candidates: number[] = [];
  for (const m of blob.matchAll(/\b(\d+(?:[.,]\d+)?)\s*m(?:eter)?\b/gi)) {
    const n = Number(m[1]!.replace(",", "."));
    if (Number.isFinite(n) && n > 0) candidates.push(n);
  }
  for (const m of blob.matchAll(/\b(\d+(?:[.,]\d+)?)\s*cm\b/gi)) {
    const n = Number(m[1]!.replace(",", "."));
    if (Number.isFinite(n) && n > 0) candidates.push(n / 100);
  }
  for (const m of blob.matchAll(/\b(\d+)\s*mm\b/gi)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) candidates.push(n / 1000);
  }
  if (!candidates.length) return null;
  return Math.max(...candidates);
}

/** Reichelt: neon products + any unit dimension edge > 1.20 m. */
export function evaluateSupplierExclusion(input: {
  supplierKey?: string | null;
  productName?: string | null;
  brand?: string | null;
  extraText?: string | null;
}): ExclusionResult {
  const key = String(input.supplierKey ?? "")
    .trim()
    .toLowerCase();
  if (key !== "rei" && key !== "reichelt") {
    return { excluded: false };
  }

  const text = [input.productName, input.brand, input.extraText].filter(Boolean).join(" ");
  if (NEON_RE.test(text)) {
    return { excluded: true, reason: "REI_NEON", detail: "neon_or_fluorescent" };
  }

  const metres = extractLongestDimensionMetres(text);
  if (metres != null && metres > REICHELT_MAX_UNIT_DIMENSION_M) {
    return {
      excluded: true,
      reason: "REI_DIMENSION_OVER_120CM",
      detail: `longestEdge=${metres.toFixed(2)}m`,
    };
  }

  return { excluded: false };
}

export function evaluateReicheltExclusions(input: {
  title?: string | null;
  productType?: string | null;
  dimensionMeters?: number | null;
  attributes?: Record<string, unknown> | null;
}): ExclusionResult {
  return evaluateSupplierExclusion({
    supplierKey: "rei",
    productName: input.title,
    extraText: `${input.productType ?? ""} ${JSON.stringify(input.attributes ?? {})} ${
      input.dimensionMeters != null ? `${input.dimensionMeters} m` : ""
    }`,
  });
}
