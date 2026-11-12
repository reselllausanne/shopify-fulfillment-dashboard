import {
  fetchStockxProductByIdOrSlugRaw,
  kickdbVariantMatchesGtin,
  matchVariantsBySize,
} from "@/galaxus/kickdb/client";
import { extractBrand } from "@/galaxus/kickdb/extract";
import { prisma } from "@/app/lib/prisma";
import { deriveStockxRawAskFromStoredBuyPrice } from "@/galaxus/pricing/suggestedSellPrice";
import { STX_SUPPLIER_VARIANT_WHERE } from "@/galaxus/supplier/supplierKeyGuards";
import { gtinCandidates } from "@/shopify/restock/gtinNormalize";
import { resolveKickdbSlugForGtin } from "@/shopify/restock/resolveKickdbSlugForGtin";
import {
  calcShopifySellPrice,
  calcShopifyTouchPrice,
} from "@/shopify/pricing/calcShopifySellPrice";

export type PhysicalRestockPricing = {
  /** StockX Buy Now ask, CHF, before our fees. */
  stockxRaw: number | null;
  cost: number | null;
  /** Storefront compare-at. Same number as `stockxRaw` (raw Buy Now). */
  compareAt: number | null;
  /** `warehouseHalfBuyNowPrice(stockxRaw)`. */
  sellPrice: number | null;
  /** Normal site price after the pair sells (`calcShopifySellPrice`). */
  siteSellPrice: number | null;
  source: string;
  /** Landed SupplierVariant.price (CHF) when an stx row existed. Often list×1.1065+ship. */
  storedBuyPrice: number | null;
};

/**
 * Warehouse shelf sell: half the StockX Buy Now ask, floored to the nearest 0.50 CHF.
 * `Math.floor(buyNow * 0.5 * 2) / 2`. Returns null when the result is not a positive price.
 */
export function warehouseHalfBuyNowPrice(buyNowChf: number): number | null {
  if (!Number.isFinite(buyNowChf) || buyNowChf <= 0) return null;
  const sale = Math.floor(buyNowChf * 0.5 * 2) / 2;
  if (!(sale > 0)) return null;
  return sale;
}

async function resolveProductContextForGtin(gtin: string): Promise<{
  handle: string | null;
  name: string | null;
  brand: string | null;
  slug: string | null;
}> {
  const cands = gtinCandidates(gtin);
  const kv = await prisma.kickDBVariant.findFirst({
    where: { OR: [{ gtin: { in: cands } }, { ean: { in: cands } }] },
    select: { product: { select: { urlKey: true, name: true, brand: true } } },
    orderBy: { updatedAt: "desc" },
  });
  if (kv?.product) {
    return {
      handle: kv.product.urlKey ?? null,
      name: kv.product.name ?? null,
      brand: kv.product.brand ?? null,
      slug: kv.product.urlKey ?? null,
    };
  }

  const slug = await resolveKickdbSlugForGtin(gtin);
  if (slug) {
    return { handle: slug, name: null, brand: null, slug };
  }

  return { handle: null, name: null, brand: null, slug: null };
}

function priceFromKickdbVariant(variant: any): number | null {
  const lowestAsk = Number(variant?.lowest_ask);
  if (Number.isFinite(lowestAsk) && lowestAsk > 0) return lowestAsk;

  const prices = Array.isArray(variant?.prices) ? variant.prices : [];
  const standard = prices.filter(
    (p: any) => String(p?.type ?? "").toLowerCase() === "standard" && Number(p?.price) > 0
  );
  if (standard.length) {
    return Math.min(...standard.map((p: any) => Number(p.price)));
  }
  const anyPrice = prices.find((p: any) => Number(p?.price) > 0);
  return anyPrice ? Number(anyPrice.price) : null;
}

async function resolveStockxRawFromKickdbLive(
  gtin: string,
  slug: string,
  sizeEu?: string | null
): Promise<{
  stockxRaw: number | null;
  name: string | null;
  brand: string | null;
  matchedBy: "gtin" | "size" | null;
}> {
  const empty = {
    stockxRaw: null as number | null,
    name: null as string | null,
    brand: null as string | null,
    matchedBy: null as "gtin" | "size" | null,
  };
  try {
    const { product } = await fetchStockxProductByIdOrSlugRaw(slug);
    const name =
      String((product as any)?.title ?? (product as any)?.name ?? "").trim() || null;
    const brand = extractBrand(product as any);
    const variants = Array.isArray((product as any)?.variants) ? (product as any).variants : [];

    for (const variant of variants) {
      if (!kickdbVariantMatchesGtin(variant, gtin)) continue;
      const price = priceFromKickdbVariant(variant);
      if (price != null) return { stockxRaw: price, name, brand, matchedBy: "gtin" };
    }

    // KickDB catalogs frequently lack barcodes — the pair on the shelf still
    // has an ask. Fall back to matching the KickDB variant by EU size.
    if (sizeEu) {
      const sized = matchVariantsBySize(variants, sizeEu, { brand });
      for (const variant of sized) {
        const price = priceFromKickdbVariant(variant);
        if (price != null) return { stockxRaw: price, name, brand, matchedBy: "size" };
      }
    }

    return { stockxRaw: null, name, brand, matchedBy: null };
  } catch {
    return empty;
  }
}

