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
  calcPhysicalLiquidationSellPrice,
  calcShopifySellPrice,
  calcShopifyTouchPrice,
} from "@/shopify/pricing/calcShopifySellPrice";

export type PhysicalRestockPricing = {
  stockxRaw: number | null;
  cost: number | null;
  compareAt: number | null;
  sellPrice: number | null;
  source: string;
};

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
 * Physical restock pricing:
 * - cost = calc_touch_price(stockx raw)
 * - compareAt = calcShopifySellPrice(stockx raw)
 * - sell = cost − 30% (LIQUIDATION_DISCOUNT_PCT)
 *
 * Ask resolution order: stx DB row by GTIN → KickDB live by GTIN → KickDB
 * live by slug + EU size (KickDB barcode coverage is unreliable).
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
    source: "none",
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

  const stxRow = await prisma.supplierVariant.findFirst({
    where: {
      gtin: cleanGtin,
      ...STX_SUPPLIER_VARIANT_WHERE,
    },
    select: { price: true, supplierProductName: true, deliveryType: true, supplierBrand: true },
    orderBy: { updatedAt: "desc" },
  });

  if (stxRow?.price) {
    const buy = Number(stxRow.price);
    if (Number.isFinite(buy) && buy > 0) {
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

  if (!stockxRaw) return empty;

  const isExpress = String(stxRow?.deliveryType ?? "").startsWith("express_");
  const category = undefined;
  const cost = calcShopifyTouchPrice({
    stockxRaw,
    productHandle: ctx.handle,
    productCategory: category,
  });
  const compareAt = calcShopifySellPrice({
    stockxRaw,
    productHandle: ctx.handle,
    productName: ctx.name ?? stxRow?.supplierProductName,
    brand: ctx.brand ?? stxRow?.supplierBrand,
    isExpress,
  });
  const sellPrice = cost != null ? calcPhysicalLiquidationSellPrice(cost) : null;

  return { stockxRaw, cost, compareAt, sellPrice, source };
}
