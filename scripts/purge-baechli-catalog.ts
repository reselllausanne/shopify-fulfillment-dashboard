/**
 * Remove scraped Bächli rows that fail current filters (ISBN maps/books, excluded paths).
 *
 * Usage:
 *   npx tsx scripts/purge-baechli-catalog.ts          # dry-run counts
 *   npx tsx scripts/purge-baechli-catalog.ts --apply  # delete
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import {
  isBaechliExcludedPath,
  shouldSkipBaechliGtin,
} from "@/app/lib/baechliClient";

const APPLY = process.argv.includes("--apply");

async function main() {
  const rows = await prisma.supplierVariant.findMany({
    where: { supplierVariantId: { startsWith: "bae_" } },
    select: { supplierVariantId: true, gtin: true, manualNote: true },
  });

  const toDelete: string[] = [];
  for (const row of rows) {
    let url = "";
    try {
      url = JSON.parse(row.manualNote || "{}").productUrl || "";
    } catch {
      /* ignore */
    }
    const path = url ? new URL(url).pathname : "";
    const isbn = row.gtin ? shouldSkipBaechliGtin(row.gtin) : false;
    const excluded = path ? isBaechliExcludedPath(path) : false;
    if (isbn || excluded) toDelete.push(row.supplierVariantId);
  }

  console.log(
    JSON.stringify(
      {
        apply: APPLY,
        total: rows.length,
        purge: toDelete.length,
        keep: rows.length - toDelete.length,
      },
      null,
      2
    )
  );

  if (!APPLY || !toDelete.length) return;

  const chunk = 500;
  for (let i = 0; i < toDelete.length; i += chunk) {
    const batch = toDelete.slice(i, i + chunk);
    await prisma.variantMapping.deleteMany({ where: { supplierVariantId: { in: batch } } });
    await prisma.supplierVariant.deleteMany({ where: { supplierVariantId: { in: batch } } });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
