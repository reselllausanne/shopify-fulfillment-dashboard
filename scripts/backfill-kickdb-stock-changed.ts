/**
 * Backfill: queue Shopify-synced products whose KicksDB data moved after their last
 * Shopify push only through skinny (priceOnly) SSE ticks. Before stockChangedAt existed
 * those ticks never reached /api/kickdb/fresh, so sizes sold out on StockX kept their
 * old Website-stock qty and price.
 *
 * Sets KickDBProduct.stockChangedAt = now() on up to --limit products per run; the
 * Shopify consumer (main_from_db.py) then re-syncs them. Run repeatedly until the dry-run
 * count reaches 0, keeping --limit within what the consumer drains between runs.
 *
 * Order: products with an STX size zeroed in the DB after the last push first (those can
 * be bought on the website without a StockX ask), then the most recently changed.
 *
 * Usage:
 *   npx tsx scripts/backfill-kickdb-stock-changed.ts                       # dry-run
 *   npx tsx scripts/backfill-kickdb-stock-changed.ts --write --limit=2000  # apply
 */
import "dotenv/config";
import { prisma } from "../app/lib/prisma";

function argNumber(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  const n = hit ? Number(hit.split("=")[1]) : fallback;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

async function main() {
  const write = process.argv.includes("--write");
  const limit = Math.min(argNumber("limit", 2000), 20000);

  const [summary] = await prisma.$queryRaw<
    Array<{ behind: number; behindWithZeroedSize: number }>
  >`
    WITH behind AS (
      SELECT p."id", s."shopifySyncedAt"
      FROM "public"."ShopifySyncState" s
      JOIN "public"."KickDBProduct" p ON p."kickdbProductId" = s."kickdbProductId"
      WHERE s."syncStatus" = 'synced'
        AND s."shopifySyncedAt" IS NOT NULL
        AND p."rawJson" IS NOT NULL
        AND p."notFound" = false
        AND p."lastFetchedAt" > s."shopifySyncedAt"
        AND p."rawFetchedAt" <= s."shopifySyncedAt"
        AND (p."stockChangedAt" IS NULL OR p."stockChangedAt" <= s."shopifySyncedAt")
    )
    SELECT
      COUNT(*)::int AS "behind",
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1
        FROM "public"."KickDBVariant" kv
        JOIN "public"."VariantMapping" vm ON vm."kickdbVariantId" = kv."id"
        JOIN "public"."SupplierVariant" sv ON sv."supplierVariantId" = vm."supplierVariantId"
        WHERE kv."productId" = behind."id"
          AND sv."supplierVariantId" LIKE 'stx\\_%'
          AND sv."stock" <= 0
          AND sv."updatedAt" > behind."shopifySyncedAt"
      ))::int AS "behindWithZeroedSize"
    FROM behind
  `;
  console.log(
    `[backfill-stock-changed] behind=${summary.behind} with_zeroed_size=${summary.behindWithZeroedSize} limit=${limit} write=${write}`
  );
  if (!write || summary.behind === 0) return;

  // Ordering the whole backlog by EXISTS(zeroed size) exceeds the pooled 2min timeout.
  const picked = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '600s'`);
      return tx.$queryRaw<Array<{ id: string }>>`
    WITH behind AS (
      SELECT p."id", s."shopifySyncedAt", p."lastFetchedAt"
      FROM "public"."ShopifySyncState" s
      JOIN "public"."KickDBProduct" p ON p."kickdbProductId" = s."kickdbProductId"
      WHERE s."syncStatus" = 'synced'
        AND s."shopifySyncedAt" IS NOT NULL
        AND p."rawJson" IS NOT NULL
        AND p."notFound" = false
        AND p."lastFetchedAt" > s."shopifySyncedAt"
        AND p."rawFetchedAt" <= s."shopifySyncedAt"
        AND (p."stockChangedAt" IS NULL OR p."stockChangedAt" <= s."shopifySyncedAt")
    )
    SELECT behind."id"
    FROM behind
    ORDER BY
        EXISTS (
          SELECT 1
          FROM "public"."KickDBVariant" kv
          JOIN "public"."VariantMapping" vm ON vm."kickdbVariantId" = kv."id"
          JOIN "public"."SupplierVariant" sv ON sv."supplierVariantId" = vm."supplierVariantId"
          WHERE kv."productId" = behind."id"
            AND sv."supplierVariantId" LIKE 'stx\\_%'
            AND sv."stock" <= 0
            AND sv."updatedAt" > behind."shopifySyncedAt"
        ) DESC,
        behind."lastFetchedAt" DESC
    LIMIT ${limit}
  `;
    },
    { timeout: 630_000, maxWait: 30_000 }
  );

  // Pick and update in separate statements: one UPDATE ... ORDER BY EXISTS over the
  // whole backlog exceeds the pooler statement timeout.
  let updated = 0;
  const ids = picked.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    updated += await prisma.$executeRaw`
      UPDATE "public"."KickDBProduct"
      SET "stockChangedAt" = NOW()
      WHERE "id" = ANY(${chunk})
    `;
  }
  console.log(`[backfill-stock-changed] queued=${updated}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
