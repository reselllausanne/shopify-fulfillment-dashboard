import { pickGalaxusProductImageList } from "@/galaxus/exports/productImages";
import {
  meetsGalaxusStockMoq,
  resolveGalaxusStockMoq,
  type GalaxusStockMoq,
} from "@/galaxus/exports/stockMoq";

type CatalogVariant = {
  images?: unknown;
  sourceImageUrl?: string | null;
  hostedImageUrl?: string | null;
  imageSyncStatus?: string | null;
  supplierProductName?: string | null;
  supplierBrand?: string | null;
  supplierSku?: string | null;
} | null | undefined;

/**
 * Master-feed readiness: image + identity fields.
 * Stock/offer must not publish ProviderKeys that cannot appear in master —
 * Galaxus treats stock-only keys as "Add" and fails with "GTIN is missing"
 * when catalog rows never arrived (common for incomplete NER).
 */
export function isGalaxusCatalogReady(variant: CatalogVariant): boolean {
  if (!variant) return false;
  if (pickGalaxusProductImageList(variant).length === 0) return false;
  const name = String(variant.supplierProductName ?? "").trim();
  const brand = String(variant.supplierBrand ?? "").trim();
  // Name or SKU required so master can build a title; brand required by Galaxus.
  if (!name && !String(variant.supplierSku ?? "").trim()) return false;
  if (!brand) return false;
  return true;
}

export function resolveGalaxusFeedMoq(input: {
  supplierKey?: string | null;
  supplierVariantId?: string | null;
  providerKey?: string | null;
  manualNote?: string | null;
}): GalaxusStockMoq {
  return resolveGalaxusStockMoq(input);
}

/** True when published qty can satisfy supplier MOQ (GLD = 3). */
export function isGalaxusSellableStock(
  stock: number,
  moqInput: {
    supplierKey?: string | null;
    supplierVariantId?: string | null;
    providerKey?: string | null;
    manualNote?: string | null;
    moq?: GalaxusStockMoq;
  }
): boolean {
  const moq = moqInput.moq ?? resolveGalaxusStockMoq(moqInput);
  return meetsGalaxusStockMoq(stock, moq);
}

/**
 * Galaxus stock CSV `DirectDeliverySupported`.
 * - GLD: always 0 (PL→CH batch, no Swiss DD)
 * - STX `standard` dropship (no physical mirror): 0 — slow StockX must not be offered as DD
 * - express STX / physical / partners: 1
 */
export function resolveGalaxusDirectDeliverySupported(input: {
  isGld?: boolean;
  isStx?: boolean;
  deliveryType?: string | null;
  hasPhysicalStock?: boolean;
}): "0" | "1" {
  if (input.isGld) return "0";
  const deliveryType = String(input.deliveryType ?? "").trim().toLowerCase();
  if (input.isStx && deliveryType === "standard" && !input.hasPhysicalStock) {
    return "0";
  }
  return "1";
}
