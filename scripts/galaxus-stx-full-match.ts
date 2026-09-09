/**
 * Full Galaxus StockX link pass: bulk-sync all DD + warehouse STX orders,
 * AWB/ETA refresh on linked units, unlinked-buy report.
 *
 *   npx tsx scripts/galaxus-stx-full-match.ts
 *   npx tsx scripts/galaxus-stx-full-match.ts --out=tmp/galaxus-stx-full-match.json
 */
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../app/lib/prisma";
import { runGalaxusBulkStxSync } from "../galaxus/stx/bulkVisibleSync";
import { refreshLinkedStxUnitsByStoredRefs } from "../galaxus/stx/linkedUnitRefresh";
import { listUnlinkedGalaxusStockxBuys } from "../galaxus/stx/unlinkedStockxBuysReport";
import { readGalaxusStockxToken } from "../lib/stockxGalaxusAuth";
import { isGalaxusShipmentDispatchConfirmed } from "../galaxus/orders/shipmentDispatch";

const BATCH_SIZE = 200;

function parseOutArg(): string {
  const raw = process.argv.find((a) => a.startsWith("--out="));
  return raw ? raw.slice("--out=".length) : "tmp/galaxus-stx-full-match.json";
}

async function loadStxGalaxusOrderIds(): Promise<
  Array<{ id: string; galaxusOrderId: string; deliveryType: string | null }>
> {
  return prisma.galaxusOrder.findMany({
    where: {
      archivedAt: null,
      cancelledAt: null,
      lines: {
        some: {
          OR: [
            { providerKey: { startsWith: "STX_", mode: "insensitive" } },
            { supplierVariantId: { startsWith: "stx_", mode: "insensitive" } },
            { supplierPid: { startsWith: "STX_", mode: "insensitive" } },
          ],
        },
      },
    },
    select: { id: true, galaxusOrderId: true, deliveryType: true },
    orderBy: { orderDate: "asc" },
  });
}

async function refreshMissingAwbForLinkedUnits(token: string) {
  const prismaAny = prisma as any;
  const units = await prismaAny.stxPurchaseUnit.findMany({
    where: {
      stockxOrderId: { not: null },
      OR: [{ awb: null }, { awb: "" }],
      cancelledAt: null,
    },
    select: {
      galaxusOrderId: true,
    },
  });
  const orderRefs = Array.from(
    new Set(units.map((u: { galaxusOrderId: string }) => String(u.galaxusOrderId ?? "").trim()).filter(Boolean))
  );

  let awbBackfilled = 0;
  let refreshed = 0;
  let failed = 0;
  const failures: Array<{ galaxusOrderId: string; reason: string }> = [];

  for (const galaxusOrderId of orderRefs) {
    const stats = await refreshLinkedStxUnitsByStoredRefs(token, galaxusOrderId);
    awbBackfilled += stats.awbBackfilled;
    refreshed += stats.refreshed;
    failed += stats.failed;
    for (const f of stats.failures) {
      if (failures.length < 50) failures.push({ galaxusOrderId, reason: `${f.stockxOrderId}: ${f.reason}` });
    }
  }

  return { orderCount: orderRefs.length, awbBackfilled, refreshed, failed, failures };
}

async function listShippedLinkedMissingAwb() {
  const prismaAny = prisma as any;
  const units = await prismaAny.stxPurchaseUnit.findMany({
    where: {
      stockxOrderId: { not: null },
      OR: [{ awb: null }, { awb: "" }],
      cancelledAt: null,
    },
    select: {
      id: true,
      galaxusOrderId: true,
      gtin: true,
      supplierVariantId: true,
      stockxOrderId: true,
      stockxOrderNumber: true,
    },
  });
  if (units.length === 0) return [];

  const orderRefs = Array.from(new Set(units.map((u: any) => u.galaxusOrderId)));
  const orders = await prisma.galaxusOrder.findMany({
    where: { galaxusOrderId: { in: orderRefs } },
    select: {
      galaxusOrderId: true,
      deliveryType: true,
      shipments: { select: { delrSentAt: true, delrStatus: true, status: true } },
    },
  });
  const shippedRefs = new Set<string>();
  for (const o of orders) {
    const isDirect = String(o.deliveryType ?? "").toLowerCase() === "direct_delivery";
    const shipped = (o.shipments ?? []).some((s: any) =>
      isDirect
        ? Boolean(s.delrSentAt)
        : isGalaxusShipmentDispatchConfirmed(s)
    );
    if (shipped) shippedRefs.add(o.galaxusOrderId);
  }

  return units
    .filter((u: any) => shippedRefs.has(u.galaxusOrderId))
    .map((u: any) => ({
      galaxusOrderId: u.galaxusOrderId,
      gtin: u.gtin,
      supplierVariantId: u.supplierVariantId,
      stockxOrderId: u.stockxOrderId,
      stockxOrderNumber: u.stockxOrderNumber,
    }));
}

