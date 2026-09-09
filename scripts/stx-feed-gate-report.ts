#!/usr/bin/env tsx
/**
 * Prints a summary of STX rows currently gated out of the Galaxus feed and
 * writes a per-reason CSV to `tmp/stx-feed-gate-report.csv`.
 *
 * Run:
 *   npx tsx scripts/stx-feed-gate-report.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/app/lib/prisma";
import { classifyStxBrand } from "@/galaxus/exports/stxBrandBuckets";
import { shouldOmitStxFromGalaxusFeed } from "@/galaxus/exports/stxFeedGate";

async function main() {
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      providerKey: string | null;
      supplierBrand: string | null;
      supplierProductName: string | null;
      price: string | number | null;
      stock: number | null;
    }>
  >(
    `
    SELECT "providerKey", "supplierBrand", "supplierProductName", price, stock
    FROM "SupplierVariant"
    WHERE "providerKey" ILIKE 'STX\\_%' AND stock > 0 AND price > 0;
    `
  );

  const byReason: Record<string, number> = {};
  const byBrand: Record<string, Record<string, number>> = {};
  const csvLines: string[] = [
    "providerKey,brand,bucket,reason,price,name",
  ];

  for (const r of rows) {
    const decision = shouldOmitStxFromGalaxusFeed({
      supplierKey: "stx",
      providerKey: r.providerKey ?? null,
      supplierBrand: r.supplierBrand ?? null,
      price: r.price ?? null,
    });
    if (!decision.omit) continue;
    const reason = decision.reason ?? "UNKNOWN";
    const brand = String(r.supplierBrand ?? "∅");
    const bucket = classifyStxBrand(brand);
    byReason[reason] = (byReason[reason] ?? 0) + 1;
    byBrand[brand] = byBrand[brand] ?? {};
    byBrand[brand][reason] = (byBrand[brand][reason] ?? 0) + 1;
    csvLines.push(
      [
        r.providerKey ?? "",
        brand,
        bucket,
        reason,
        String(r.price ?? ""),
        `"${String(r.supplierProductName ?? "").replace(/"/g, '""')}"`,
      ].join(",")
    );
  }

  console.info("[stx-feed-gate-report] STX in-stock rows scanned:", rows.length);
  console.info("[stx-feed-gate-report] gated by reason:", byReason);

  const topBrands = Object.entries(byBrand)
    .map(([brand, r]) => ({
      brand,
      total: Object.values(r).reduce((a, b) => a + b, 0),
      ...r,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 25);
  console.info("[stx-feed-gate-report] top 25 gated brands:");
  console.table(topBrands);

  await mkdir("tmp", { recursive: true });
  const outPath = join("tmp", "stx-feed-gate-report.csv");
  await writeFile(outPath, csvLines.join("\n") + "\n", "utf8");
  console.info(`[stx-feed-gate-report] CSV → ${outPath} (${csvLines.length - 1} rows)`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
