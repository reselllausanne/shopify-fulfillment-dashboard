import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { parsePriceSafe, validateGtin } from "@/app/lib/normalize";

export const ALTERNATIVE_PARTNER_KEY = "NER";

export const ALTERNATIVE_PRODUCT_REQUIRED_HEADERS = [
  "externalKey",
  "gtin",
  "brand",
  "title",
  "description",
  "category",
  "size",
  "mainImageUrl",
  "stock",
  "priceExVat",
  "vatRate",
  "currency",
];

export const ALTERNATIVE_PRODUCT_OPTIONAL_HEADERS = [
  "providerKey",
  "variantName",
  "color",
  "gender",
  "material",
  "imageUrls",
  "leadTimeDays",
  "specsJson",
  "decathlonLogisticClass",
  "decathlonLeadTimeToShip",
];

export const ALTERNATIVE_PRODUCT_ALLOWED_HEADERS = [
  ...ALTERNATIVE_PRODUCT_REQUIRED_HEADERS,
  ...ALTERNATIVE_PRODUCT_OPTIONAL_HEADERS,
];

export function isAlternativeProductsPartnerKey(key?: string | null): boolean {
  return normalizeProviderKey(key) === ALTERNATIVE_PARTNER_KEY;
}

export function buildAlternativeProviderKey(partnerKey: string, gtin: string): string | null {
  const normalizedPartner = normalizeProviderKey(partnerKey);
  if (!normalizedPartner) return null;
  const cleanedGtin = String(gtin ?? "").trim();
  if (!validateGtin(cleanedGtin)) return null;
  return `${normalizedPartner}_${cleanedGtin}`;
}

export function normalizeCurrency(value?: string | null): string | null {
  if (!value) return null;
  const cleaned = value.toString().trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(cleaned)) return null;
  return cleaned;
}

export function normalizeVatRate(value?: string | null): number | null {
  const parsed = parsePriceSafe(value ?? "");
  if (parsed === null) return null;
  if (parsed > 1) {
    const fraction = parsed / 100;
    return Number.isFinite(fraction) ? Math.round(fraction * 10000) / 10000 : null;
  }
  if (parsed < 0) return null;
  return parsed;
}

export function parseImageUrls(value?: string | null): { urls: string[]; error?: string } {
  const raw = value?.toString().trim();
  if (!raw) return { urls: [] };
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return { urls: [], error: "imageUrls must be a JSON array" };
      const urls = parsed
        .filter((entry) => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean);
      return { urls };
    } catch {
      return { urls: [], error: "imageUrls must be valid JSON" };
    }
  }
  const urls = raw
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return { urls };
}

export function parseSpecsJson(value?: string | null): { specs: Record<string, string> | null; error?: string } {
  const raw = value?.toString().trim();
  if (!raw) return { specs: null };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { specs: null, error: "specsJson must be a JSON object" };
    }
    const specs: Record<string, string> = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (!key) continue;
      if (val === null || val === undefined) continue;
      specs[key] = String(val);
    }
    return { specs };
  } catch {
    return { specs: null, error: "specsJson must be valid JSON" };
  }
}

export function isAbsoluteUrl(value?: string | null): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value.toString().trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
