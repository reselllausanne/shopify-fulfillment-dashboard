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
 * - `THE_` / `the_` — your own in-stock item (no StockX purchase link)
 * - `NER_` / `ner_` — partner in-stock item (no StockX purchase link)
 */
export type GalaxusWarehouseStockHint = "MAISON" | "NER_STOCK";

export function isTheWarehouseSupplierSku(sku: string | null | undefined): boolean {
  return /^THE_/i.test(String(sku ?? "").trim());
}

export function isNerWarehouseSupplierSku(sku: string | null | undefined): boolean {
  return /^NER_/i.test(String(sku ?? "").trim());
}

export function galaxusLineWarehouseStockHint(line: { supplierSku?: string | null }): GalaxusWarehouseStockHint | null {
  const sku = String(line?.supplierSku ?? "").trim();
  if (!sku) return null;
  if (isTheWarehouseSupplierSku(sku)) return "MAISON";
  if (isNerWarehouseSupplierSku(sku)) return "NER_STOCK";
  return null;
}
