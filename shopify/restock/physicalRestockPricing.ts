import { fetchStockxProductByIdOrSlugRaw, extractVariantGtin } from "@/galaxus/kickdb/client";
import { prisma } from "@/app/lib/prisma";
import { deriveStockxRawAskFromStoredBuyPrice } from "@/galaxus/pricing/suggestedSellPrice";
import { gtinCandidates, gtinEquals } from "@/shopify/restock/gtinNormalize";
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
  return { handle: null, name: null, brand: null, slug: null };
}

async function resolveStockxRawFromKickdbLive(
  gtin: string,
  slug: string
): Promise<number | null> {
  try {
    const { product } = await fetchStockxProductByIdOrSlugRaw(slug);
    const variants = Array.isArray((product as any)?.variants) ? (product as any).variants : [];
    for (const variant of variants) {
      const vGtin = extractVariantGtin(variant);
      if (!vGtin || !gtinCandidates(gtin).some((c) => gtinEquals(vGtin, c))) continue;

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
      if (anyPrice) return Number(anyPrice.price);
    }
  } catch {
    // Non-fatal — caller tries other sources.
  }
  return null;
}

/**
 * Physical restock pricing:
 * - cost = calc_touch_price(stockx raw)
 * - compareAt = calcShopifySellPrice(stockx raw)
 * - sell = cost − 30% (LIQUIDATION_DISCOUNT_PCT)
 */
export async function resolvePhysicalRestockPricing(gtin: string): Promise<PhysicalRestockPricing> {
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
  let stockxRaw: number | null = null;
  let source = "none";

  const stxRow = await prisma.supplierVariant.findFirst({
    where: {
      gtin: cleanGtin,
      supplierVariantId: { startsWith: "stx_" },
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
    stockxRaw = await resolveStockxRawFromKickdbLive(cleanGtin, ctx.slug);
    if (stockxRaw) source = "kickdb-live";
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
