const SUPPLIER_CODE_MAP: Record<string, string> = {
  golden: "GLD",
};

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
