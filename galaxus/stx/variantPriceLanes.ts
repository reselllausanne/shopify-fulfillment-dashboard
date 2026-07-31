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

export function allowsStxStandardImport(payload: unknown, slug?: string | null): boolean {
  const handle = slug ?? pickString(
    (payload as { slug?: unknown })?.slug,
    (payload as { url_key?: unknown })?.url_key,
    (payload as { urlKey?: unknown })?.urlKey
  );
  return isStxForceImportSlug(handle) || isLegoStxSlug(handle) || isLegoStxProduct(payload as object);
}

/** Galaxus/Decathlon feeds: express always; standard only for LEGO / force-import slugs. */
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
    return allowsStxStandardImport(
      options?.product ?? (options?.productName ? { title: options.productName } : null),
      options?.slug
    );
  }
  return false;
}

/**
 * DB mirror + Shopify STX pricing: store every size with a usable StockX ask
 * (express preferred, standard fallback). Marketplace export filters separately.
 */
export function buildStxDualPriceFields(
  variant: { prices?: unknown },
  payload: ShippingPayload,
  productName: string | null,
  _options?: { forceImport?: boolean; slug?: string | null }
): StxDualPriceFields | null {
  const express = selectStxActiveOffer(variant?.prices);
  const standard = selectStxStandardOffer(variant?.prices);
  const active = express ?? standard;
  if (!active) return null;

  const expressBuy = express ? buyFromOffer(express, payload) : null;
  const standardBuy = standard ? buyFromOffer(standard, payload) : null;
  const activeBuy =
    express && expressBuy != null
      ? expressBuy
      : standardBuy ?? buyFromOffer(active, payload);

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
