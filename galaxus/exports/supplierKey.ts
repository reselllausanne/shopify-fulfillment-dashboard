export function parseSupplierKeyFromVariantId(
  supplierVariantId: string | null | undefined
): string | null {
  if (!supplierVariantId) return null;
  const trimmed = supplierVariantId.trim();
  if (!trimmed) return null;
  const colonIdx = trimmed.indexOf(":");
  const underscoreIdx = trimmed.indexOf("_");
  if (colonIdx > 0 && (underscoreIdx < 0 || colonIdx < underscoreIdx)) {
    return trimmed.slice(0, colonIdx).toLowerCase();
  }
  if (underscoreIdx > 0) {
    return trimmed.slice(0, underscoreIdx).toLowerCase();
  }
  return null;
}

export function withMappingSupplierKey<T extends Record<string, unknown>>(data: T): T & { supplierKey?: string | null } {
  const supplierVariantId =
    typeof data.supplierVariantId === "string" ? data.supplierVariantId : null;
  const supplierKey = parseSupplierKeyFromVariantId(supplierVariantId);
  if (!supplierKey) return data;
  return { ...data, supplierKey };
}
