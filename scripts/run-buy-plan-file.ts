/**
 * Run buys from a pre-built JSON plan file (e.g. /tmp/shopify-buy-plan-live.json).
 *
 * Usage:
 *   npx tsx scripts/run-buy-plan-file.ts --plan-file=/tmp/shopify-buy-plan-live.json  # dry-run
 *   npx tsx scripts/run-buy-plan-file.ts --plan-file=/tmp/shopify-buy-plan-live.json --go  # LIVE
 *   npx tsx scripts/run-buy-plan-file.ts --plan-file=/tmp/shopify-buy-plan-live.json --go --orders=7328,7333
 *
 * Force sticky proxy from the start (avoid datacenter CF):
 *   STOCKX_BROWSER_PROXY_MODE=always npx tsx scripts/run-buy-plan-file.ts --plan-file=... --go
 *
 * Plan file JSON schema (array of):
 *   { orderName: string; slug: string; sizeEU: string; lineItemId?: string; ship?: "STANDARD"|"EXPRESS" }
 *
 * Extra fields (sale, day, title, sku, styleId) are ignored — only orderName/slug/sizeEU/lineItemId/ship used.
 */
import "dotenv/config";
import fs from "node:fs/promises";
import { runShopifyBatchBuy } from "@/lib/stockxAutoCheckout/shopifyBatchBuy";
import type { ShopifyBatchBuyItem } from "@/lib/stockxAutoCheckout/shopifyBatchBuy";
import type { StockxDesiredLane } from "@/lib/stockxAutoCheckout/types";
import { prisma } from "@/app/lib/prisma";

function argVal(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(`--${name}=`.length);
}

async function main() {
  const planFile = argVal("plan-file");
  if (!planFile) {
    console.error(
      "usage: run-buy-plan-file.ts --plan-file=<path.json> [--go] [--orders=7328,7333]"
    );
    process.exit(2);
  }

  const args = new Set(process.argv.slice(2));
  const confirmLive = args.has("--go") || args.has("--live");
  const dryRun = !confirmLive;

  const ordersFilter = argVal("orders");
  const wantOrders = ordersFilter
    ? new Set(ordersFilter.split(",").map((s) => s.trim().replace(/^#/, "")).filter(Boolean))
    : null;

  const raw = await fs.readFile(planFile, "utf8");
  const plan: any[] = JSON.parse(raw);
  if (!Array.isArray(plan) || !plan.length) {
    console.error(`[run-buy-plan] plan file empty or not an array: ${planFile}`);
    process.exit(2);
  }

  let items: ShopifyBatchBuyItem[] = plan
    .map((row) => ({
      orderName: String(row.orderName || "").trim(),
      slug: String(row.slug || "").trim(),
      sizeEU: String(row.sizeEU || row.size_eu || "").trim(),
      lineItemId: row.lineItemId ? String(row.lineItemId) : undefined,
      ship: (["STANDARD", "EXPRESS"].includes(String(row.ship || "").toUpperCase())
        ? String(row.ship).toUpperCase()
        : undefined) as StockxDesiredLane | undefined,
    }))
    .filter((i) => i.orderName && i.slug && i.sizeEU);

  if (wantOrders) {
    items = items.filter((i) => wantOrders.has(i.orderName.replace(/^#/, "")));
    if (!items.length) {
      console.error(`[run-buy-plan] --orders filter matched nothing: ${ordersFilter}`);
      process.exit(2);
    }
  }

  console.log(
    `[run-buy-plan] plan=${planFile} items=${items.length} mode=${confirmLive ? "LIVE" : "dry-run"}`
  );
  if (confirmLive) {
    console.warn("[run-buy-plan] LIVE — will Place Order for each item on easy path");
  }

  const summary = await runShopifyBatchBuy({
    items,
    dryRun,
    confirmLive,
  });

  console.log(JSON.stringify(summary, null, 2));

  const bought = summary.bought;
  const total = summary.attempted;
  console.info(
    `\n[run-buy-plan] done: ${bought}/${total} achetés | skipped=${summary.skipped} needsHuman=${summary.needsHuman} aborted=${summary.aborted} bw=${summary.bandwidthMb.toFixed(1)}MB`
  );

  process.exit(summary.aborted > 0 && bought === 0 && summary.needsHuman === 0 ? 2 : 0);
}

main()
  .catch((e) => {
    console.error("[run-buy-plan] fatal:", e?.message || e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect().catch(() => undefined));
