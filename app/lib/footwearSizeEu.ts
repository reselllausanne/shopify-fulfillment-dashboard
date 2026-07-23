import { FALLBACK_SIZE_CHARTS, type SizeChartEntry } from "@/galaxus/kickdb/sizeCharts";
import { isFootwearKind, type GalaxusProductKind } from "@/galaxus/exports/productClassification";

export type FootwearSizeContext = {
  brand?: string | null;
  gender?: string | null;
};

export type ResolvedFootwearEuSize = {
  euSize: string | null;
  sourceLabel: string | null;
  conversion: "eu" | "us" | "uk" | "raw" | null;
};

function normalizeBrandForChart(brand?: string | null): string | null {
  const value = String(brand ?? "").trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower.includes("yeezy") && lower.includes("slide")) return "yeezyslide";
  if (lower.includes("yeezy") || lower.includes("yeez") || lower.includes("yzy")) return "adidas";
  if (lower.includes("jordan")) return "Air Jordan";
  if (lower.includes("on running") || lower === "on") return "On Running";
  const chartBrand = FALLBACK_SIZE_CHARTS.find((entry) =>
    lower.includes(entry.brand.toLowerCase())
  )?.brand;
  return chartBrand ?? value;
}

function normalizeGenderForChart(value?: string | null, sizeRaw?: string | null): "men" | "women" | "youth" {
  const lower = (value ?? "").toLowerCase();
  if (/(women|womens|woman|female|\bw\b|damen|femme)/.test(lower)) return "women";
  if (/(youth|kids|kid|gs|grade school|child|children)/.test(lower)) return "youth";
  const size = (sizeRaw ?? "").toUpperCase();
  if (/(^|\b)\d+(\.\d+)?\s*Y\b/.test(size)) return "youth";
  if (/(^|\b)GS\b/.test(size)) return "youth";
  return "men";
}

function getChart(
  brand?: string | null,
  gender?: string | null,
  sizeRaw?: string | null
): SizeChartEntry | null {
  const normalizedBrand = normalizeBrandForChart(brand);
  if (!normalizedBrand) return null;
  const normalizedGender = normalizeGenderForChart(gender, sizeRaw);
  return (
    FALLBACK_SIZE_CHARTS.find(
      (entry) =>
        entry.brand.toLowerCase() === normalizedBrand.toLowerCase() &&
        entry.gender === normalizedGender
    ) ?? null
  );
}

function normalizeUsSize(value: string): string {
  let cleaned = value.trim();
  cleaned = cleaned.replace(/^US\s*M\s*/i, "");
  cleaned = cleaned.replace(/^US\s*W\s*/i, "");
  cleaned = cleaned.replace(/^US\s*/i, "");
  cleaned = cleaned.replace(/\s*(Y|GS)\b/i, "");
  return cleaned.trim();
}

export function convertUsSizeToEu(usValue: string, context?: FootwearSizeContext): string | null {
  const chart = getChart(context?.brand ?? null, context?.gender ?? null, usValue);
  if (!chart) return null;
  const normalized = normalizeUsSize(usValue).replace(/\s+/g, "");
  if (!normalized) return null;
  const index = chart.sizes.US.findIndex((entry) => entry.replace(/\s+/g, "") === normalized);
  if (index < 0 || index >= chart.sizes.EU.length) return null;
  return chart.sizes.EU[index] ?? null;
}

function inferSizeSystem(value: string): "EU" | "US" | "UK" | null {
  const upper = value.toUpperCase();
  if (/(^|[^A-Z])(\d+(\.\d+)?)(Y|GS)\b/.test(upper)) return "US";
  if (upper.includes("EU")) return "EU";
  if (upper.includes("US")) return "US";
  if (upper.includes("UK")) return "UK";
  if (/\d+\s+\d+\s*\/\s*\d+/.test(value) || /\d+\s+2\/3/.test(value)) return "EU";
  return null;
}

