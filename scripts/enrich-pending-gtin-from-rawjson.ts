/**
 * Re-run KickDB enrichment for STX PENDING_GTIN rows where the product's
 * rawJson already has non-empty identifiers (UPC/EAN) cached. No live API
 * calls for those — the enrichJob reads from rawJson first.
 *
 * Also issues live KickDB fetches for PENDING_GTIN where rawJson has empty
 * identifiers and the product was last fetched > REFRESH_DAYS ago, so we
 * catch products where KickDB has since added barcodes.
 *
 * Usage:
 *   npx tsx scripts/enrich-pending-gtin-from-rawjson.ts [--dry-run] [--limit N] [--concurrency N] [--refresh-days N]
 *
 * Flags:
 *   --dry-run      Print counts only; no DB writes.
 *   --limit N      Max SVs to process per pass (default 2000).
 *   --concurrency N (default 5)
 *   --refresh-days N Live-fetch products older than N days even if identifiers empty (default 30)
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import { runKickdbEnrich } from "@/galaxus/kickdb/enrichJob";
import { createLimiter } from "@/galaxus/jobs/bulkSql";

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "2000");
const CONCURRENCY = Number(
  process.argv.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? "5"
);
const REFRESH_DAYS = Number(
  process.argv.find((a) => a.startsWith("--refresh-days="))?.split("=")[1] ?? "30"
);

function parseArg(flag: string): number | null {
  const v = process.argv.find((a) => a.startsWith(`${flag}=`))?.split("=")[1];
  return v != null ? Number(v) : null;
}

const limit = parseArg("--limit") ?? 2000;
const concurrency = parseArg("--concurrency") ?? 5;
const refreshDays = parseArg("--refresh-days") ?? 30;

async function main() {
  const refreshCutoff = new Date(Date.now() - refreshDays * 24 * 60 * 60 * 1000);

  // Phase 1: PENDING_GTIN where rawJson already has non-empty identifiers on at least one variant.
  // These can be promoted from cached data without a live API call.
  console.log("[enrich-pending-gtin] Phase 1: find cached identifiers in rawJson…");

  const phase1 = await prisma.$queryRaw<Array<{ supplierVariantId: string }>>`
    SELECT sv."supplierVariantId"
    FROM "VariantMapping" vm
    JOIN "SupplierVariant" sv ON sv."supplierVariantId" = vm."supplierVariantId"
    JOIN "KickDBVariant" kv ON kv.id = vm."kickdbVariantId"
    JOIN "KickDBProduct" kp ON kp.id = kv."productId"
    WHERE vm.status = 'PENDING_GTIN'
      AND vm."supplierKey" = 'stx'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(kp."rawJson"->'variants') v
        WHERE jsonb_array_length(v->'identifiers') > 0
      )
    LIMIT ${limit}
  `;

  console.log(`[enrich-pending-gtin] Phase 1: ${phase1.length} SVs with cached identifiers`);

  // Phase 2: PENDING_GTIN where rawJson has empty identifiers but product is stale enough for a live refresh.
  const phase2Limit = Math.max(0, limit - phase1.length);
  const phase2 =
    phase2Limit > 0
      ? await prisma.$queryRaw<Array<{ supplierVariantId: string }>>`
          SELECT sv."supplierVariantId"
          FROM "VariantMapping" vm
          JOIN "SupplierVariant" sv ON sv."supplierVariantId" = vm."supplierVariantId"
          JOIN "KickDBVariant" kv ON kv.id = vm."kickdbVariantId"
          JOIN "KickDBProduct" kp ON kp.id = kv."productId"
          WHERE vm.status = 'PENDING_GTIN'
            AND vm."supplierKey" = 'stx'
            AND (kp."rawFetchedAt" IS NULL OR kp."rawFetchedAt" < ${refreshCutoff})
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(kp."rawJson"->'variants') v
              WHERE jsonb_array_length(v->'identifiers') > 0
            )
          ORDER BY kp."rawFetchedAt" ASC NULLS FIRST
          LIMIT ${phase2Limit}
        `
      : [];

  console.log(`[enrich-pending-gtin] Phase 2: ${phase2.length} SVs for live-fetch refresh`);

  const all = [...phase1, ...phase2];
  if (all.length === 0) {
    console.log("[enrich-pending-gtin] Nothing to process.");
    return;
  }
  if (DRY_RUN) {
    console.log("[enrich-pending-gtin] --dry-run: would process", all.length, "SVs. Exiting.");
    return;
  }

  const lim = createLimiter(concurrency);
  let promoted = 0;
  let failed = 0;
  let skipped = 0;

  await Promise.all(
    all.map(({ supplierVariantId }) =>
      lim(async () => {
        try {
          const { results } = await runKickdbEnrich({
            supplierVariantId,
            force: true,
          });
          const got = results.filter((r: any) => r.gtin).length;
          if (got > 0) {
            promoted += got;
          } else {
            skipped += 1;
          }
        } catch (err) {
          failed += 1;
          if (failed <= 5) {
            console.warn("[enrich-pending-gtin] error", supplierVariantId, (err as Error)?.message?.slice(0, 120));
          }
        }
      })
    )
  );

  console.log("[enrich-pending-gtin] done", {
    total: all.length,
    promoted,
    skipped,
    failed,
  });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
