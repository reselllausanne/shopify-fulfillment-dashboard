/**
 * Zero TUS SupplierVariant rows where storefront PDP is OOS but Store API still reports stock.
 * Run after uncommonClient PDP guard deploy when you need immediate cleanup.
 *
 *   npx tsx scripts/tus-pdp-oos-sweep.ts
 *   npx tsx scripts/tus-pdp-oos-sweep.ts --dry-run
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import { UncommonClient, isUncommonPdpSoldOut } from "@/app/lib/uncommonClient";

const dryRun = process.argv.includes("--dry-run");
const concurrency = Math.max(1, Number(process.env.SCRAPER_TUS_CONCURRENCY || 6));

type Row = {
  supplierVariantId: string;
  stock: number;
  woo_id: number;
  url: string;
  name: string;
};

async function fetchRows(): Promise<Row[]> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT sv."supplierVariantId" AS "supplierVariantId",
           sv.stock,
           (sv."manualNote"::jsonb->>'wooId')::int AS woo_id,
           sv."manualNote"::jsonb->>'productUrl' AS url,
           sv."supplierProductName" AS name
    FROM "SupplierVariant" sv
    WHERE sv."supplierVariantId" LIKE 'tus_%'
      AND sv.stock > 0
      AND sv."manualNote"::jsonb->>'wooId' IS NOT NULL
      AND sv."manualNote"::jsonb->>'productUrl' IS NOT NULL
  `;
  return rows.filter((r) => Number.isFinite(r.woo_id) && String(r.url || "").trim());
}

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
      for (;;) {
        const idx = i++;
        if (idx >= items.length) break;
        await worker(items[idx]!);
      }
    })
  );
}

async function main() {
  const client = new UncommonClient("https://theuncommonshop.ch");
  const rows = await fetchRows();
  const zeroIds: string[] = [];
  let checked = 0;

  await runPool(rows, async (row) => {
    checked++;
    try {
      const html = await client.fetchText(String(row.url).trim());
      if (!isUncommonPdpSoldOut(html)) return;
      zeroIds.push(row.supplierVariantId);
      if (!dryRun) {
        await prisma.supplierVariant.update({
          where: { supplierVariantId: row.supplierVariantId },
          data: { stock: 0, leadTimeDays: null, lastSyncAt: new Date() },
        });
      }
    } catch (err) {
      console.warn(`[tus-sweep] skip ${row.supplierVariantId}:`, (err as Error)?.message || err);
    }
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun,
        checked,
        zeroed: zeroIds.length,
        samples: zeroIds.slice(0, 20),
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