function stripSizeSystemPrefix(value: string): string {
  return value
    .replace(/\b(EU|US|UK)\b/gi, "")
    .replace(/,/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function parseUkNumeric(value: string): number | null {
  const cleaned = stripSizeSystemPrefix(value);
  const match = cleaned.match(/^(\d+(?:\.\d+)?)/);
  if (!match?.[1]) return null;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

/** UK store labels (Snowleader CH) → approximate US for chart lookup. */
export function convertUkSizeToUs(
  ukValue: string,
  context?: FootwearSizeContext
): string | null {
  const uk = parseUkNumeric(ukValue);
  if (uk == null) return null;
  const brand = normalizeBrandForChart(context?.brand ?? null)?.toLowerCase() ?? "";
  const gender = normalizeGenderForChart(context?.gender ?? null, ukValue);
  if (gender === "women") {
    if (brand === "adidas") return String(uk + 1.5);
    return String(uk + 2);
  }
  if (brand === "adidas") return String(uk + 0.5);
  return String(uk + 1);
}

function formatEuLabel(value: string): string {
  return value.replace(/^EU\s+/i, "").replace(/\s+/g, " ").trim();
}

const CLOTHING_SIZE_RE = /^(XXS|XS|S|M|L|XL|XXL|XXXL|OS|ONE\s*SIZE|O\/S)$/i;

export function resolveFootwearEuSize(
  sizeLabel: string | null | undefined,
  context?: FootwearSizeContext
): ResolvedFootwearEuSize {
  const raw = String(sizeLabel ?? "").trim();
  if (!raw) return { euSize: null, sourceLabel: null, conversion: null };

  const compact = raw.replace(/\s+/g, "");
  if (CLOTHING_SIZE_RE.test(compact)) {
    return { euSize: raw, sourceLabel: raw, conversion: "raw" };
  }

  const system = inferSizeSystem(raw);
  const stripped = stripSizeSystemPrefix(raw);

  if (system === "EU" && stripped) {
    return { euSize: formatEuLabel(stripped), sourceLabel: raw, conversion: "eu" };
  }

  if (!system && stripped && /^\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+)?$/.test(stripped)) {
    const euNumeric = Number.parseFloat(stripped.replace(/\s.*/, ""));
    if (Number.isFinite(euNumeric) && euNumeric >= 16 && euNumeric <= 52) {
      return { euSize: stripped, sourceLabel: raw, conversion: "eu" };
    }
  }

  let usCandidate: string | null = null;
  if (system === "US" && stripped) {
    usCandidate = normalizeUsSize(stripped);
  } else if (system === "UK") {
    usCandidate = convertUkSizeToUs(raw, context);
  } else if (stripped && /^\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+)?$/.test(stripped)) {
    usCandidate = stripped;
  }

  if (usCandidate) {
    const eu = convertUsSizeToEu(usCandidate, context);
    if (eu) {
      return {
        euSize: formatEuLabel(eu),
        sourceLabel: raw,
        conversion: system === "UK" ? "uk" : "us",
      };
    }
  }

  return { euSize: raw, sourceLabel: raw, conversion: "raw" };
}

type SizeAttribute = { label?: string | null; code?: string | null };

/** Prefer EU attribute, then US, then first size-like attribute (Snowleader often UK-only). */
export function pickSnowleaderSizeSourceLabel(attributes?: SizeAttribute[] | null): string | null {
  if (!Array.isArray(attributes) || !attributes.length) return null;
  const normalized = attributes
    .map((attr) => ({
      label: String(attr?.label ?? "").trim(),
      code: String(attr?.code ?? "").trim().toLowerCase(),
    }))
    .filter((attr) => attr.label);

  const eu = normalized.find((attr) => attr.code.includes("eu") || /\beu\b/i.test(attr.label));
  if (eu) return eu.label;

  const us = normalized.find((attr) => attr.code.includes("us") || /\bus\b/i.test(attr.label));
  if (us) return us.label;

  const uk = normalized.find((attr) => attr.code.includes("uk") || /\buk\b/i.test(attr.label));
  if (uk) return uk.label;

  return normalized[0]?.label ?? null;
}

export function resolveSnowleaderVariantEuSize(input: {
  attributes?: SizeAttribute[] | null;
  brand?: string | null;
  gender?: string | null;
  galaxusKind?: GalaxusProductKind | null;
}): ResolvedFootwearEuSize & { sizeLabel: string | null } {
  const sourceLabel = pickSnowleaderSizeSourceLabel(input.attributes);
  if (!sourceLabel) return { sizeLabel: null, euSize: null, sourceLabel: null, conversion: null };

  if (!input.galaxusKind || !isFootwearKind(input.galaxusKind)) {
    return { sizeLabel: sourceLabel, euSize: sourceLabel, sourceLabel, conversion: "raw" };
  }

  const resolved = resolveFootwearEuSize(sourceLabel, {
    brand: input.brand,
    gender: input.gender,
  });
  return {
    sizeLabel: resolved.euSize ?? sourceLabel,
    ...resolved,
    sourceLabel,
  };
}
