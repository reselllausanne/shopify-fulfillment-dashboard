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
  supplierKey?: string | null;
  supplierVariantId?: string | null;
} | null | undefined;

/**
 * True when the variant is a XNT partner row we must exclude from all Galaxus
 * feeds. Applied on top of `isGalaxusCatalogReady` (master) + downstream stock
 * / offer eligibility to keep every CSV in sync.
 */
export function isXntFeedBlockedBrand(variant: CatalogVariant): boolean {
  if (!variant) return false;
  const supplierKey = String(variant.supplierKey ?? "").toLowerCase();
  const supplierVariantId = String(variant.supplierVariantId ?? "").toLowerCase();
  return (
    supplierKey === "xnt" ||
    supplierVariantId.startsWith("xnt_") ||
    supplierVariantId.startsWith("xnt:")
  );
}

function stockPositiveAllowlistKeys(): Set<string> {
  // Read env at call time so VPS/env patches apply without module-cache tricks.
  const raw = String(process.env.GALAXUS_STOCK_POSITIVE_ALLOWLIST ?? "").trim();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function resolveSupplierKeyPrefix(input: {
  supplierKey?: string | null;
  supplierVariantId?: string | null;
  providerKey?: string | null;
}): string {
  const fromKey = String(input.supplierKey ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (fromKey) return fromKey.slice(0, 3);
  const fromSv = String(input.supplierVariantId ?? "")
    .trim()
    .toLowerCase();
  if (fromSv.includes("_")) return fromSv.split("_")[0]!.slice(0, 3);
  if (fromSv.includes(":")) return fromSv.split(":")[0]!.slice(0, 3);
  const fromPk = String(input.providerKey ?? "")
    .trim()
    .toLowerCase();
  if (fromPk.includes("_")) return fromPk.split("_")[0]!.slice(0, 3);
  return fromPk.slice(0, 3);
}

/**
 * When `GALAXUS_STOCK_POSITIVE_ALLOWLIST` is set, force stock=0 for every
 * supplier not on the list. Empty env = disabled (no force-zero).
 */
export function shouldForceGalaxusStockZero(input: {
  supplierKey?: string | null;
  supplierVariantId?: string | null;
  providerKey?: string | null;
}): boolean {
  const allow = stockPositiveAllowlistKeys();
  if (allow.size === 0) return false;
  const prefix = resolveSupplierKeyPrefix(input);
  if (!prefix) return true;
  return !(allow.has(prefix) || allow.has(String(input.supplierKey ?? "").trim().toLowerCase()));
}

/**
 * Master-feed readiness: image + identity fields.
 * Stock/offer must not publish ProviderKeys that cannot appear in master —
 * Galaxus treats stock-only keys as "Add" and fails with "GTIN is missing"
 * when catalog rows never arrived (common for incomplete NER).
 *
 * Note: XNT block is NOT applied here anymore.
 * The stock feed must still be able to emit stock=0 for those rows so Galaxus
 * delists what was previously pushed. Master + offer routes call
 * `isXntFeedBlockedBrand` explicitly to skip catalog/offer updates.
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
