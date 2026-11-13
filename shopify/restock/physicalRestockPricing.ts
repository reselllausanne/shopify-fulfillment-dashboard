import {
  fetchStockxProductByIdOrSlugRaw,
  kickdbVariantMatchesGtin,
  matchVariantsBySize,
} from "@/galaxus/kickdb/client";
import { extractBrand } from "@/galaxus/kickdb/extract";
import { prisma } from "@/app/lib/prisma";
import { STX_SUPPLIER_VARIANT_WHERE } from "@/galaxus/supplier/supplierKeyGuards";
import { gtinCandidates } from "@/shopify/restock/gtinNormalize";
import { resolveKickdbSlugForGtin } from "@/shopify/restock/resolveKickdbSlugForGtin";
import {
  calcShopifySellFromSourceCost,
  calcShopifySellPrice,
  calcShopifyTouchPrice,
} from "@/shopify/pricing/calcShopifySellPrice";

export type PhysicalRestockPricing = {
  /** Raw StockX ask, CHF, before fees. From KickDB on this call. Null on stored fallback. */
  stockxRaw: number | null;
  /** Buy Now AFTER fees (CHF): `calcShopifyTouchPrice(raw)` from KickDB, else stored landed price. */
  buyNowAfterFees: number | null;
  cost: number | null;
  /** Storefront compare-at. Same number as `buyNowAfterFees`. */
  compareAt: number | null;
  /** `warehouseHalfBuyNowPrice(buyNowAfterFees)`. */
  sellPrice: number | null;
  /** Normal site price after the pair sells (`calcShopifySellPrice`). */
  siteSellPrice: number | null;
  source: string;
  /** Landed SupplierVariant.price (CHF) when an stx row existed. Often list×1.1065+ship. */
  storedBuyPrice: number | null;
};

/**
 * Warehouse shelf sell: half the StockX Buy Now AFTER fees, floored to the nearest 0.50 CHF.
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
 * Physical warehouse pricing. Recalculated on every call from KickDB (CHF):
 * - raw ask = KickDB live (GTIN, else slug + EU size)
 * - Buy Now after fees = `calcShopifyTouchPrice` (raw × STX multiplier + 20 CHF)
 * - compareAt = that Buy Now after fees
 * - sell = Buy Now after fees / 2, floored to 0.50 CHF
 * - siteSellPrice = calcShopifySellPrice — used only after the pair is sold
 *
 * Stored `SupplierVariant.price` is not the sale anchor. It is only a fallback
 * when this call gets no KickDB ask. A stored row never blocks the live ask.
 */
export async function resolvePhysicalRestockPricing(
  gtin: string,
  context: PhysicalRestockPricingContext = {}
): Promise<PhysicalRestockPricing> {
  const cleanGtin = String(gtin ?? "").trim();
  const empty: PhysicalRestockPricing = {
    stockxRaw: null,
    buyNowAfterFees: null,
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

  let buyNowAfterFees: number | null = null;

  if (stxRow?.price) {
    const buy = Number(stxRow.price);
    if (Number.isFinite(buy) && buy > 0) storedBuyPrice = buy;
  }

  // Every call: live KickDB ask, then fees. Stored price does not win.
  if (ctx.slug) {
    const live = await resolveStockxRawFromKickdbLive(cleanGtin, ctx.slug, sizeEu);
    if (live.stockxRaw) {
      stockxRaw = live.stockxRaw;
      source = live.matchedBy === "size" ? "kickdb-live-size" : "kickdb-live";
      if (!ctx.name && live.name) ctx.name = live.name;
      if (!ctx.brand && live.brand) ctx.brand = live.brand;
    }
  }

  if (stockxRaw) {
    const touch = calcShopifyTouchPrice({
      stockxRaw,
      productHandle: ctx.handle,
      productCategory: undefined,
    });
    if (touch != null && touch > 0) buyNowAfterFees = round2(touch);
  }

  if (buyNowAfterFees == null && storedBuyPrice != null) {
    buyNowAfterFees = round2(storedBuyPrice);
    source = "stx-db";
  }

  if (buyNowAfterFees == null || buyNowAfterFees <= 0) return { ...empty, storedBuyPrice };

  const isExpress = String(stxRow?.deliveryType ?? "").startsWith("express_");
  const cost = buyNowAfterFees;
  const siteSellPrice = stockxRaw
    ? calcShopifySellPrice({
        stockxRaw,
        productHandle: ctx.handle,
        productName: ctx.name ?? stxRow?.supplierProductName,
        brand: ctx.brand ?? stxRow?.supplierBrand,
        isExpress,
      })
    : // stx row: landed cost is the source cost; no raw ask to re-derive.
      calcShopifySellFromSourceCost(buyNowAfterFees);
  const compareAt = buyNowAfterFees;
  const sellPrice = warehouseHalfBuyNowPrice(buyNowAfterFees);

  return {
    stockxRaw,
    buyNowAfterFees,
    cost,
    compareAt,
    sellPrice,
    siteSellPrice,
    source,
    storedBuyPrice,
  };
}
