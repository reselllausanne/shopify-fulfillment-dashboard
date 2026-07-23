import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import {
  deriveStockxRawAskFromStoredBuyPrice,
} from "@/galaxus/pricing/suggestedSellPrice";
import { isLiquidationProductTitle } from "@/inventory/pricingPolicy";
import { searchProductVariants } from "@/shopify/catalog/graphql";
import { ONLINE_LOCATION } from "@/shopify/inventory/locationConfig";
import { calcShopifySellPrice } from "@/shopify/pricing/calcShopifySellPrice";
import {
  getInventoryAvailableAtLocation,
  getShopifyVariantDetail,
  type ShopifyVariantDetail,
} from "@/shopify/restock/shopifyRestockInventory";

const VARIANT_PRICE_LOCK_QUERY = /* GraphQL */ `
query RefPriceLock($id: ID!) {
  productVariant(id: $id) {
    id
    metafield(namespace: "custom", key: "price_locked") { value }
  }
}
`;

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function skuSizeSuffix(sku: string): string | null {
  const parts = String(sku).trim().split("-");
  if (parts.length < 2) return null;
  return parts[parts.length - 1] ?? null;
}

function skuStyleBase(sku: string): string | null {
  const parts = String(sku).trim().split("-");
  if (parts.length < 2) return null;
  return parts.slice(0, -1).join("-");
}

/** Storefront sell price on a normal (non-sale) listing. */
export function normalShopifySellPrice(
  detail: Pick<ShopifyVariantDetail, "price" | "compareAtPrice" | "onSale">
): number | null {
  if (
    detail.onSale &&
    detail.compareAtPrice != null &&
    detail.price != null &&
    detail.compareAtPrice > detail.price
  ) {
    return detail.compareAtPrice;
  }
  return detail.price;
}

async function readShopifyPriceLocked(variantId: string): Promise<boolean> {
  const { data, errors } = await shopifyGraphQL<{
    productVariant: { metafield: { value: string | null } | null } | null;
  }>(VARIANT_PRICE_LOCK_QUERY, { id: variantId });
  if (errors?.length) return false;
  return String(data?.productVariant?.metafield?.value ?? "").toLowerCase() === "true";
}

async function resolveProductContextForGtin(gtin: string): Promise<{
  handle: string | null;
  name: string | null;
  brand: string | null;
}> {
  const kv = await prisma.kickDBVariant.findFirst({
    where: { OR: [{ gtin }, { ean: gtin }] },
    select: { product: { select: { urlKey: true, name: true, brand: true } } },
    orderBy: { updatedAt: "desc" },
  });
  if (kv?.product) {
    return {
      handle: kv.product.urlKey ?? null,
      name: kv.product.name ?? null,
      brand: kv.product.brand ?? null,
    };
  }
  return { handle: null, name: null, brand: null };
}

/**
 * Normal website sell price from stored StockX buy (SupplierVariant.price) using
 * the same calc_sell_price model as main.py / Shopify storefront.
 */
export async function resolveWebsiteSellPriceFromStxBuy(gtin: string): Promise<number | null> {
  const stxRow = await prisma.supplierVariant.findFirst({
    where: {
      gtin,
      supplierVariantId: { startsWith: "stx_" },
    },
    select: {
      price: true,
      deliveryType: true,
      supplierProductName: true,
      supplierBrand: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!stxRow) return null;

  const buyPrice = toNumber(stxRow.price);
  if (!buyPrice) return null;

  const { handle, name, brand } = await resolveProductContextForGtin(gtin);
  const stockxRaw = deriveStockxRawAskFromStoredBuyPrice(buyPrice, {
    slug: handle,
    urlKey: handle,
    name: name ?? stxRow.supplierProductName,
  });
  if (stockxRaw == null) return null;

  const isExpress = String(stxRow.deliveryType ?? "").startsWith("express_");
  return calcShopifySellPrice({
    stockxRaw,
    productHandle: handle,
    productName: name ?? stxRow.supplierProductName,
    brand: stxRow.supplierBrand ?? brand,
    isExpress,
  });
}

/**
 * Compare-at anchor = normal website sell (calc_sell_price from StockX buy).
 * Fallback: same-size normal Shopify variant price when STX row missing.
 */
export async function resolveReferenceBuyNowPrice(input: {
  gtin: string;
  variantId?: string | null;
  sku?: string | null;
}): Promise<number | null> {
  const gtin = String(input.gtin ?? "").trim();
  if (!gtin) return null;

  const fromStx = await resolveWebsiteSellPriceFromStxBuy(gtin);
  if (fromStx) return fromStx;

  const sku = String(input.sku ?? "").trim();
  if (sku) {
    const normalSell = await findShopifyNormalSellPriceBySku(sku, input.variantId ?? null);
    if (normalSell) return normalSell;
  }

  if (input.variantId) {
    const detail = await getShopifyVariantDetail(input.variantId);
    if (detail) {
      const locked = await readShopifyPriceLocked(input.variantId);
      if (locked && detail.compareAtPrice != null) {
        return detail.compareAtPrice;
      }
      if (!isLiquidationProductTitle(detail.productTitle)) {
        const sell = normalShopifySellPrice(detail);
        if (sell) return sell;
      }
    }
  }

  return null;
}

async function findShopifyNormalSellPriceBySku(
  sku: string,
  excludeVariantId: string | null
): Promise<number | null> {
  const onlineLocationId = ONLINE_LOCATION?.id;
  const styleBase = skuStyleBase(sku);
  const sizeSuffix = skuSizeSuffix(sku);
  if (!styleBase || !sizeSuffix) return null;

  const escaped = styleBase.replace(/"/g, '\\"');
  const matches = await searchProductVariants(`sku:${escaped}*`, 25);
  let bestScore = -1;
  let bestPrice: number | null = null;

  for (const row of matches) {
    if (excludeVariantId && row.variantId === excludeVariantId) continue;
    const rowSku = String(row.sku ?? "").trim();
    if (!rowSku || skuSizeSuffix(rowSku) !== sizeSuffix) continue;

    const detail = await getShopifyVariantDetail(row.variantId);
    if (!detail) continue;
    if (isLiquidationProductTitle(detail.productTitle)) continue;

    const priceLocked = await readShopifyPriceLocked(row.variantId);
    if (priceLocked) continue;

    const sell = normalShopifySellPrice(detail);
    if (sell == null) continue;

    let onlineQty = 0;
    if (onlineLocationId && row.inventoryItemId) {
      onlineQty =
        (await getInventoryAvailableAtLocation({
          inventoryItemId: row.inventoryItemId,
          locationId: onlineLocationId,
        })) ?? 0;
    }

    const score = sell + (onlineQty > 0 ? 1_000_000 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestPrice = sell;
    }
  }

  return bestPrice;
}
