import { resolveGalaxusBuySourceOverride } from "@/galaxus/warehouse/buySourceOverride";

/** True when the Galaxus line is the StockX (STX) supplier channel (vs TRM/GLD, etc.). */
export function isGalaxusStxSupplierLine(line: {
  supplierPid?: string | null;
  supplierVariantId?: string | null;
  providerKey?: string | null;
  gtin?: string | null;
  offerSupplierSku?: string | null;
}): boolean {
  // Listed as STX but buy-source override → treat as non-STX for auto-link / reserve.
  if (resolveGalaxusBuySourceOverride(line)) return false;
  if (isGalaxusGldSupplierLine(line)) return false;
  const supplierPid = String(line?.supplierPid ?? "").trim().toUpperCase();
  if (supplierPid.startsWith("STX_")) return true;
  const supplierVariantId = String(line?.supplierVariantId ?? "").trim().toLowerCase();
  if (supplierVariantId.startsWith("stx_")) return true;
  const providerKeyRaw = String(line?.providerKey ?? "").trim().toUpperCase();
  if (providerKeyRaw === "STX" || providerKeyRaw.startsWith("STX_")) return true;
  return false;
}

/** Golden / GLD dropship — warehouse Poland, not StockX, not Swiss direct delivery. */
export function isGalaxusGldSupplierLine(line: {
  supplierPid?: string | null;
  supplierVariantId?: string | null;
  providerKey?: string | null;
  supplierSku?: string | null;
}): boolean {
  const supplierPid = String(line?.supplierPid ?? "").trim().toUpperCase();
  if (supplierPid.startsWith("GLD_") || supplierPid === "GLD") return true;
  const providerKey = String(line?.providerKey ?? "").trim().toUpperCase();
  if (providerKey.startsWith("GLD_") || providerKey === "GLD") return true;
  const supplierSku = String(line?.supplierSku ?? "").trim().toUpperCase();
  if (supplierSku.startsWith("GLD_")) return true;
  const supplierVariantId = String(line?.supplierVariantId ?? "").trim().toLowerCase();
  if (supplierVariantId.startsWith("golden:") || supplierVariantId.startsWith("gld:")) return true;
  return false;
}

/**
 * Galaxus offer / provider prefix:
 * - `THE_` — own in-stock (no StockX)
 * - `NER_` — partner in-stock (no StockX)
 * - `GLD_` / `golden:` — Golden dropship (manual order later; no StockX)
 */
export type GalaxusWarehouseStockHint = "MAISON" | "NER_STOCK" | "GOLDEN";

export function isTheWarehouseSupplierSku(sku: string | null | undefined): boolean {
  return /^THE_/i.test(String(sku ?? "").trim());
}

export function isNerWarehouseSupplierSku(sku: string | null | undefined): boolean {
  return /^NER_/i.test(String(sku ?? "").trim());
}

export function isGldWarehouseSupplierSku(sku: string | null | undefined): boolean {
  return /^GLD_/i.test(String(sku ?? "").trim()) || String(sku ?? "").trim().toUpperCase() === "GLD";
}

/** Galaxus offer SKU (NER_/THE_/GLD_ prefix or providerKey), not catalog style id. */
export function resolveGalaxusLineOfferSupplierSku(line: {
  supplierSku?: string | null;
  providerKey?: string | null;
}): string | null {
  const rawLineSku = String(line?.supplierSku ?? "").trim();
  const providerKey = String(line?.providerKey ?? "").trim();
  if (
    isTheWarehouseSupplierSku(rawLineSku) ||
    isNerWarehouseSupplierSku(rawLineSku) ||
    isGldWarehouseSupplierSku(rawLineSku)
  ) {
    return rawLineSku;
  }
  if (
    isTheWarehouseSupplierSku(providerKey) ||
    isNerWarehouseSupplierSku(providerKey) ||
    isGldWarehouseSupplierSku(providerKey)
  ) {
    return providerKey;
  }
  return rawLineSku || providerKey || null;
}

export function galaxusLineWarehouseStockHint(line: {
  supplierSku?: string | null;
  providerKey?: string | null;
  offerSupplierSku?: string | null;
  supplierPid?: string | null;
  supplierVariantId?: string | null;
  gtin?: string | null;
}): GalaxusWarehouseStockHint | null {
  const buyOverride = resolveGalaxusBuySourceOverride(line);
  if (buyOverride?.hint === "GOLDEN") return "GOLDEN";
  if (isGalaxusGldSupplierLine(line)) return "GOLDEN";
  const offer =
    String(line?.offerSupplierSku ?? "").trim() ||
    resolveGalaxusLineOfferSupplierSku({
      supplierSku: line.supplierSku,
      providerKey: line.providerKey,
    });
  if (!offer) return null;
  if (isTheWarehouseSupplierSku(offer)) return "MAISON";
  if (isNerWarehouseSupplierSku(offer)) return "NER_STOCK";
  if (isGldWarehouseSupplierSku(offer)) return "GOLDEN";
  return null;
}
