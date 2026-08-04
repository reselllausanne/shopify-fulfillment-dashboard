/**
 * Backfill: park every KickDBProduct whose rawJson carries zero images into
 * ShopifySyncState.syncStatus = 'blocked_no_images'. Drops those rows out of
 * /api/kickdb/fresh?status=untracked so main_from_db.py stops spending
 * Shopify API budget on products that will always fail the create image
 * guard. Row auto-unblocks on the next SSE refresh (rawFetchedAt bump) if
 * KicksDB starts returning images.
 *
 * Usage:
 *   npx tsx scripts/backfill-block-kickdb-no-images.ts            # dry-run
 *   npx tsx scripts/backfill-block-kickdb-no-images.ts --write    # apply
 */
import "dotenv/config";
import { prisma } from "../app/lib/prisma";

function rawHasAnyImage(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  const primary = r.image;
  if (typeof primary === "string" && primary.trim()) return true;
  for (const key of ["gallery", "gallery_360"] as const) {
    const val = r[key];
    if (!Array.isArray(val)) continue;
    for (const item of val) {
      if (typeof item === "string" && item.trim()) return true;
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        for (const k of ["url", "src", "image", "imageUrl"]) {
          const v = o[k];
          if (typeof v === "string" && v.trim()) return true;
        }
      }
    }
  }
  return false;
}

async function main() {
  const write = process.argv.includes("--write");
  const batchSize = 500;
  let cursor: string | null = null;
  let scanned = 0;
  let missing = 0;
  let blocked = 0;
  let skipped = 0;

  while (true) {
    const rows: Array<{
      kickdbProductId: string;
      rawJson: unknown;
      syncStatus: string | null;
    }> = await prisma.$queryRawUnsafe(
      `SELECT p."kickdbProductId", p."rawJson", s."syncStatus"
       FROM "public"."KickDBProduct" p
       LEFT JOIN "public"."ShopifySyncState" s
         ON s."kickdbProductId" = p."kickdbProductId"
       WHERE p."rawJson" IS NOT NULL
         ${cursor ? `AND p."kickdbProductId" > '${cursor.replace(/'/g, "''")}'` : ""}
       ORDER BY p."kickdbProductId" ASC
       LIMIT ${batchSize}`
    );
    if (rows.length === 0) break;
    for (const row of rows) {
      scanned += 1;
      if (rawHasAnyImage(row.rawJson)) continue;
      missing += 1;
      // Don't stomp real sync outcomes: skip rows already marked 'synced'
      // (those made it onto Shopify somehow — leave them alone) and rows
      // already parked as 'blocked_no_images'.
      if (row.syncStatus === "synced" || row.syncStatus === "blocked_no_images") {
        skipped += 1;
        continue;
      }
      if (!write) {
        blocked += 1;
        continue;
      }
      const now = new Date();
      await prisma.$executeRawUnsafe(
        `INSERT INTO "public"."ShopifySyncState" (
           "id", "kickdbProductId", "syncStatus", "shopifySyncedAt",
           "lastError", "createdAt", "updatedAt"
         ) VALUES (
           gen_random_uuid(), $1, 'blocked_no_images', $2,
           'blocked_no_images: backfill', $2, $2
         )
         ON CONFLICT ("kickdbProductId") DO UPDATE SET
           "syncStatus"      = 'blocked_no_images',
           "shopifySyncedAt" = EXCLUDED."shopifySyncedAt",
           "lastError"       = EXCLUDED."lastError",
           "updatedAt"       = EXCLUDED."updatedAt"`,
        row.kickdbProductId,
        now
      );
      blocked += 1;
    }
    cursor = rows[rows.length - 1].kickdbProductId;
    console.log(
      JSON.stringify({ scanned, missing, blocked, skipped, cursor })
    );
  }

  console.log("\n[DONE]", JSON.stringify({ scanned, missing, blocked, skipped, write }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
