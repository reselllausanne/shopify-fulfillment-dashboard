/**
 * Backlog: zero Shopify "Website stock" for StockX sizes sold out live.
 * Rules live in `shopify/stx/zeroSoldoutShopify.ts` (live KicksDB re-check per
 * product, 0 asks required, physical locations untouched).
 *
 * Candidates: Shopify products with an STX DB row at stock 0 changed after the
 * last Shopify sync (`--all-zero`: any STX row at stock 0).
 *
 * Dry-run by default.
 *   npx tsx scripts/zero-shopify-stx-soldout.ts --limit=200
 *   npx tsx scripts/zero-shopify-stx-soldout.ts --apply --shards=4 --shard=0 --limit=100000
 */
import "dotenv/config";

import { prisma } from "@/app/lib/prisma";
import { fetchStockxProductByIdOrSlugRaw } from "@/galaxus/kickdb/client";
import { kickdbStockxFetchId } from "@/galaxus/jobs/stxSync";
import { ONLINE_LOCATION } from "@/shopify/inventory/locationConfig";
import { emptyZeroSoldoutStats, zeroShopifySoldoutForProduct } from "@/shopify/stx/zeroSoldoutShopify";

function num(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const APPLY = process.argv.includes("--apply");
const ALL_ZERO = process.argv.includes("--all-zero");
const LIMIT = Math.max(1, Math.floor(num("limit", 200)));
const SHARDS = Math.max(1, Math.floor(num("shards", 1)));
const SHARD = Math.min(SHARDS - 1, Math.floor(num("shard", 0)));
const PROGRESS_EVERY = Math.max(1, Math.floor(num("progress-every", 100)));

async function main() {
  console.log(
    `${APPLY ? "APPLY" : "DRY-RUN"} | shard ${SHARD}/${SHARDS} | location=${ONLINE_LOCATION.id} | all-zero=${ALL_ZERO} | limit=${LIMIT}`
  );

  const shardClause =
    SHARDS > 1 ? `AND (abs(hashtextextended(sss."shopifyProductId", 0)) % ${SHARDS}) = ${SHARD}` : "";
  const freshClause = ALL_ZERO ? "" : `AND sv."updatedAt" > sss."shopifySyncedAt"`;

  const products = await prisma.$queryRawUnsafe<
    Array<{ kickdbProductId: string; urlKey: string | null; shopifyProductId: string }>
  >(`
    SELECT DISTINCT p."kickdbProductId", p."urlKey", sss."shopifyProductId"
    FROM "SupplierVariant" sv
    JOIN "VariantMapping" vm ON vm."supplierVariantId" = sv."supplierVariantId"
    JOIN "KickDBVariant" kv ON kv.id = vm."kickdbVariantId"
    JOIN "KickDBProduct" p ON p.id = kv."productId"
    JOIN "ShopifySyncState" sss ON sss."kickdbProductId" = p."kickdbProductId"
    WHERE sv."supplierVariantId" LIKE 'stx_%'
      AND sv.stock = 0
      AND sss."syncStatus" = 'synced'
      AND sss."shopifyProductId" IS NOT NULL
      ${freshClause}
      ${shardClause}
    ORDER BY sss."shopifyProductId"
    LIMIT ${LIMIT}
  `);
  console.log(`Products: ${products.length}`);

  const stats = emptyZeroSoldoutStats();
  let done = 0;
  let kicksFail = 0;
  let shopifyFail = 0;

  for (const p of products) {
    done += 1;
    if (done % PROGRESS_EVERY === 0) {
      const { examples: _examples, ...counts } = stats;
      console.log(`  progress ${done}/${products.length}`, { ...counts, kicksFail, shopifyFail });
    }
    let payload: unknown;
    try {
      payload = (await fetchStockxProductByIdOrSlugRaw(kickdbStockxFetchId(p))).product;
    } catch (err) {
      kicksFail += 1;
      console.error(`  kicks ${p.urlKey ?? p.kickdbProductId}:`, err instanceof Error ? err.message.slice(0, 160) : err);
      continue;
    }
    try {
      await zeroShopifySoldoutForProduct({ shopifyProductId: p.shopifyProductId, payload, apply: APPLY, stats });
    } catch (err) {
      shopifyFail += 1;
      console.error(`  shopify ${p.shopifyProductId}:`, err instanceof Error ? err.message : err);
    }
  }

  const { examples, ...counts } = stats;
  console.log(`\nEXAMPLES:\n  ${examples.join("\n  ")}`);
  console.log(
    `\nRESUME shard ${SHARD}/${SHARDS} ${APPLY ? "" : "(dry-run, zeroed = would zero)"}:`,
    { products: done, ...counts, kicksFail, shopifyFail }
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
