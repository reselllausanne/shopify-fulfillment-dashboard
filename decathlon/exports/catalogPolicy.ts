/**
 * Hard Decathlon sellable-lane policy. Do not loosen.
 *
 * Live qty only from:
 * - own warehouse (physical instock, merged onto an STX SKU), and
 * - StockX `express_expedited`.
 *
 * Never live: NER, SNL, BAE, WEL, REI, GLD, THE, express_standard, standard, Onitsuka.
 */
import type { DecathlonExportCandidate } from "./types";

export const DECATHLON_SELLABLE_SUPPLIER_KEY = "stx";
export const DECATHLON_STX_REQUIRED_DELIVERY = "express_expedited";
export const DECATHLON_BLOCKED_SUPPLIER_KEYS = [
  "ner",
  "snl",
  "bae",
  "wel",
  "rei",
  "gld",
  "the",
] as const;

export function isDecathlonExpressExpeditedDelivery(
  deliveryType: string | null | undefined
): boolean {
  return String(deliveryType ?? "").trim().toLowerCase() === DECATHLON_STX_REQUIRED_DELIVERY;
}

export function isDecathlonSellableSupplierKey(supplierKey: string | null | undefined): boolean {
  return String(supplierKey ?? "").trim().toLowerCase() === DECATHLON_SELLABLE_SUPPLIER_KEY;
}

export function isDecathlonBlockedSupplierKey(supplierKey: string | null | undefined): boolean {
  const key = String(supplierKey ?? "").trim().toLowerCase();
  return (DECATHLON_BLOCKED_SUPPLIER_KEYS as readonly string[]).includes(key);
}

/** Warehouse units always publish on Decathlon (STX SKU). Not gated by Shopify env flags. */
export function isDecathlonPhysicalInstockEnabled(): boolean {
  return true;
}

export function isDecathlonProductOnboardable(candidate: DecathlonExportCandidate): boolean {
  const supplierVariantId = String(candidate?.variant?.supplierVariantId ?? "");
  const providerKey = String(candidate?.providerKey ?? "");
  const raw = supplierVariantId || providerKey;
  const rawKey = raw.includes(":") ? raw.split(":")[0] : raw.includes("_") ? raw.split("_")[0] : raw;
  const supplierKey = rawKey ? rawKey.toLowerCase() : null;
  if (!isDecathlonSellableSupplierKey(supplierKey)) return false;
  const hay = [
    candidate?.variant?.supplierBrand,
    candidate?.variant?.supplierProductName,
    candidate?.product?.brand,
    candidate?.product?.name,
    candidate?.product?.urlKey,
  ]
    .map((v) => String(v ?? "").toLowerCase())
    .join(" ");
  if (hay.includes("onitsuka")) return false;
  return true;
}
