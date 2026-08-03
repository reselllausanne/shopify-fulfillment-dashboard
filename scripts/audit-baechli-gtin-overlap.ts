/**
 * Sample Bächli product pages, extract GS1-valid GTINs, compare with existing supplier mappings.
 *
 * Usage:
 *   npx tsx scripts/audit-baechli-gtin-overlap.ts
 *   npx tsx scripts/audit-baechli-gtin-overlap.ts --sample=300
 */
import { prisma } from "@/app/lib/prisma";
import { BaechliClient } from "@/app/lib/baechliClient";

const BASE_URL = process.env.BAECHLI_BASE_URL || "https://www.baechli-bergsport.ch/de";
const sampleArg = process.argv.find((a) => a.startsWith("--sample="));
const SAMPLE_SIZE = sampleArg ? Math.max(20, Number(sampleArg.split("=")[1] || 200)) : 200;

async function main() {
  const client = new BaechliClient(BASE_URL);
  const urls = await client.listDeProductUrls(SAMPLE_SIZE);

  const gtinStats = {
    pages: 0,
    variants: 0,
    withGtin: 0,
    gtin13: 0,
    gtin12: 0,
    other: 0,
    noGtin: 0,
  };
  const gtins = new Set<string>();

  for (const url of urls) {
    try {
      const product = await client.fetchProduct(url);
      if (!product) continue;
      gtinStats.pages++;
      for (const variant of product.variants) {
        gtinStats.variants++;
        if (!variant.gtin) {
          gtinStats.noGtin++;
          continue;
        }
        gtinStats.withGtin++;
        gtins.add(variant.gtin);
        if (variant.gtinSource === "gtin13") gtinStats.gtin13++;
        else if (variant.gtinSource === "gtin12") gtinStats.gtin12++;
        else gtinStats.other++;
      }
    } catch (err) {
      console.warn("fetch failed", url, (err as Error)?.message || err);
    }
  }

  const gtinList = [...gtins];
  const overlapRows =
    gtinList.length === 0
      ? []
      : await prisma.variantMapping.findMany({
          where: {
            gtin: { in: gtinList },
            supplierKey: { not: "bae" },
          },
          select: { gtin: true, supplierKey: true, supplierVariantId: true },
        });

  const overlapBySupplier = new Map<string, number>();
  const overlapGtins = new Set<string>();
  for (const row of overlapRows) {
    if (!row.gtin || !row.supplierKey) continue;
    overlapGtins.add(row.gtin);
    overlapBySupplier.set(row.supplierKey, (overlapBySupplier.get(row.supplierKey) ?? 0) + 1);
  }

  console.log(
    JSON.stringify(
      {
        baseUrl: BASE_URL,
        sampledPages: urls.length,
        parsedPages: gtinStats.pages,
        variants: gtinStats.variants,
        withGtin: gtinStats.withGtin,
        noGtin: gtinStats.noGtin,
        uniqueGtins: gtins.size,
        gtinSourceBreakdown: {
          gtin13: gtinStats.gtin13,
          gtin12: gtinStats.gtin12,
          other: gtinStats.other,
        },
        overlap: {
          gtinsOverlappingExistingSuppliers: overlapGtins.size,
          overlapRateAmongUniqueGtins:
            gtins.size > 0 ? Number((overlapGtins.size / gtins.size).toFixed(4)) : 0,
          rowsBySupplier: Object.fromEntries(
            [...overlapBySupplier.entries()].sort((a, b) => b[1] - a[1])
          ),
        },
        notes: [
          "gtin13 = EAN-13 (preferred in CH/EU)",
          "gtin12 = UPC-A (North America; no separate upc field on site)",
          "Only GS1 check-digit-valid barcodes are kept",
        ],
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
