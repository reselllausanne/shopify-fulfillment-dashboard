import { prisma } from "@/app/lib/prisma";
import { toShopifyCreatedAtStorage } from "@/app/utils/shopifySellDate";
import type { StockxDesiredLane } from "@/lib/stockxAutoCheckout/types";
import { enrichOrderMatchFromStockxOrderNumber } from "@/lib/stockxAutoCheckout/enrichAfterLink";
import {
  markOrderMatchMetafieldsSynced,
  setSupplierOrderMetafields,
} from "@/shopify/orders/setSupplierMetafields";

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
  shopifyCustomerFirstName?: string | null;
  shopifyCustomerLastName?: string | null;
  stockxOrderNumber: string;
  stockxProductName?: string | null;
  stockxSizeEU?: string | null;
  stockxSkuKey?: string | null;
  supplierCost: number;
  desiredLane: StockxDesiredLane;
  /** StockX checkoutType string when known (STANDARD / EXPRESS). */
  stockxCheckoutType?: string | null;
  estimatedDelivery?: string | Date | null;
};

/**
 * Intentional post-buy link (same as manual #7541 flow): OrderMatch upsert + supplier.order_number metafield.
 * No fuzzy matching — caller must pass exact StockX order number from confirmation.
 */
export async function linkStockxBuyToShopify(input: LinkAfterBuyInput): Promise<{
  ok: boolean;
  orderMatchId: string | null;
  metafieldsOk: boolean;
  enrichOk: boolean;
  enrichReason: string | null;
  error: string | null;
}> {
  const stockxOrderNumber = String(input.stockxOrderNumber || "").trim();
  const shopifyLineItemId = String(input.shopifyLineItemId || "").trim();
  const shopifyOrderId = String(input.shopifyOrderId || "").trim();
  if (!stockxOrderNumber || !shopifyLineItemId || !shopifyOrderId) {
    return {
      ok: false,
      orderMatchId: null,
      metafieldsOk: false,
      enrichOk: false,
      enrichReason: null,
      error: "Missing ids",
    };
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
      enrichOk: false,
      enrichReason: null,
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
      shopifyCustomerFirstName: input.shopifyCustomerFirstName ?? null,
      shopifyCustomerLastName: input.shopifyCustomerLastName ?? null,
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
      // Only set when provided — never wipe an existing email with null.
      ...(input.shopifyCustomerEmail
        ? { shopifyCustomerEmail: input.shopifyCustomerEmail }
        : {}),
      ...(input.shopifyCustomerFirstName
        ? { shopifyCustomerFirstName: input.shopifyCustomerFirstName }
        : {}),
      ...(input.shopifyCustomerLastName
        ? { shopifyCustomerLastName: input.shopifyCustomerLastName }
        : {}),
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
    const meta = await setSupplierOrderMetafields({
      shopifyOrderId,
      stockxOrderNumber,
      stockxStatus: "ORDERED",
      estimatedDelivery: input.estimatedDelivery ?? null,
      supplierCost: cost,
      marginAmount,
      marginPercent: Number(marginPercent.toFixed(2)),
      skipDuplicateCheck: true,
    });
    metafieldsOk = meta.ok;
    if (metafieldsOk) {
      await markOrderMatchMetafieldsSynced(match.id);
    } else if (meta.error) {
      console.error("[STOCKX-AUTO] set metafields failed:", meta.error);
    }
  } catch (e) {
    console.error("[STOCKX-AUTO] set metafields failed", e);
    metafieldsOk = false;
  }

  // Best-effort: resolve chainId/orderId/states from StockX buying list by 03-…
  // so AWB cron can track. No customer email here (emailedAt gate on milestones).
  let enrichOk = false;
  let enrichReason: string | null = null;
  try {
    const enriched = await enrichOrderMatchFromStockxOrderNumber({
      orderMatchId: match.id,
      stockxOrderNumber,
    });
    enrichOk = enriched.ok;
    enrichReason = enriched.reason;
    if (!enriched.ok) {
      console.warn(
        `[STOCKX-AUTO] enrich after link failed for ${stockxOrderNumber}:`,
        enriched.reason
      );
    }
  } catch (e: any) {
    enrichReason = e?.message || "enrich_threw";
    console.error("[STOCKX-AUTO] enrich after link threw", e);
  }

  return {
    ok: true,
    orderMatchId: match.id,
    metafieldsOk,
    enrichOk,
    enrichReason,
    error: null,
  };
}
