/**
 * Buy ONE Shopify order on StockX end-to-end (Phase 2 primitive).
 *
 * Wires the DB-only pre-check (availability/price/margin/lane, zero StockX network)
 * into the lean bandwidth-guarded checkout. Resolves the StockX slug + size + lane
 * from the order itself, then buys on the lane the CUSTOMER chose (Express/Standard).
 *
 * Usage:
 *   npx tsx scripts/stockx-buy-order.ts --order=7562           # dry-run (no buy)
 *   npx tsx scripts/stockx-buy-order.ts --order=7562 --go      # LIVE Place Order
 *   npx tsx scripts/stockx-buy-order.ts --order=7562 --force   # buy even if precheck not "buyable"
 *   npx tsx scripts/stockx-buy-order.ts --order=7562 --lane=EXPRESS  # force a lane
 *
 * Read-only until --go. Prints the resolved plan (slug/size/lane/price/margin) first.
 */
import "dotenv/config";
import { loadShopifyLine } from "@/lib/stockxCheckout";
import {
  precheckStockxBuyability,
  resolveSlugFromStyleId,
} from "@/lib/stockxAutoCheckout/precheckAvailability";
import { styleIdFromSku } from "@/lib/stockxAutoCheckout/prebuyDedupe";
import {
  desiredStockxLaneFromShopify,
  detectShopifyExpress,
} from "@/lib/stockxAutoCheckout/detectShopifyExpress";
import { runShopifyBatchBuy } from "@/lib/stockxAutoCheckout/shopifyBatchBuy";
import type { StockxDesiredLane } from "@/lib/stockxAutoCheckout/types";

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(`--${name}=`.length);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const orderArg = arg("order");
  if (!orderArg) {
    console.error("usage: stockx-buy-order.ts --order=7562 [--go] [--force] [--lane=EXPRESS]");
    process.exit(2);
  }
  const orderName = orderArg.startsWith("#") ? orderArg : `#${orderArg}`;
  const confirmLive = args.has("--go") || args.has("--live");
  const force = args.has("--force");
  const laneOverride = arg("lane")?.toUpperCase() as StockxDesiredLane | undefined;

  const line = await loadShopifyLine(orderName);
  const express = detectShopifyExpress({
    deliveryMode: line.deliveryMode,
    deliveryModeLabel: line.deliveryModeLabel,
    shippingLineTitles: line.shippingLineTitles,
  });
  const lane: StockxDesiredLane = laneOverride ?? desiredStockxLaneFromShopify(express);

  const precheck = await precheckStockxBuyability({ line, desiredLane: lane });
  const styleId = styleIdFromSku(line.sku);
  const slug = styleId ? await resolveSlugFromStyleId(styleId) : null;

  console.log("[buy-order] plan:");
  console.table([
    {
      order: orderName,
      title: line.title?.slice(0, 40),
      size: line.sizeEU,
      lane,
      customerExpress: express,
      sell: line.saleChf,
      expectedBuy: precheck.expectedBuyChf,
      margin: precheck.marginPct == null ? null : `${(precheck.marginPct * 100).toFixed(1)}%`,
      status: precheck.status,
      slug: slug ?? "(unresolved)",
    },
  ]);

  if (precheck.status !== "buyable" && !force) {
    console.error(
      `[buy-order] precheck=${precheck.status} (${precheck.detail}) — not buyable; pass --force to override`
    );
    process.exit(3);
  }
  if (!slug) {
    console.error(`[buy-order] no StockX slug for sku=${line.sku} (styleId=${styleId}) — abort`);
    process.exit(4);
  }

  if (!confirmLive) {
    console.log("[buy-order] dry-run (pass --go for a live Place Order)");
  } else {
    console.warn(`[buy-order] LIVE — will Place Order on ${orderName} (${lane})`);
  }

  const summary = await runShopifyBatchBuy({
    items: [
      {
        orderName,
        slug,
        sizeEU: line.sizeEU,
        lineItemId: line.shopifyLineItemId,
        ship: lane,
      },
    ],
    dryRun: !confirmLive,
    confirmLive,
  });

  console.log(JSON.stringify(summary, null, 2));
  const ok = summary.bought > 0 || (summary.dryRun && summary.aborted === 0);
  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