export type PhysicalRestockPricingContext = {
  /** KickDB slug when already known (skips GTIN->slug resolution). */
  slug?: string | null;
  /** EU size of the physical pair — enables ask lookup when KickDB has no GTIN. */
  sizeEu?: string | null;
};

/**
 * Physical warehouse pricing:
 * - compareAt = StockX Buy Now ask (CHF, before fees) — not landed cost, not site sell
 * - sell = Buy Now / 2, floored to 0.50 CHF
 * - siteSellPrice = calcShopifySellPrice — used only after the pair is sold
 *
 * Ask resolution order: stored stx lane (derive raw ask from landed price) →
 * KickDB live by GTIN → KickDB live by slug + EU size. A fresher KickDB ask
 * does not replace a stored stx row.
 */
export async function resolvePhysicalRestockPricing(
  gtin: string,
  context: PhysicalRestockPricingContext = {}
): Promise<PhysicalRestockPricing> {
  const cleanGtin = String(gtin ?? "").trim();
  const empty: PhysicalRestockPricing = {
    stockxRaw: null,
    cost: null,
    compareAt: null,
    sellPrice: null,
    siteSellPrice: null,
    source: "none",
    storedBuyPrice: null,
  };
  if (!cleanGtin) return empty;

  const ctx = await resolveProductContextForGtin(cleanGtin);
  const contextSlug = String(context.slug ?? "").trim() || null;
  if (contextSlug && !ctx.slug) {
    ctx.slug = contextSlug;
    ctx.handle = ctx.handle ?? contextSlug;
  }
  const sizeEu = String(context.sizeEu ?? "").trim() || null;
  let stockxRaw: number | null = null;
  let source = "none";
  let storedBuyPrice: number | null = null;

  const gtinLookup = gtinCandidates(cleanGtin);
  const stxRow = await prisma.supplierVariant.findFirst({
    where: {
      gtin: { in: gtinLookup.length > 0 ? gtinLookup : [cleanGtin] },
      ...STX_SUPPLIER_VARIANT_WHERE,
    },
    select: { price: true, supplierProductName: true, deliveryType: true, supplierBrand: true },
    orderBy: { updatedAt: "desc" },
  });

  if (stxRow?.price) {
    const buy = Number(stxRow.price);
    if (Number.isFinite(buy) && buy > 0) {
      storedBuyPrice = buy;
      stockxRaw = deriveStockxRawAskFromStoredBuyPrice(buy, {
        slug: ctx.slug,
        urlKey: ctx.handle,
        name: ctx.name ?? stxRow.supplierProductName,
      });
      if (stockxRaw) source = "stx-db";
    }
  }

  if (!stockxRaw && ctx.slug) {
    const live = await resolveStockxRawFromKickdbLive(cleanGtin, ctx.slug, sizeEu);
    if (live.stockxRaw) {
      stockxRaw = live.stockxRaw;
      source = live.matchedBy === "size" ? "kickdb-live-size" : "kickdb-live";
      if (!ctx.name && live.name) ctx.name = live.name;
      if (!ctx.brand && live.brand) ctx.brand = live.brand;
    }
  }

  if (!stockxRaw) return { ...empty, storedBuyPrice };

  const isExpress = String(stxRow?.deliveryType ?? "").startsWith("express_");
  const category = undefined;
  const cost = calcShopifyTouchPrice({
    stockxRaw,
    productHandle: ctx.handle,
    productCategory: category,
  });
  const siteSellPrice = calcShopifySellPrice({
    stockxRaw,
    productHandle: ctx.handle,
    productName: ctx.name ?? stxRow?.supplierProductName,
    brand: ctx.brand ?? stxRow?.supplierBrand,
    isExpress,
  });
  const compareAt = stockxRaw;
  const sellPrice = warehouseHalfBuyNowPrice(stockxRaw);

  return {
    stockxRaw,
    cost,
    compareAt,
    sellPrice,
    siteSellPrice,
    source,
    storedBuyPrice,
  };
}
