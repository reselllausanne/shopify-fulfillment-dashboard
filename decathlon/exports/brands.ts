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

export function normalizeBrand(value?: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return cleaned.length ? cleaned : null;
}

const ALLOWED_BRANDS = new Set(RAW_ALLOWED_BRANDS.map((brand) => normalizeBrand(brand)).filter(Boolean));

export function isAllowedDecathlonBrand(value?: string | null): boolean {
  const normalized = normalizeBrand(value);
  if (!normalized) return false;
  return ALLOWED_BRANDS.has(normalized);
}

export function getAllowedDecathlonBrands(): string[] {
  return [...RAW_ALLOWED_BRANDS];
}
