/**
 * One-shot: +5 CHF on REI SKUs with longest rigid side ≥100 cm.
 * Idempotent via manualNote.bulkySurchargeChf.
 *
 *   npx tsx scripts/reprice-reichelt-bulky.ts
 *   npx tsx scripts/reprice-reichelt-bulky.ts --write
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import {
  REICHELT_BULKY_SURCHARGE_CHF_DEFAULT,
  resolveReicheltLongestSideMm,
} from "@/app/lib/reicheltPricing";

type Note = {
  type?: string;
  bulky?: boolean;
  bulkySurchargeChf?: number;
  longestSideMm?: number | null;
  [key: string]: unknown;
};

function parseNote(raw: string | null): Note {
  if (!raw || !raw.trim().startsWith("{")) return {};
  try {
    return JSON.parse(raw) as Note;
  } catch {
    return {};
  }
}

function roundChf(value: number): number {
  return Math.round(value * 100) / 100;
}

async function main() {
  const write = process.argv.includes("--write");
  const surcharge = REICHELT_BULKY_SURCHARGE_CHF_DEFAULT;

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      supplierVariantId: string;
      supplierSku: string | null;
      supplierProductName: string | null;
      price: number;
      stock: number;
      manualLock: boolean;
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
      stock,
      "manualLock",
      "manualNote",
      gtin
    FROM "SupplierVariant"
    WHERE "supplierVariantId" LIKE 'rei_%'
      AND "manualLock" IS NOT TRUE
      AND (
        "supplierProductName" ~* '(\\d{1,3}[ ]\\d{3}|\\d{3,5})[[:space:]]*mm'
        OR "supplierProductName" ~* '[[:digit:]]{2,3}[[:space:]]*cm'
        OR "supplierProductName" ~* '[[:digit:]][,.][[:digit:]][[:space:]]*m'
      )
  `;

  const samples: Array<Record<string, unknown>> = [];
  let skippedAlready = 0;
  let skippedNotBulky = 0;
  let changed = 0;

  for (const row of rows) {
    const dims = resolveReicheltLongestSideMm({ title: row.supplierProductName });
    if (!dims.bulky) {
      skippedNotBulky += 1;
      continue;
    }
    const note = parseNote(row.manualNote);
    if (Number(note.bulkySurchargeChf) >= surcharge) {
      skippedAlready += 1;
      continue;
    }

    const oldPrice = Number(row.price);
    if (!Number.isFinite(oldPrice) || oldPrice <= 0) continue;
    const nextPrice = roundChf(oldPrice + surcharge);
    changed += 1;
    if (samples.length < 20) {
      samples.push({
        sku: row.supplierSku,
        gtin: row.gtin,
        name: String(row.supplierProductName ?? "").slice(0, 70),
        mm: dims.longestSideMm,
        old: oldPrice,
        next: nextPrice,
        stock: row.stock,
      });
    }

    if (!write) continue;

    const nextNote = {
      ...note,
      type: note.type || "reichelt_landed_cost",
      longestSideMm: dims.longestSideMm,
      bulky: true,
      bulkySurchargeChf: surcharge,
      bulkyRepricedAt: new Date().toISOString(),
      bulkyRepricedFrom: oldPrice,
    };

    await prisma.supplierVariant.update({
      where: { id: row.id },
      data: {
        price: nextPrice,
        manualNote: JSON.stringify(nextNote),
        updatedAt: new Date(),
      },
    });
  }

  console.log(
    JSON.stringify(
      {
        write,
        surcharge,
        scanned: rows.length,
        skippedNotBulky,
        skippedAlready,
        wouldChange: changed,
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
