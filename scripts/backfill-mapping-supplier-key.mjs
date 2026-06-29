/**
 * Backfill VariantMapping.supplierKey in SQL batches (safe on large tables).
 * Run: node scripts/backfill-mapping-supplier-key.mjs
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const BATCH = 5000;
const url = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();

function createClient() {
  return new PrismaClient({
    datasources: { db: { url } },
  });
}

let prisma = createClient();

async function reconnect() {
  try {
    await prisma.$disconnect();
  } catch {
    // ignore
  }
  prisma = createClient();
}

async function backfillBatch() {
  return prisma.$executeRaw`
    UPDATE "public"."VariantMapping" vm
    SET "supplierKey" = lower(
      CASE
        WHEN sv."supplierVariantId" ~ '^[^:]+:' THEN split_part(sv."supplierVariantId", ':', 1)
        WHEN sv."supplierVariantId" LIKE '%\_%' ESCAPE '\' THEN split_part(sv."supplierVariantId", '_', 1)
        ELSE NULL
      END
    )
    FROM "public"."SupplierVariant" sv
    WHERE vm."supplierVariantId" = sv."supplierVariantId"
      AND vm."supplierKey" IS NULL
      AND vm."id" IN (
        SELECT vm2."id"
        FROM "public"."VariantMapping" vm2
        WHERE vm2."supplierKey" IS NULL
          AND vm2."supplierVariantId" IS NOT NULL
        LIMIT ${BATCH}
      )
  `;
}

async function main() {
  if (!url) throw new Error("Missing DIRECT_URL or DATABASE_URL");
  let total = 0;
  while (true) {
    let changed = 0;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        changed = Number(await backfillBatch());
        break;
      } catch (err) {
        if (attempt === 3) throw err;
        console.warn(`[backfill] batch failed (attempt ${attempt}), reconnecting…`, err?.code ?? err?.message);
        await reconnect();
      }
    }
    if (!changed) break;
    total += changed;
    console.info(`[backfill] +${changed} rows (${total} total)`);
  }
  console.info(`[backfill] done — ${total} rows`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