async function main() {
  const outPath = parseOutArg();
  const startedAt = new Date().toISOString();

  const token = await readGalaxusStockxToken();
  if (!token) {
    console.error("[galaxus-stx-full-match] Missing Galaxus StockX token (.data/stockx-token-galaxus.json)");
    process.exit(1);
  }

  const orders = await loadStxGalaxusOrderIds();
  console.log(`[galaxus-stx-full-match] STX orders: ${orders.length}`);

  const bulkResults: Awaited<ReturnType<typeof runGalaxusBulkStxSync>>[] = [];
  for (let i = 0; i < orders.length; i += BATCH_SIZE) {
    const batch = orders.slice(i, i + BATCH_SIZE).map((o) => o.id);
    console.log(
      `[galaxus-stx-full-match] bulk sync batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(orders.length / BATCH_SIZE)} (${batch.length} orders)`
    );
    const result = await runGalaxusBulkStxSync(batch);
    bulkResults.push(result);
    console.log(
      `[galaxus-stx-full-match]   linked=${result.linked} alreadyLinked=${result.alreadyLinked} awbBackfilled=${result.awbBackfilled} errors=${result.errors}`
    );
    if (!result.ok && result.error) {
      console.warn(`[galaxus-stx-full-match]   batch error: ${result.error}`);
    }
  }

  console.log("[galaxus-stx-full-match] AWB refresh pass…");
  const awbRefresh = await refreshMissingAwbForLinkedUnits(token);
  const shippedMissingAwbAfter = await listShippedLinkedMissingAwb();

  console.log("[galaxus-stx-full-match] Unlinked StockX buys…");
  const unlinkedReport = await listUnlinkedGalaxusStockxBuys();

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    ordersTotal: orders.length,
    bulk: {
      batches: bulkResults.length,
      linked: bulkResults.reduce((s, r) => s + r.linked, 0),
      alreadyLinked: bulkResults.reduce((s, r) => s + r.alreadyLinked, 0),
      awbBackfilled: bulkResults.reduce((s, r) => s + r.awbBackfilled, 0),
      etaBackfilled: bulkResults.reduce((s, r) => s + r.etaBackfilled, 0),
      errors: bulkResults.reduce((s, r) => s + r.errors, 0),
    },
    awbRefresh,
    shippedLinkedStillMissingAwb: shippedMissingAwbAfter,
    unlinkedStockxBuys: unlinkedReport,
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log(`\n[galaxus-stx-full-match] wrote ${outPath}`);
  console.log(
    `[galaxus-stx-full-match] linked=${summary.bulk.linked} unlinkedStockx=${unlinkedReport.unlinked.length} shippedMissingAwb=${shippedMissingAwbAfter.length}`
  );

  if (unlinkedReport.unlinked.length > 0) {
    console.log("\n--- Unlinked StockX buys (not on Galaxus) ---");
    for (const row of unlinkedReport.unlinked) {
      console.log(
        `${row.orderNumber ?? row.orderId ?? "?"} | ${row.productTitle ?? "?"} | ${row.size ?? "?"} | ${row.amount ?? "?"} ${row.currency ?? ""} | ${row.purchaseDate ?? ""}`
      );
    }
  }

  if (shippedMissingAwbAfter.length > 0) {
    console.log("\n--- Shipped Galaxus pairs still missing AWB ---");
    for (const row of shippedMissingAwbAfter) {
      console.log(
        `${row.galaxusOrderId} | ${row.stockxOrderNumber ?? row.stockxOrderId} | gtin=${row.gtin}`
      );
    }
  }
}

main()
  .catch((err) => {
    console.error("[galaxus-stx-full-match] fatal", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
