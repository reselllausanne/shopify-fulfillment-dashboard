/**
 * Link an already-bought StockX order to its Shopify order (reusable ops primitive).
 *
 * Wraps linkStockxBuyToShopify (lib/stockxAutoCheckout/linkAfterBuy.ts). Resolves the
 * Shopify ids/title/sku/size/sale from the order itself via loadShopifyLine, so the only
 * things you must supply are the Shopify order, the StockX order number (03-…), the
 * supplier cost (all-in CHF actually paid) and the lane.
 *
 * Use when a buy succeeded on StockX but the automatic post-buy link did not run
 * (e.g. bot_fail "Paid but no StockX order number parsed"), or to manually link a buy.
 *
 * Linking is idempotent (OrderMatch upsert on shopifyLineItemId) and sends NO customer
 * email — the shipped email is triggered later by AWB fulfillment.
 *
 * Usage:
 *   npx tsx scripts/stockx-link-order.ts --order=7562 --stockx=03-3BDJAN2XVE --cost=149.41 --lane=EXPRESS
 *   npx tsx scripts/stockx-link-order.ts --order=7550 --stockx=03-BEHCF90BLD --cost=205.96 --lane=STANDARD
 *   # optional overrides when loadShopifyLine can't resolve a field:
 *   #   --lineItem=gid://shopify/LineItem/... --title='…' --sku='…' --sizeEU='EU 38' --sale=263
 */
import "dotenv/config";
import { loadShopifyLine } from "@/lib/stockxCheckout";
import { linkStockxBuyToShopify } from "@/lib/stockxAutoCheckout/linkAfterBuy";
import type { StockxDesiredLane } from "@/lib/stockxAutoCheckout/types";

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(`--${name}=`.length);
}

async function main() {
  const orderArg = arg("order");
  const stockxOrderNumber = (arg("stockx") || "").trim();
  const costArg = arg("cost");
  const laneArg = (arg("lane") || "").toUpperCase();

  if (!orderArg || !stockxOrderNumber || costArg == null || costArg === "") {
    console.error(
      "usage: stockx-link-order.ts --order=7562 --stockx=03-… --cost=149.41 --lane=EXPRESS\n" +
        "       [--lineItem=gid://…] [--title='…'] [--sku='…'] [--sizeEU='EU 38'] [--sale=263]"
    );
    process.exit(2);
  }

  const orderName = orderArg.startsWith("#") ? orderArg : `#${orderArg}`;
  const supplierCost = Number(costArg);
  if (!Number.isFinite(supplierCost) || supplierCost <= 0) {
    console.error(`[link-order] invalid --cost=${costArg}`);
    process.exit(2);
  }
  const desiredLane: StockxDesiredLane = laneArg === "EXPRESS" ? "EXPRESS" : "STANDARD";

  const lineItemOverride = arg("lineItem");
  const line = await loadShopifyLine(orderName, lineItemOverride ?? null);

  const shopifyOrderId = line.shopifyOrderId || "";
  const shopifyLineItemId = lineItemOverride || line.shopifyLineItemId || "";
  const title = arg("title") ?? line.title;
  const sku = arg("sku") ?? line.sku;
  const sizeEU = arg("sizeEU") ?? line.sizeEU;
  const saleArg = arg("sale");
  const saleChf = saleArg != null && saleArg !== "" ? Number(saleArg) : line.saleChf;

  if (!shopifyOrderId || !shopifyLineItemId) {
    console.error(
      `[link-order] could not resolve Shopify ids (orderId=${shopifyOrderId || "?"} lineItem=${
        shopifyLineItemId || "?"
      }). Pass --lineItem=… explicitly.`
    );
    process.exit(2);
  }

  console.log("[link-order] linking:");
  console.table([
    {
      order: orderName,
      stockx: stockxOrderNumber,
      lane: desiredLane,
      cost: supplierCost,
      sale: saleChf,
      sku,
      sizeEU,
      title,
    },
  ]);

  const result = await linkStockxBuyToShopify({
    shopifyOrderId,
    shopifyOrderName: orderName,
    shopifyLineItemId,
    shopifyCreatedAt: line.createdAt,
    shopifyProductTitle: title,
    shopifySku: sku || null,
    shopifySizeEU: sizeEU || null,
    shopifyTotalPrice: Number(saleChf) || 0,
    shopifyCurrencyCode: "CHF",
    shopifyCustomerEmail: line.customerEmail ?? null,
    shopifyCustomerFirstName: line.customerFirstName ?? null,
    shopifyCustomerLastName: line.customerLastName ?? null,
    stockxOrderNumber,
    stockxProductName: title,
    stockxSizeEU: sizeEU || null,
    stockxSkuKey: sku || null,
    supplierCost,
    desiredLane,
  });

  console.log("[link-order] result:", JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[link-order] fatal", e);
    process.exit(1);
  });
