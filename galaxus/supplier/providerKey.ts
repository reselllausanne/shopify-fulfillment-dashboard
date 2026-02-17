const SUPPLIER_CODE_MAP: Record<string, string> = {
  golden: "GLD",
  trm: "TRM",
};

const PROVIDER_KEY_REGEX = /^[A-Z]{3}$/;

export function normalizeProviderKey(value?: string | null): string | null {
  if (!value) return null;
  const cleaned = value.toString().trim().toUpperCase();
  return PROVIDER_KEY_REGEX.test(cleaned) ? cleaned : null;
}

export function isValidProviderKey(value?: string | null): boolean {
  return Boolean(normalizeProviderKey(value));
}

export function extractProviderKeyFromOrderKey(value?: string | null): string | null {
  if (!value) return null;
  const prefix = value.toString().split("_")[0]?.trim().toUpperCase();
  return PROVIDER_KEY_REGEX.test(prefix) ? prefix : null;
}

export function isValidProviderKeyWithGtin(value?: string | null): boolean {
  if (!value) return false;
  const [prefix, gtin] = value.toString().split("_");
  if (!prefix || !gtin) return false;
  if (!normalizeProviderKey(prefix)) return false;
  return /^\d+$/.test(gtin) && [8, 12, 13, 14].includes(gtin.length);
}

export function resolveSupplierCode(supplierVariantId?: string | null): string {
  if (!supplierVariantId) return "SUP";
  const rawKey = supplierVariantId.split(":")[0]?.toLowerCase();
  if (rawKey && SUPPLIER_CODE_MAP[rawKey]) return SUPPLIER_CODE_MAP[rawKey];
  const cleaned = (rawKey ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.slice(0, 3) || "SUP";
}

export function buildProviderKey(
  gtin?: string | null,
  supplierVariantId?: string | null
): string | null {
  if (!gtin) return null;
  const supplierCode = resolveSupplierCode(supplierVariantId);
  return `${supplierCode}_${gtin}`;
}
