/** True when the Galaxus line is the StockX (STX) supplier channel (vs TRM/GLD, etc.). */
export function isGalaxusStxSupplierLine(line: {
  supplierPid?: string | null;
  supplierVariantId?: string | null;
  providerKey?: string | null;
}): boolean {
  const supplierPid = String(line?.supplierPid ?? "").trim().toUpperCase();
  if (supplierPid.startsWith("STX_")) return true;
  const supplierVariantId = String(line?.supplierVariantId ?? "").trim().toLowerCase();
  if (supplierVariantId.startsWith("stx_")) return true;
  const providerKeyRaw = String(line?.providerKey ?? "").trim().toUpperCase();
  if (providerKeyRaw === "STX" || providerKeyRaw.startsWith("STX_")) return true;
  return false;
}

/**
 * Galaxus `supplierSku` prefix only (set on the product in Galaxus):
 * - `THE_` — your own in-stock item (no StockX purchase link)
 * - `NER_` — partner in-stock item (no StockX purchase link)
 */
export type GalaxusWarehouseStockHint = "MAISON" | "NER_STOCK";

export function galaxusLineWarehouseStockHint(line: { supplierSku?: string | null }): GalaxusWarehouseStockHint | null {
  const sku = String(line?.supplierSku ?? "").trim();
  if (!sku) return null;
  if (sku.startsWith("THE_")) return "MAISON";
  if (sku.startsWith("NER_")) return "NER_STOCK";
  return null;
}
