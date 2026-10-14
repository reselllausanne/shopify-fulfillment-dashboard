/**
 * Align Shopify "Website stock" with live StockX asks, both directions
 * (zero sold-out sizes, set offered sizes back to 1). Logic:
 * `shopify/stx/stxStockReconcile.ts` + `shopify/stx/stxStockShopify.ts`.
 *
 * Dry-run by default.
 *   npx tsx scripts/reconcile-shopify-stx-stock.ts --limit=200
 *   npx tsx scripts/reconcile-shopify-stx-stock.ts --apply --shards=4 --shard=0
 */
import "dotenv/config";

import { prisma } from "@/app/lib/prisma";
import { formatShopifyApiMetricsLine } from "@/lib/shopifyAdmin";
import { reconcileShopifyStxStock } from "@/shopify/stx/stxStockReconcile";

function num(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const n = Number(raw);
  return raw !== undefined && Number.isFinite(n) && n >= 0 ? n : fallback;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const shards = Math.max(1, Math.floor(num("shards", 1)));
  const shard = Math.floor(num("shard", 0));
  console.log(`${apply ? "APPLY" : "DRY-RUN"} | shard ${shard}/${shards}`);
  const { examples, ...counts } = await reconcileShopifyStxStock({
    apply,
    shards,
    shard,
    limit: num("limit", Number.POSITIVE_INFINITY),
    progressEvery: Math.max(1, Math.floor(num("progress-every", 500))),
    batchSize: Math.max(1, Math.floor(num("batch-size", 200))),
  });
  console.log(`\nEXAMPLES:\n  ${examples.join("\n  ")}`);
  console.log(`\nRESUME shard ${shard}/${shards} ${apply ? "" : "(dry-run: would change)"}:`, counts);
  console.log(formatShopifyApiMetricsLine("SHOPIFY_API][stock"));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
