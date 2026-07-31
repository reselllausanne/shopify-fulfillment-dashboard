import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { deriveStockxRawAskFromStoredBuyPrice } from "@/galaxus/pricing/suggestedSellPrice";
import { calcShopifySellPrice } from "@/shopify/pricing/calcShopifySellPrice";

export const EXPRESS_PRICE_METAFIELD = {
  namespace: "custom",
  key: "express_price",
} as const;

const METAFIELD_SET_MUTATION = /* GraphQL */ `
mutation SetExpressPrice($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    userErrors { field message }
  }
}
`;

const VARIANT_EXPRESS_PRICE_QUERY = /* GraphQL */ `
query ReadExpressPrice($id: ID!) {
  productVariant(id: $id) {
    id
    metafield(namespace: "custom", key: "express_price") { value }
  }
}
`;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Flat surcharge on liquidation sell for express delivery option (default 20 CHF). */
export function readLiquidationExpressSurchargeChf(): number {
  const raw =
    process.env.LIQUIDATION_EXPRESS_SURCHARGE_CHF ??
    process.env.SHOPIFY_LIQUIDATION_EXPRESS_SURCHARGE_CHF ??
    "20";
  const n = Number.parseFloat(String(raw));
  if (!Number.isFinite(n) || n < 0) return 20;
  return n;
}

/** Warehouse liquidation express option = liquidation price + fixed surcharge. */
export function calcLiquidationExpressSellPrice(liquidationPriceChf: number): number | null {
  if (!Number.isFinite(liquidationPriceChf) || liquidationPriceChf <= 0) return null;
  return round2(liquidationPriceChf + readLiquidationExpressSurchargeChf());
}

export function parseExpressPriceMetafieldAmount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const cents = Number(trimmed);
    if (Number.isFinite(cents) && cents > 0) return round2(cents / 100);
  }

  try {
    const parsed = JSON.parse(trimmed) as { amount?: string | number } | number;
    if (typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0) {
      return round2(parsed / 100);
    }
    const amount = parsed && typeof parsed === "object" ? parsed.amount : null;
    if (amount == null || amount === "") return null;
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? round2(n) : null;
  } catch {
    const n = Number(trimmed);
    return Number.isFinite(n) && n > 0 ? round2(n) : null;
  }
}

export async function readShopifyExpressPriceMetafield(variantId: string): Promise<number | null> {
  const { data, errors } = await shopifyGraphQL<{
    productVariant: { metafield: { value: string | null } | null } | null;
  }>(VARIANT_EXPRESS_PRICE_QUERY, { id: variantId });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  return parseExpressPriceMetafieldAmount(data?.productVariant?.metafield?.value);
}

export async function writeShopifyExpressPriceMetafield(
  variantId: string,
  priceChf: number
): Promise<void> {
  const expressValue = JSON.stringify({
    amount: priceChf.toFixed(2),
    currency_code: "CHF",
  });
  const { errors, data } = await shopifyGraphQL<{
    metafieldsSet: { userErrors: Array<{ message: string }> };
  }>(METAFIELD_SET_MUTATION, {
    metafields: [
      {
        ownerId: variantId,
        namespace: EXPRESS_PRICE_METAFIELD.namespace,
        key: EXPRESS_PRICE_METAFIELD.key,
        type: "money",
        value: expressValue,
      },
    ],
  });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.metafieldsSet?.userErrors ?? [];
  if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
}

export type SyncLiquidationExpressPriceResult = {
  expressPrice: number;
  changed: boolean;
};

/**
 * Physical warehouse liquidation: express checkout option = liquidation + surcharge.
 * Standard option stays at variant.price (liquidation sell).
 */
export async function syncLiquidationExpressPriceMetafield(input: {
  variantId: string;
  liquidationPriceChf: number;
}): Promise<SyncLiquidationExpressPriceResult> {
  const expressPrice = calcLiquidationExpressSellPrice(input.liquidationPriceChf);
  if (expressPrice == null) {
    throw new Error("invalid liquidation price for express metafield");
  }

  const current = await readShopifyExpressPriceMetafield(input.variantId);
  const changed = current == null || Math.abs(current - expressPrice) > 0.005;
  if (changed) {
    await writeShopifyExpressPriceMetafield(input.variantId, expressPrice);
  }

  return { expressPrice, changed };
}

async function resolveProductHandle(gtin: string): Promise<string | null> {
  const kv = await prisma.kickDBVariant.findFirst({
    where: { OR: [{ gtin }, { ean: gtin }] },
    select: { product: { select: { urlKey: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return kv?.product?.urlKey ?? null;
}

/** Dropship express metafield from STX express lane (same formula as syncShopifyStxPrices). */
export async function resolveStxExpressSellPriceChf(gtin: string): Promise<number | null> {
  const cleanGtin = String(gtin ?? "").trim();
  if (!cleanGtin) return null;

  const stxRow = await prisma.supplierVariant.findFirst({
    where: {
      gtin: cleanGtin,
      supplierVariantId: { startsWith: "stx_" },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      deliveryType: true,
      price: true,
      expressBuyPrice: true,
      supplierProductName: true,
      supplierBrand: true,
    },
  });
  if (!stxRow) return null;

  const expressBuy =
    toNumber(stxRow.expressBuyPrice) ??
    (String(stxRow.deliveryType ?? "").startsWith("express_") ? toNumber(stxRow.price) : null);
  if (expressBuy == null) return null;

  const productHandle = await resolveProductHandle(cleanGtin);
  const stockxRaw = deriveStockxRawAskFromStoredBuyPrice(expressBuy, {
    slug: productHandle,
    urlKey: productHandle,
    name: stxRow.supplierProductName,
  });
  if (stockxRaw == null) return null;

  return calcShopifySellPrice({
    stockxRaw,
    productHandle,
    productName: stxRow.supplierProductName,
    brand: stxRow.supplierBrand,
    isExpress: true,
  });
}

export type RestoreStxExpressPriceResult = {
  expressPrice: number | null;
  changed: boolean;
};

/** Revert express metafield to STX dropship express after liquidation exit. */
export async function restoreStxExpressPriceMetafield(input: {
  gtin: string;
  variantId: string;
}): Promise<RestoreStxExpressPriceResult> {
  const expressPrice = await resolveStxExpressSellPriceChf(input.gtin);
  if (expressPrice == null) {
    return { expressPrice: null, changed: false };
  }

  const current = await readShopifyExpressPriceMetafield(input.variantId);
  const changed = current == null || Math.abs(current - expressPrice) > 0.005;
  if (changed) {
    await writeShopifyExpressPriceMetafield(input.variantId, expressPrice);
  }

  return { expressPrice, changed };
}
