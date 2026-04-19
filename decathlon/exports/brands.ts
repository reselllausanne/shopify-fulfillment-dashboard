const RAW_ALLOWED_BRANDS = [
  "NIKE",
  "ASICS",
  "SAUCONY",
  "NEW BALANCE",
  "PUMA",
  "BROOKS",
  "ON",
  "LULULEMON",
  "REBOOK",
  "SALOMON",
  "ARC'TERYX",
  "UNDER ARMOUR",
  "MIZUNO",
  "361°",
  "HOKA",
  "CONVERSE",
  "CROCS",
  "THE NORTH FACE",
  "TIMBERLAND",
  "VANS",
  "ONITSUKA TIGER",
  "RIGORER",
  "LI-NING",
];

const RAW_BRAND_SPORTS_MAP: Record<string, string> = {
  NIKE: "All sports",
  ASICS: "All sports",
  SAUCONY: "All sports",
  "NEW BALANCE": "All sports",
  PUMA: "All sports",
  BROOKS: "running",
  ON: "running",
  LULULEMON: "gym yoga welness",
  REBOOK: "All sports",
  SALOMON: "running|trecking",
  "ARC'TERYX": "trecking",
  "UNDER ARMOUR": "gym yoga welness",
  MIZUNO: "run",
  "361°": "basketball",
  HOKA: "running",
  CONVERSE: "gym yoga welness",
  CROCS: "All sports",
  "THE NORTH FACE": "trecking",
  TIMBERLAND: "sneakers",
  VANS: "skateboard",
  "ONITSUKA TIGER": "welness|running",
  RIGORER: "basketball",
  "LI-NING": "basketball",
};

const BRAND_ALIASES: Record<string, string> = {
  AIRJORDAN: "NIKE",
  JORDAN: "NIKE",
  JORDANBRAND: "NIKE",
};

export function normalizeBrand(value?: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return cleaned.length ? cleaned : null;
}

function resolveBrandAlias(normalized: string): string {
  return BRAND_ALIASES[normalized] ?? normalized;
}

const ALLOWED_BRANDS = new Set(RAW_ALLOWED_BRANDS.map((brand) => normalizeBrand(brand)).filter(Boolean));
const BRAND_SPORTS_BY_NORMALIZED = new Map(
  Object.entries(RAW_BRAND_SPORTS_MAP)
    .map(([brand, sports]) => {
      const normalized = normalizeBrand(brand);
      return normalized ? [normalized, sports] : null;
    })
    .filter(Boolean) as Array<[string, string]>
);

export function isAllowedDecathlonBrand(value?: string | null): boolean {
  const normalized = normalizeBrand(value);
  if (!normalized) return false;
  return ALLOWED_BRANDS.has(resolveBrandAlias(normalized));
}

export function getDecathlonSportsForBrand(value?: string | null): string | null {
  const normalized = normalizeBrand(value);
  if (!normalized) return null;
  const canonical = resolveBrandAlias(normalized);
  return BRAND_SPORTS_BY_NORMALIZED.get(canonical) ?? null;
}

export function getAllowedDecathlonBrands(): string[] {
  return [...RAW_ALLOWED_BRANDS];
}
