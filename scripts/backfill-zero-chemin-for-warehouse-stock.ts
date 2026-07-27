import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/app/lib/prisma";
import { setInventoryQuantity } from "@/shopify/catalog/graphql";
import { ONLINE_LOCATION } from "@/shopify/inventory/locationConfig";
import { BUSSIGNY_LOCATION_ID } from "@/shopify/restock/bussignyDeliveryMetafield";

/**
 * Backfill: any variant with physical warehouse stock (Bussigny) must have 0
 * stock at the Chemin online (dropship) location. Otherwise a soldes-locked
 * price applies to a StockX-sourced dropship copy at checkout and we sell a
 * pair we never had at the discount.
 *
 * Dry-run by default. Pass `--apply` to actually write.
 */

const DRY_RUN = !process.argv.includes("--apply");
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split("=")[1]) : Number.POSITIVE_INFINITY;

type StockRow = {
  gtin: string;
  physicalAvailable: number;
  onlineAvailable: number;
  inventoryItemId: string;
  variantId: string | null;
  sku: string | null;
};

async function main() {
  const onlineId = ONLINE_LOCATION?.id;
  if (!onlineId) {
    console.error("ONLINE_LOCATION (Chemin) not configured — abort");
    process.exit(1);
  }

  const rows = await prisma.$queryRaw<StockRow[]>`
    WITH physical AS (
      SELECT
        p."gtin",
        p."inventoryItemId",
        p."shopifyVariantId" AS "variantId",
        p."sku",
        p."available" AS "physicalAvailable"
      FROM "public"."ShopifyVariantLocationStock" p
      WHERE p."locationId" = ${BUSSIGNY_LOCATION_ID}
        AND p."sourceType" = 'physical'
        AND p."available" > 0
        AND p."inventoryItemId" IS NOT NULL
    )
    SELECT
      physical."gtin",
      physical."physicalAvailable",
      physical."inventoryItemId",
      physical."variantId",
      physical."sku",
      COALESCE(online."available", 0) AS "onlineAvailable"
    FROM physical
    LEFT JOIN "public"."ShopifyVariantLocationStock" online
      ON online."inventoryItemId" = physical."inventoryItemId"
     AND online."locationId" = ${onlineId}
    WHERE COALESCE(online."available", 0) > 0
    ORDER BY physical."gtin" ASC
  `;

  console.log(
    `[backfill] ${DRY_RUN ? "DRY RUN" : "APPLY"} — ${rows.length} inventoryItems with warehouse stock still show >0 at Chemin`
  );

  const report: Array<Record<string, unknown>> = [];
  let done = 0;
  let failed = 0;
  let unitsRemoved = 0;

  for (const row of rows.slice(0, Number.isFinite(LIMIT) ? LIMIT : rows.length)) {
    const record: Record<string, unknown> = {
      gtin: row.gtin,
      sku: row.sku,
      variantId: row.variantId,
      inventoryItemId: row.inventoryItemId,
      physicalAvailable: row.physicalAvailable,
      onlineAvailable: row.onlineAvailable,
    };

    if (DRY_RUN) {
      record.action = "would-zero-online";
      unitsRemoved += Number(row.onlineAvailable ?? 0);
      report.push(record);
      done += 1;
      continue;
    }

    try {
      await setInventoryQuantity({
        inventoryItemId: row.inventoryItemId,
        locationId: onlineId,
        quantity: 0,
      });
      await prisma.$executeRaw`
        UPDATE "public"."ShopifyVariantLocationStock"
           SET "available" = 0, "updatedAt" = NOW()
         WHERE "inventoryItemId" = ${row.inventoryItemId}
           AND "locationId" = ${onlineId}
      `;
      record.action = "zeroed";
      unitsRemoved += Number(row.onlineAvailable ?? 0);
      done += 1;
    } catch (err: any) {
      record.action = "error";
      record.error = err?.message ?? String(err);
      failed += 1;
    }
    report.push(record);

    if (done % 20 === 0) {
      console.log(`[backfill] progress ${done}/${rows.length} (${failed} failed)`);
    }
  }

  const outPath = path.join(
    process.cwd(),
    "artifacts",
    `chemin-zero-backfill-${DRY_RUN ? "dryrun" : "applied"}-${Date.now()}.csv`
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const header = [
    "gtin",
    "sku",
    "variantId",
    "inventoryItemId",
    "physicalAvailable",
    "onlineAvailable",
    "action",
    "error",
  ];
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  fs.writeFileSync(
    outPath,
    [header.join(",")]
      .concat(report.map((r) => header.map((h) => esc(r[h])).join(",")))
      .join("\n") + "\n"
  );

  console.log(
    JSON.stringify(
      {
        dryRun: DRY_RUN,
        candidates: rows.length,
        processed: done,
        failed,
        unitsRemoved,
        report: outPath,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
