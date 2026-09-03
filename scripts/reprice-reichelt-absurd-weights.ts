/**
 * Recompute REI SupplierVariant.price from stored reichelt_landed_cost notes
 * when scraped ship weight was absurd (fixes Brio-class 121kg scrapes).
 *
 * Only touches rows where stored weightGrams > 50kg OR shippingEur > 30.
 *
 * Dry-run by default. Apply with --write.
 *
 *   npx tsx scripts/reprice-reichelt-absurd-weights.ts
 *   npx tsx scripts/reprice-reichelt-absurd-weights.ts --write
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import {
  computeReicheltLandedCost,
  REICHELT_MAX_SHIP_WEIGHT_GRAMS_DEFAULT,
} from "@/app/lib/reicheltPricing";

type Note = {
  type?: string;
  rawPriceChf?: number | null;
  priceEur?: number | null;
  productChf?: number | null;
  weightGrams?: number | null;
  shippingEur?: number | null;
  marginPercent?: number | null;
  sellPriceChf?: number | null;
  [key: string]: unknown;
};

function parseNote(raw: string | null): Note | null {
  if (!raw || !raw.trim().startsWith("{")) return null;
  try {
    const n = JSON.parse(raw) as Note;
    if (n?.type !== "reichelt_landed_cost") return null;
    return n;
  } catch {
    return null;
  }
}

function isAbsurdWeightNote(note: Note): boolean {
  const w = Number(note.weightGrams);
  const ship = Number(note.shippingEur);
  if (Number.isFinite(w) && w > REICHELT_MAX_SHIP_WEIGHT_GRAMS_DEFAULT) return true;
  if (Number.isFinite(ship) && ship > 30) return true;
  return false;
}

async function main() {
  const write = process.argv.includes("--write");
  const minDropArg = process.argv.find((a) => a.startsWith("--min-drop-chf="));
  const minDrop = minDropArg ? Number(minDropArg.split("=")[1]) : 1;

  // Avoid loading all ~108k notes (statement timeout). Pre-filter absurd weights in SQL.
  const maxW = REICHELT_MAX_SHIP_WEIGHT_GRAMS_DEFAULT;
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      supplierVariantId: string;
      supplierSku: string | null;
      supplierProductName: string | null;
      price: number;
      manualNote: string | null;
      gtin: string | null;
    }>
  >`
    SELECT
      id,
      "supplierVariantId",
      "supplierSku",
      "supplierProductName",
      price::float AS price,
      "manualNote",
      gtin
    FROM "SupplierVariant"
    WHERE "supplierVariantId" LIKE 'rei_%'
      AND "manualNote" IS NOT NULL
      AND "manualNote" LIKE '{%'
      AND (
        NULLIF("manualNote"::json->>'weightGrams', '')::float > ${maxW}
        OR NULLIF("manualNote"::json->>'shippingEur', '')::float > 30
      )
  `;

  const scanned = rows.length;
  let absurdCandidates = 0;
  let changed = 0;
  let skipped = 0;
  let totalDrop = 0;
  const samples: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const note = parseNote(row.manualNote);
    if (!note) {
      skipped += 1;
      continue;
    }
    if (!isAbsurdWeightNote(note)) continue;
    absurdCandidates += 1;

    const priceChf =
      note.rawPriceChf != null && Number(note.rawPriceChf) > 0
        ? Number(note.rawPriceChf)
        : note.productChf != null && Number(note.productChf) > 0
          ? Number(note.productChf)
          : null;
    const priceEur = note.priceEur != null && Number(note.priceEur) > 0 ? Number(note.priceEur) : null;
    if (priceChf == null && priceEur == null) {
      skipped += 1;
      continue;
    }

    const cost = computeReicheltLandedCost({
      priceChf,
      priceEur,
      weightGrams: note.weightGrams != null ? Number(note.weightGrams) : null,
      marginPercent: note.marginPercent != null ? Number(note.marginPercent) : undefined,
    });
    if (!cost) {
      skipped += 1;
      continue;
    }

    const oldPrice = Number(row.price);
    const drop = oldPrice - cost.sellPriceChf;
    if (!Number.isFinite(oldPrice) || drop < minDrop) continue;

    changed += 1;
    totalDrop += drop;
    if (samples.length < 30) {
      samples.push({
        sku: row.supplierSku,
        gtin: row.gtin,
        name: String(row.supplierProductName ?? "").slice(0, 60),
        old: oldPrice,
        next: cost.sellPriceChf,
        drop: Math.round(drop * 100) / 100,
        oldWeight: note.weightGrams,
        nextWeight: cost.weightGrams,
        weightSource: cost.weightSource,
      });
    }

    if (!write) continue;

    const nextNote = {
      ...note,
      productChf: cost.productChf,
      productPriceSource: cost.productPriceSource,
      shippingEur: cost.shippingEur,
      shippingChf: cost.shippingChf,
      landedChf: cost.landedChf,
      marginPercent: cost.marginPercent,
      sellPriceChf: cost.sellPriceChf,
      weightGrams: cost.weightGrams,
      rawWeightGrams: cost.rawWeightGrams,
      weightSource: cost.weightSource,
      eurChfRate: cost.eurChfRate,
      vatRate: cost.vatRate,
      repricedAt: new Date().toISOString(),
      repricedFrom: oldPrice,
    };

    await prisma.supplierVariant.update({
      where: { id: row.id },
      data: {
        price: cost.sellPriceChf,
        manualNote: JSON.stringify(nextNote),
        updatedAt: new Date(),
      },
    });
  }

  console.log(
    JSON.stringify(
      {
        write,
        minDrop,
        scanned,
        absurdCandidates,
        skipped,
        wouldChange: changed,
        avgDropChf: changed > 0 ? Math.round((totalDrop / changed) * 100) / 100 : 0,
        totalDropChf: Math.round(totalDrop * 100) / 100,
        samples,
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
