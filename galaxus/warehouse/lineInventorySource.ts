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

/** Galaxus offer SKU (NER_/THE_ prefix or providerKey), not catalog style id. */
export function resolveGalaxusLineOfferSupplierSku(line: {
  supplierSku?: string | null;
  providerKey?: string | null;
}): string | null {
  const rawLineSku = String(line?.supplierSku ?? "").trim();
  const providerKey = String(line?.providerKey ?? "").trim();
  if (isTheWarehouseSupplierSku(rawLineSku) || isNerWarehouseSupplierSku(rawLineSku)) return rawLineSku;
  if (isTheWarehouseSupplierSku(providerKey) || isNerWarehouseSupplierSku(providerKey)) return providerKey;
  return rawLineSku || providerKey || null;
}

export function galaxusLineWarehouseStockHint(line: {
  supplierSku?: string | null;
  providerKey?: string | null;
  offerSupplierSku?: string | null;
}): GalaxusWarehouseStockHint | null {
  const offer =
    String(line?.offerSupplierSku ?? "").trim() ||
    resolveGalaxusLineOfferSupplierSku({
      supplierSku: line.supplierSku,
      providerKey: line.providerKey,
    });
  if (!offer) return null;
  if (isTheWarehouseSupplierSku(offer)) return "MAISON";
  if (isNerWarehouseSupplierSku(offer)) return "NER_STOCK";
  return null;
}
