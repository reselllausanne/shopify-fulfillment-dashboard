import { isStxListingEligibleAsks } from "@/galaxus/stx/stockPublish";
import type { DecathlonExportCandidate } from "./types";
import {
  readDecathlonStxMaxListPriceChf,
  resolveDecathlonBuyNow,
  type DecathlonStxListPriceContext,
} from "./pricing";
import { parseDecimal } from "./mapping";

export function decathlonStxListPriceContextFromCandidate(
  candidate: DecathlonExportCandidate
): DecathlonStxListPriceContext {
  const variant = candidate.variant ?? {};
  const product = candidate.product ?? candidate.kickdbVariant?.product ?? null;
  return {
    productHandle: product?.urlKey ?? null,
    productName: product?.name ?? variant?.supplierProductName ?? null,
    deliveryType: variant?.deliveryType ?? null,
  };
}

export function extractDecathlonOfferSupplierKey(candidate: DecathlonExportCandidate): string | null {
  const supplierVariantId = String(candidate?.variant?.supplierVariantId ?? "").trim();
  const providerKey = String(candidate?.providerKey ?? "").trim();
  const raw = supplierVariantId || providerKey;
  if (!raw) return null;
  const rawKey = raw.includes(":") ? raw.split(":")[0] : raw.includes("_") ? raw.split("_")[0] : raw;
  return rawKey ? rawKey.toLowerCase() : null;
}

export function isDecathlonStxCandidate(candidate: DecathlonExportCandidate): boolean {
  const supplierKey = extractDecathlonOfferSupplierKey(candidate);
  if (supplierKey === "stx") return true;
  const supplierVariantId = String(candidate?.variant?.supplierVariantId ?? "");
  const providerKey = String(candidate?.providerKey ?? "");
  return supplierVariantId.startsWith("stx_") || providerKey.startsWith("STX_");
}

/**
 * Onitsuka: KickDB/STX often store marketplace EAN (69…) that ≠ official size barcode.
 * Mirakl then binds the offer to the wrong catalog product. Block until GTIN hygiene fixed.
 */
export function isDecathlonOnitsukaBlocked(candidate: DecathlonExportCandidate): boolean {
  const variant = candidate.variant ?? {};
  const product = candidate.product ?? candidate.kickdbVariant?.product ?? null;
  const hay = [
    variant?.supplierBrand,
    variant?.supplierProductName,
    product?.brand,
    product?.name,
    product?.urlKey,
  ]
    .map((v) => String(v ?? "").toLowerCase())
    .join(" ");
  return hay.includes("onitsuka");
}

/** STX offer stock zero only when Mirakl list exceeds cap (default 400 CHF). */
export function isDecathlonStxOfferDelisted(params: {
  supplierKey: string | null;
  buyNow: number | null;
  listPriceTtc: number | null;
}): boolean {
  if (params.supplierKey !== "stx") return false;
  const maxList = readDecathlonStxMaxListPriceChf();
  return (
    params.listPriceTtc != null &&
    Number.isFinite(params.listPriceTtc) &&
    params.listPriceTtc > maxList
  );
}

function parseIntSafe(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** STX Mirakl quantity before delist rules — Decathlon = express_* only (no standard). */
export function resolveDecathlonStxOfferStockBeforeDelist(candidate: DecathlonExportCandidate): number {
  if (isDecathlonOnitsukaBlocked(candidate)) return 0;
  const variant = candidate.variant ?? {};
  const manualLock = Boolean(variant?.manualLock);
  const manualStock = parseIntSafe(variant?.manualStock);
  const baseStock = parseIntSafe(variant?.stock) ?? 0;
  const rawStock = manualLock && manualStock !== null ? manualStock : baseStock;
  const deliveryType = String(variant?.deliveryType ?? "").trim().toLowerCase();
  const expressOnly = deliveryType.startsWith("express_");
  const stxEligible =
    expressOnly && Number.isFinite(rawStock) && isStxListingEligibleAsks(rawStock);
  return stxEligible ? 1 : 0;
}

export function resolveDecathlonStxOfferBuyNow(candidate: DecathlonExportCandidate): number | null {
  const variant = candidate.variant ?? {};
  return resolveDecathlonBuyNow({
    buyNowStockx: parseDecimal(variant?.price),
    manualOverride: parseDecimal(variant?.manualPrice),
    manualLock: Boolean(variant?.manualLock),
  });
}

export function resolveDecathlonStxOfferStock(
  candidate: DecathlonExportCandidate,
  listPriceTtc: number | null
): number {
  const buyNow = resolveDecathlonStxOfferBuyNow(candidate);
  const supplierKey = extractDecathlonOfferSupplierKey(candidate);
  if (
    isDecathlonStxOfferDelisted({
      supplierKey,
      buyNow,
      listPriceTtc,
    })
  ) {
    return 0;
  }
  return resolveDecathlonStxOfferStockBeforeDelist(candidate);
}
