import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { toShopifyCreatedAtStorage } from "@/app/utils/shopifySellDate";
import type { StockxDesiredLane } from "@/lib/stockxAutoCheckout/types";

const METAFIELDS_MUTATION = /* GraphQL */ `
mutation SetOrderMetafields($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key type value }
    userErrors { field message }
  }
}
`;

export type LinkAfterBuyInput = {
  shopifyOrderId: string;
  shopifyOrderName: string;
  shopifyLineItemId: string;
  shopifyCreatedAt?: string | null;
  shopifyProductTitle: string;
  shopifySku: string | null;
  shopifySizeEU: string | null;
  shopifyTotalPrice: number;
  shopifyCurrencyCode?: string;
  shopifyCustomerEmail?: string | null;
  stockxOrderNumber: string;
  stockxProductName?: string | null;
  stockxSizeEU?: string | null;
  stockxSkuKey?: string | null;
  supplierCost: number;
  desiredLane: StockxDesiredLane;
  /** StockX checkoutType string when known (STANDARD / EXPRESS). */
  stockxCheckoutType?: string | null;
};

/**
 * Intentional post-buy link (same as manual #7541 flow): OrderMatch upsert + supplier.order_number metafield.
 * No fuzzy matching — caller must pass exact StockX order number from confirmation.
 */
export async function linkStockxBuyToShopify(input: LinkAfterBuyInput): Promise<{
  ok: boolean;
  orderMatchId: string | null;
  metafieldsOk: boolean;
  error: string | null;
}> {
  const stockxOrderNumber = String(input.stockxOrderNumber || "").trim();
  const shopifyLineItemId = String(input.shopifyLineItemId || "").trim();
  const shopifyOrderId = String(input.shopifyOrderId || "").trim();
  if (!stockxOrderNumber || !shopifyLineItemId || !shopifyOrderId) {
    return { ok: false, orderMatchId: null, metafieldsOk: false, error: "Missing ids" };
  }

  const sale = Number(input.shopifyTotalPrice) || 0;
  const cost = Number(input.supplierCost) || 0;
  const marginAmount = sale - cost;
  const marginPercent = sale > 0 ? (marginAmount / sale) * 100 : 0;
  const checkoutType =
    input.stockxCheckoutType ||
    (input.desiredLane === "EXPRESS" ? "EXPRESS" : "STANDARD");

  const existingOther = await prisma.orderMatch.findFirst({
    where: {
      stockxOrderNumber,
      NOT: { shopifyLineItemId },
    },
    select: { shopifyOrderName: true, shopifyLineItemId: true },
  });
  if (existingOther) {
    return {
      ok: false,
      orderMatchId: null,
      metafieldsOk: false,
      error: `StockX ${stockxOrderNumber} already linked to ${existingOther.shopifyOrderName}`,
    };
  }

  const parsedCreated = input.shopifyCreatedAt ? new Date(input.shopifyCreatedAt) : null;
  const shopifyCreatedAt =
    parsedCreated && !Number.isNaN(parsedCreated.getTime())
      ? toShopifyCreatedAtStorage(parsedCreated)
      : null;

  const match = await prisma.orderMatch.upsert({
    where: { shopifyLineItemId },
    create: {
      shopifyOrderId,
      shopifyOrderName: input.shopifyOrderName,
      shopifyLineItemId,
      shopifyProductTitle: input.shopifyProductTitle,
      shopifySku: input.shopifySku,
      shopifySizeEU: input.shopifySizeEU,
      shopifyTotalPrice: sale,
      shopifyCurrencyCode: input.shopifyCurrencyCode || "CHF",
      shopifyCreatedAt,
      shopifyCustomerEmail: input.shopifyCustomerEmail ?? null,
      supplierSource: "STOCKX",
      stockxOrderNumber,
      stockxProductName: input.stockxProductName || input.shopifyProductTitle,
      stockxSizeEU: input.stockxSizeEU || input.shopifySizeEU,
      stockxSkuKey: input.stockxSkuKey || input.shopifySku,
      stockxPurchaseDate: new Date(),
      matchConfidence: "auto_checkout",
      matchScore: 100,
      matchType: "STOCKX_AUTO_CHECKOUT",
      matchReasons: JSON.stringify(["stockx_auto_checkout", `lane:${input.desiredLane}`]),
      stockxStatus: "ORDERED",
      stockxCheckoutType: checkoutType,
      supplierCost: cost,
      marginAmount,
      marginPercent,
      shopifyMetafieldsSynced: false,
    },
    update: {
      shopifyOrderId,
      shopifyOrderName: input.shopifyOrderName,
      shopifyProductTitle: input.shopifyProductTitle,
      shopifySku: input.shopifySku,
      shopifySizeEU: input.shopifySizeEU,
      shopifyTotalPrice: sale,
      stockxOrderNumber,
      stockxProductName: input.stockxProductName || input.shopifyProductTitle,
      stockxSizeEU: input.stockxSizeEU || input.shopifySizeEU,
      stockxSkuKey: input.stockxSkuKey || input.shopifySku,
      stockxPurchaseDate: new Date(),
      matchConfidence: "auto_checkout",
      matchScore: 100,
      matchType: "STOCKX_AUTO_CHECKOUT",
      matchReasons: JSON.stringify(["stockx_auto_checkout", `lane:${input.desiredLane}`]),
      stockxStatus: "ORDERED",
      stockxCheckoutType: checkoutType,
      supplierCost: cost,
      marginAmount,
      marginPercent,
      supplierSource: "STOCKX",
    },
    select: { id: true },
  });

  let metafieldsOk = false;
  try {
    const metafields = [
      {
        ownerId: shopifyOrderId,
        namespace: "supplier",
        key: "order_number",
        type: "single_line_text_field",
        value: stockxOrderNumber,
      },
      {
        ownerId: shopifyOrderId,
        namespace: "supplier",
        key: "status",
        type: "single_line_text_field",
        value: "ORDERED",
      },
      {
        ownerId: shopifyOrderId,
        namespace: "supplier",
        key: "total_cost",
        type: "number_decimal",
        value: String(cost),
      },
      {
        ownerId: shopifyOrderId,
        namespace: "supplier",
        key: "margin_amount",
        type: "number_decimal",
        value: String(marginAmount),
      },
      {
        ownerId: shopifyOrderId,
        namespace: "supplier",
        key: "margin_percent",
        type: "number_decimal",
        value: String(Number(marginPercent.toFixed(2))),
      },
    ];
    const { data, errors } = await shopifyGraphQL<{
      metafieldsSet: {
        metafields: unknown[];
        userErrors: { message: string }[];
      };
    }>(METAFIELDS_MUTATION, { metafields });
    const userErrors = data?.metafieldsSet?.userErrors ?? [];
    metafieldsOk = !errors?.length && userErrors.length === 0;
    if (metafieldsOk) {
      await prisma.orderMatch.update({
        where: { id: match.id },
        data: { shopifyMetafieldsSynced: true, shopifyMetafieldsSetAt: new Date() },
      });
    }
  } catch (e) {
    console.error("[STOCKX-AUTO] set metafields failed", e);
    metafieldsOk = false;
  }

  return { ok: true, orderMatchId: match.id, metafieldsOk, error: null };
}
