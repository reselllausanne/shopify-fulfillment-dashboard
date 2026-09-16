import { calcSuggestedRetailFromStxOffer } from "@/galaxus/pricing/suggestedSellPrice";
import { estimatedStockxBuyChfFromList } from "@/galaxus/stx/chfStockxBuyPrice";
import { isStxForceImportSlug } from "@/galaxus/stx/forceImportSlugs";
import { isLegoStxProduct, isLegoStxSlug } from "@/galaxus/stx/legoProduct";
import { resolveStxShippingCHF } from "@/galaxus/stx/legoShipping";
import {
  selectStxActiveOffer,
  selectStxStandardOffer,
  type SelectedStxOffer,
  type StxDeliveryType,
} from "@/galaxus/stx/offerSelection";

type ShippingPayload = {
  slug?: unknown;
  url_key?: unknown;
  urlKey?: unknown;
  title?: unknown;
  primary_title?: unknown;
  name?: unknown;
} | null | undefined;

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function buyFromOffer(offer: SelectedStxOffer, payload: ShippingPayload): number {
  return estimatedStockxBuyChfFromList(offer.price, resolveStxShippingCHF(payload));
}

function suggestedFromOffer(
  offer: SelectedStxOffer,
  payload: unknown,
  productName: string | null
): number | null {
  return calcSuggestedRetailFromStxOffer({
    stockxRaw: offer.price,
    productHandle: pickString(
      (payload as { slug?: unknown })?.slug,
      (payload as { url_key?: unknown })?.url_key,
      (payload as { urlKey?: unknown })?.urlKey
    ),
    productName,
    deliveryType: offer.deliveryType,
  });
}

export type StxDualPriceFields = {
  price: number;
  stock: number;
  deliveryType: StxDeliveryType;
  suggestedRetailPriceInclVat: number | null;
  standardBuyPrice: number | null;
  expressBuyPrice: number | null;
  standardSuggestedRetailPriceInclVat: number | null;
};

/**
 * Max express/standard buy ratio before we abandon express as the active Galaxus
 * lane. Default 2 = express ≥ 100% more expensive than standard → use standard.
 * Env: STX_EXPRESS_OVER_STANDARD_MAX_RATIO (e.g. "2", "1.5").
 */
export function readStxExpressOverStandardMaxRatio(): number {
  const raw = process.env.STX_EXPRESS_OVER_STANDARD_MAX_RATIO ?? "2";
  const n = Number.parseFloat(String(raw));
  if (!Number.isFinite(n) || n < 1) return 2;
  return n;
}

/**
 * Thin/outlier express asks (often 1 ask at absurd CHF) must not drive the
 * marketplace `price` / `deliveryType`. Keep both lane fields for Shopify.
 */
export function shouldPreferStandardOverExpress(
  expressBuy: number | null | undefined,
  standardBuy: number | null | undefined,
  maxRatio: number = readStxExpressOverStandardMaxRatio()
): boolean {
  if (expressBuy == null || standardBuy == null) return false;
  if (!(expressBuy > 0) || !(standardBuy > 0)) return false;
  if (!(maxRatio >= 1)) return false;
  return expressBuy >= standardBuy * maxRatio;
}

export function allowsStxStandardImport(payload: unknown, slug?: string | null): boolean {
  const handle = slug ?? pickString(
    (payload as { slug?: unknown })?.slug,
    (payload as { url_key?: unknown })?.url_key,
    (payload as { urlKey?: unknown })?.urlKey
  );
  return isStxForceImportSlug(handle) || isLegoStxSlug(handle) || isLegoStxProduct(payload as object);
}

/**
 * Galaxus/Decathlon marketplace publish gate.
 *
 * - express_* → always
 * - standard → allowed when `GALAXUS_STX_ALLOW_STANDARD_SHIPPING` is not `0`/`false`/`no`
 *   (default ON — restores pre-2026-07-31 volume). Set env to `0` to limit standard
 *   dropship to LEGO / force-import slugs only.
 */
export function isStxMarketplacePublishableDeliveryType(
  deliveryType: string,
  options?: {
    slug?: string | null;
    product?: unknown;
    productName?: string | null;
  }
): boolean {
  const normalized = String(deliveryType ?? "").trim();
  if (normalized.startsWith("express_")) return true;
  if (normalized === "standard") {
    const raw = String(process.env.GALAXUS_STX_ALLOW_STANDARD_SHIPPING ?? "1").toLowerCase();
    const allowAllStandard = !["0", "false", "no"].includes(raw);
    if (allowAllStandard) return true;
    return allowsStxStandardImport(
      options?.product ?? (options?.productName ? { title: options.productName } : null),
      options?.slug
    );
  }
  return false;
}

/**
 * DB mirror + Shopify STX pricing: store every size with a usable StockX ask.
 * Express preferred when present *and* not absurdly above standard (≥100% by
 * default). Otherwise standard. Marketplace export filters separately.
 */
export function buildStxDualPriceFields(
  variant: { prices?: unknown },
  payload: ShippingPayload,
  productName: string | null,
  _options?: { forceImport?: boolean; slug?: string | null }
): StxDualPriceFields | null {
  const express = selectStxActiveOffer(variant?.prices);
  const standard = selectStxStandardOffer(variant?.prices);
  if (!express && !standard) return null;

  const expressBuy = express ? buyFromOffer(express, payload) : null;
  const standardBuy = standard ? buyFromOffer(standard, payload) : null;

  const preferStandard =
    Boolean(standard) && shouldPreferStandardOverExpress(expressBuy, standardBuy);
  const active = preferStandard ? standard! : (express ?? standard!);

  const activeBuy =
    preferStandard || !express
      ? standardBuy ?? buyFromOffer(active, payload)
      : expressBuy ?? buyFromOffer(active, payload);

  return {
    price: activeBuy,
    stock: active.asks,
    deliveryType: active.deliveryType,
    suggestedRetailPriceInclVat: suggestedFromOffer(active, payload, productName),
    standardBuyPrice: standardBuy,
    expressBuyPrice: expressBuy,
    standardSuggestedRetailPriceInclVat: standard
      ? suggestedFromOffer(standard, payload, productName)
      : null,
  };
}
