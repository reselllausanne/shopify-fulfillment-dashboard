#!/usr/bin/env npx tsx
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { reconcileGalaxusOrderProcurement } from "@/galaxus/orders/galaxusProcurementReconcile";

const prisma = new PrismaClient();

function argFlag(name: string): string | null {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  return null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseDateMs(value: unknown): number | null {
  if (!value) return null;
  const t = new Date(String(value)).getTime();
  return Number.isFinite(t) ? t : null;
}

function isCausal(orderDate: unknown, purchaseDate: unknown, skewMinutes = 5): boolean {
  const orderMs = parseDateMs(orderDate);
  const buyMs = parseDateMs(purchaseDate);
  if (orderMs == null || buyMs == null) return false;
  return buyMs >= orderMs - skewMinutes * 60_000;
}

function looksLikeStockxRef(value: unknown): boolean {
  const ref = String(value ?? "").trim();
  if (!ref) return false;
  if (/^MANUAL-/i.test(ref)) return false;
  if (/^LOCAL-/i.test(ref)) return false;
  return /^[A-Z0-9-]{6,}$/i.test(ref);
}

async function main() {
  const apply = hasFlag("apply");
  const relink = !hasFlag("no-relink");
  const limit = Math.max(1, Number(argFlag("limit") ?? "5000"));

  const rows = await (prisma as any).galaxusStockxMatch.findMany({
    where: {
      stockxPurchaseDate: { not: null },
      galaxusOrderDate: { not: null },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      galaxusOrderRef: true,
      galaxusOrderLineId: true,
      unitIndex: true,
      stockxOrderId: true,
      stockxOrderNumber: true,
      galaxusOrderDate: true,
      stockxPurchaseDate: true,
    },
  });

  const invalid = rows.filter(
    (r: any) => !isCausal(r.galaxusOrderDate, r.stockxPurchaseDate, 5)
  );

  const impactedRefs = new Set<string>();
  for (const row of invalid as any[]) {
    const ref = String(row.galaxusOrderRef ?? "").trim();
    if (ref) impactedRefs.add(ref);
  }

  console.log(
    JSON.stringify(
      {
        scanned: rows.length,
        invalid: invalid.length,
        impactedOrders: impactedRefs.size,
        apply,
        relink,
      },
      null,
      2
    )
  );

  if (!apply || invalid.length === 0) {
    console.log(
      JSON.stringify(
        invalid.slice(0, 20).map((row: any) => ({
          id: row.id,
          orderRef: row.galaxusOrderRef,
          lineId: row.galaxusOrderLineId,
          unitIndex: row.unitIndex,
          stockxOrderNumber: row.stockxOrderNumber,
          galaxusOrderDate: row.galaxusOrderDate,
          stockxPurchaseDate: row.stockxPurchaseDate,
        })),
        null,
        2
      )
    );
    await prisma.$disconnect();
    return;
  }

  let matchesDeleted = 0;
  let unitsUnlinked = 0;

  for (const row of invalid as any[]) {
    const orderRef = String(row.galaxusOrderRef ?? "").trim();
    const stockxOrderId = String(row.stockxOrderId ?? "").trim();
    const stockxOrderNumber = String(row.stockxOrderNumber ?? "").trim();

    if (orderRef) {
      if (stockxOrderId) {
        const cleared = await (prisma as any).stxPurchaseUnit.updateMany({
          where: {
            galaxusOrderId: orderRef,
            stockxOrderId,
          },
          data: {
            stockxOrderId: null,
            stockxOrderNumber: null,
            awb: null,
            etaMin: null,
            etaMax: null,
            checkoutType: null,
            stockxSettledAmount: null,
            stockxSettledCurrency: null,
            updatedAt: new Date(),
          },
        });
        unitsUnlinked += Number(cleared?.count ?? 0);
      } else if (looksLikeStockxRef(stockxOrderNumber)) {
        const cleared = await (prisma as any).stxPurchaseUnit.updateMany({
          where: {
            galaxusOrderId: orderRef,
            stockxOrderNumber,
          },
          data: {
            stockxOrderId: null,
            stockxOrderNumber: null,
            awb: null,
            etaMin: null,
            etaMax: null,
            checkoutType: null,
            stockxSettledAmount: null,
            stockxSettledCurrency: null,
            updatedAt: new Date(),
          },
        });
        unitsUnlinked += Number(cleared?.count ?? 0);
      }
    }

    await (prisma as any).galaxusStockxMatch.delete({ where: { id: row.id } });
    matchesDeleted += 1;
  }

  let relinkedOrders = 0;
  let relinkErrors = 0;
  if (relink) {
    const refs = Array.from(impactedRefs);
    for (const ref of refs) {
      try {
        await reconcileGalaxusOrderProcurement(ref, { skipAutoLink: false });
        relinkedOrders += 1;
      } catch (error: any) {
        relinkErrors += 1;
        console.error("[causal-backfill] relink failed", ref, error?.message ?? error);
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        matchesDeleted,
        unitsUnlinked,
        relinkedOrders,
        relinkErrors,
      },
      null,
      2
    )
  );

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("[causal-backfill] fatal", error);
  await prisma.$disconnect();
  process.exit(1);
});
