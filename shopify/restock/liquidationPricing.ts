import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { resolvePhysicalRestockPricing } from "@/shopify/restock/physicalRestockPricing";
import {
  applyVariantSalePrice,
  getShopifyVariantDetail,
  type ShopifyVariantDetail,
} from "@/shopify/restock/shopifyRestockInventory";

const METAFIELD_SET_MUTATION = /* GraphQL */ `
mutation LiqSetMetafield($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    userErrors { field message }
  }
}
`;

const VARIANT_PRICE_LOCK_QUERY = /* GraphQL */ `
query LiqPriceLock($id: ID!) {
  productVariant(id: $id) {
    id
    metafield(namespace: "custom", key: "price_locked") { value }
  }
}
`;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function readShopifyPriceLocked(variantId: string): Promise<boolean> {
  const { data, errors } = await shopifyGraphQL<{
    productVariant: { metafield: { value: string | null } | null } | null;
  }>(VARIANT_PRICE_LOCK_QUERY, { id: variantId });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  return String(data?.productVariant?.metafield?.value ?? "").toLowerCase() === "true";
}

async function writeShopifyPriceLocked(variantId: string, locked: boolean): Promise<void> {
  const { errors, data } = await shopifyGraphQL<{
    metafieldsSet: { userErrors: Array<{ message: string }> };
  }>(METAFIELD_SET_MUTATION, {
    metafields: [
      {
        ownerId: variantId,
        namespace: "custom",
        key: "price_locked",
        type: "boolean",
        value: locked ? "true" : "false",
      },
    ],
  });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.metafieldsSet?.userErrors ?? [];
  if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
}

/**
 * Physical stock restock → storefront sale badge:
 * compareAt = calcShopifySellPrice(stockx raw) — normal website listing.
 * price = calc_touch_price(stockx raw) − 30% (liquidation).
 */
export async function applyLiquidationSaleDisplay(input: {
  gtin: string;
  variant: Pick<ShopifyVariantDetail, "variantId" | "productId" | "sku" | "price" | "compareAtPrice">;
  /** Override reference anchor (CHF). When omitted, resolved automatically. */
  referencePrice?: number | null;
}): Promise<{
  applied: boolean;
  referencePrice: number | null;
  salePrice: number | null;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const pricing = await resolvePhysicalRestockPricing(input.gtin);
  const reference = pricing.compareAt;
  const salePrice = pricing.sellPrice;

  if (!reference || reference <= 0 || !salePrice || salePrice <= 0) {
    warnings.push(
      `No StockX pricing (${pricing.source}) — compare-at sale not applied`
    );
    return { applied: false, referencePrice: reference, salePrice: null, warnings };
  }

  if (salePrice >= reference) {
    warnings.push("Liquidation sell >= compareAt — sale not applied");
    return { applied: false, referencePrice: reference, salePrice: null, warnings };
  }

  await applyVariantSalePrice({
    productId: input.variant.productId,
    variantId: input.variant.variantId,
    salePrice,
    compareAtPrice: reference,
  });

  try {
    const locked = await readShopifyPriceLocked(input.variant.variantId);
    if (!locked) {
      await writeShopifyPriceLocked(input.variant.variantId, true);
    }
  } catch (err: any) {
    warnings.push(`price_locked metafield failed: ${err?.message ?? err}`);
  }

  // DB manual lock for marketplace export resolver.
  try {
    const stxRow = await prisma.supplierVariant.findFirst({
      where: {
        gtin: input.gtin,
        supplierVariantId: { startsWith: "stx_" },
      },
      select: { id: true, manualLock: true, manualPrice: true },
    });
    if (stxRow) {
      const needUpdate =
        !stxRow.manualLock ||
        Number(stxRow.manualPrice ?? 0) !== salePrice;
      if (needUpdate) {
        await prisma.supplierVariant.update({
          where: { id: stxRow.id },
          data: {
            manualLock: true,
            manualPrice: salePrice,
            manualStock: null,
            manualUpdatedAt: new Date(),
            manualNote: `restock:liquidation compareAt=${reference.toFixed(2)}`,
          },
        });
      }
    }
  } catch (err: any) {
    warnings.push(`DB manualPrice lock skipped: ${err?.message ?? err}`);
  }

  return { applied: true, referencePrice: reference, salePrice, warnings };
}

/** Refresh variant detail after pricing writes. */
export async function refreshVariantDetail(variantId: string) {
  return getShopifyVariantDetail(variantId);
}
