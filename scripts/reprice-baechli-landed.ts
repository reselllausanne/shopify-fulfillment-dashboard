/**
 * Reprice existing Baechli rows without re-scraping HTML.
 *
 * Old rows (type baechli_rent_a_shop): SupplierVariant.price was shelf buy CHF.
 * New rows (type baechli_landed_cost): buyChf in manualNote.
 *
 * sell = computeBaechliLandedCost(buy).sellPriceChf
 *
 * Usage:
 *   npx tsx scripts/reprice-baechli-landed.ts
 *   npx tsx scripts/reprice-baechli-landed.ts --dry
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import { computeBaechliLandedCost } from "@/app/lib/baechliPricing";

const dry = process.argv.includes("--dry");

type Note = {
  type?: string;
  buyChf?: number;
  productUrl?: string;
  supplierSku?: string;
  gtinSource?: string;
  sizeLabel?: string | null;
  [key: string]: unknown;
};

async function main() {
  const prismaAny = prisma as any;
  const rows = (await prismaAny.supplierVariant.findMany({
    where: { supplierVariantId: { startsWith: "bae_" } },
    select: {
      supplierVariantId: true,
      price: true,
      manualNote: true,
      supplierSku: true,
    },
  })) as Array<{
    supplierVariantId: string;
    price: number | null;
    manualNote: string | null;
    supplierSku: string | null;
  }>;

  let updated = 0;
  let skipped = 0;
  let unchanged = 0;

  for (const row of rows) {
    let note: Note = {};
    try {
      note = JSON.parse(String(row.manualNote || "{}")) as Note;
    } catch {
      note = {};
    }

    const type = String(note.type || "");
    let buyChf: number | null = null;
    if (type === "baechli_landed_cost" && Number(note.buyChf) > 0) {
      buyChf = Number(note.buyChf);
    } else if (type === "baechli_rent_a_shop" || !type) {
      // legacy: DB price was shelf buy
      buyChf = Number(row.price);
    } else if (Number(note.buyChf) > 0) {
      buyChf = Number(note.buyChf);
    }

    if (!buyChf || !Number.isFinite(buyChf) || buyChf <= 0) {
      skipped++;
      continue;
    }

    const cost = computeBaechliLandedCost(buyChf);
    if (!cost) {
      skipped++;
      continue;
    }

    const nextNote = {
      ...note,
      type: "baechli_landed_cost",
      buyPriceSource: note.buyPriceSource ?? "baechli_html",
      stockSource: note.stockSource ?? "schema_org_availability",
      ...cost,
    };

    const prevSell = Number(row.price);
    if (Math.abs(prevSell - cost.sellPriceChf) < 0.005 && type === "baechli_landed_cost") {
      unchanged++;
      continue;
    }

    if (!dry) {
      await prismaAny.supplierVariant.update({
        where: { supplierVariantId: row.supplierVariantId },
        data: {
          price: cost.sellPriceChf,
          manualNote: JSON.stringify(nextNote),
        },
      });
    }
    updated++;
  }

  console.log(
    JSON.stringify({
      ok: true,
      dry,
      total: rows.length,
      updated,
      unchanged,
      skipped,
    })
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
