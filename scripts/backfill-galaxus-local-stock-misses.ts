/**
 * Backfill LOCAL_STOCK for Galaxus STX lines that missed the warehouse detection
 * race (physical sale decremented Shopify before LOCAL_STOCK match was written).
 *
 * Safe criteria only (do NOT mark pending StockX buys as local):
 * 1. Live physical mirror qty > 0
 * 2. warehouseMarkedShippedAt and no linked StockX unit
 * 3. In-stock fixed-price lane (Essentials / Bape / AP / boxers)
 * Not used: InventoryEvent + mirror@0 — too many dropship STX sales share that fingerprint.
 *
 * Usage:
 *   npx tsx scripts/backfill-galaxus-local-stock-misses.ts --dry-run
 *   npx tsx scripts/backfill-galaxus-local-stock-misses.ts --apply --days=90
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import {
  ensureLocalStockMatchesForOrder,
  isLocalStockMatchRow,
  upsertGalaxusLocalStockMatch,
} from "@/galaxus/orders/localStockMatch";
import { isGalaxusStxSupplierLine } from "@/galaxus/warehouse/lineInventorySource";
import {
  attachPhysicalStockToLines,
  buildPhysicalStockByGtinMap,
} from "@/shopify/inventory/orderLinePhysicalStock";
import { PHYSICAL_LOCATIONS } from "@/shopify/inventory/locationConfig";

const APPLY = process.argv.includes("--apply");
const daysArg = process.argv.find((a) => a.startsWith("--days="));
const DAYS = Math.max(1, Number(daysArg?.split("=")[1] ?? 90) || 90);

type Candidate = {
  orderPk: string;
  galaxusOrderId: string;
  lineId: string;
  lineNumber: number;
  gtin: string | null;
  providerKey: string | null;
  productName: string | null;
  recipientName: string | null;
  orderDate: Date | null;
  warehouseShipped: boolean;
  hasInventoryEvent: boolean;
  mirrorUpdatedNearEvent: boolean;
  livePhysicalQty: number;
  preferredLocationName: string | null;
  preferredLocationId: string | null;
  reason: string;
};

function isLikelyStockxRef(value: unknown): boolean {
  const ref = String(value ?? "").trim();
  if (!ref) return false;
  if (/^LOCAL-STOCK-/i.test(ref) || /^MANUAL-/i.test(ref)) return false;
  // StockX order numbers are typically alphanumeric with dashes, not LOCAL-
  return ref.length >= 4;
}

async function main() {
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  console.log(`[backfill-local-stock] since=${since.toISOString()} apply=${APPLY}`);

  const orders = await prisma.galaxusOrder.findMany({
    where: {
      cancelledAt: null,
      archivedAt: null,
      orderDate: { gte: since },
    },
    select: {
      id: true,
      galaxusOrderId: true,
      orderDate: true,
      currencyCode: true,
      recipientName: true,
      createdAt: true,
      lines: {
        select: {
          id: true,
          lineNumber: true,
          gtin: true,
          providerKey: true,
          supplierSku: true,
          supplierVariantId: true,
          supplierPid: true,
          productName: true,
          description: true,
          size: true,
          quantity: true,
          unitNetPrice: true,
          lineNetAmount: true,
          vatRate: true,
          warehouseMarkedShippedAt: true,
        },
      },
    },
    orderBy: { orderDate: "desc" },
  });

  const orderIds = orders.map((o) => o.id);
  const orderRefs = orders.map((o) => o.galaxusOrderId);

  const [matches, stxUnits, invEvents] = await Promise.all([
    (prisma as any).galaxusStockxMatch.findMany({
      where: { galaxusOrderId: { in: orderIds } },
      select: {
        galaxusOrderId: true,
        galaxusOrderLineId: true,
        matchType: true,
        stockxStatus: true,
        stockxOrderNumber: true,
        stockxOrderId: true,
      },
    }),
    (prisma as any).stxPurchaseUnit.findMany({
      where: {
        galaxusOrderId: { in: orderRefs },
        stockxOrderId: { not: null },
        cancelledAt: null,
      },
      select: { galaxusOrderId: true, gtin: true },
    }),
    prisma.inventoryEvent.findMany({
      where: {
        channel: "GALAXUS",
        eventType: "SALE",
        externalOrderId: { in: orderRefs },
      },
      select: {
        externalOrderId: true,
        externalLineId: true,
        occurredAt: true,
      },
    }),
  ]);

  const matchByLine = new Map<string, any>();
  for (const m of matches) matchByLine.set(String(m.galaxusOrderLineId), m);

  const linkedUnitKeys = new Set(
    stxUnits.map((u: any) => `${u.galaxusOrderId}::${String(u.gtin ?? "").trim()}`)
  );

  const invByExternalLine = new Map<string, Date>();
  for (const e of invEvents) {
    const key = String(e.externalLineId ?? "").trim();
    if (key) invByExternalLine.set(key, e.occurredAt);
  }

  const allGtins = Array.from(
    new Set(
      orders.flatMap((o) => o.lines.map((l) => String(l.gtin ?? "").trim()).filter(Boolean))
    )
  );
  const physicalByGtin = await buildPhysicalStockByGtinMap(allGtins);

  const physicalLocIds = new Set(PHYSICAL_LOCATIONS.map((l) => l.id));
  const mirrorRows =
    allGtins.length === 0
      ? []
      : await prisma.shopifyVariantLocationStock.findMany({
          where: {
            gtin: { in: allGtins },
            locationId: { in: Array.from(physicalLocIds) },
          },
          select: {
            gtin: true,
            locationId: true,
            locationName: true,
            available: true,
            updatedAt: true,
            priority: true,
          },
        });

  const mirrorByGtin = new Map<
    string,
    Array<{ locationId: string; locationName: string; available: number; updatedAt: Date; priority: number }>
  >();
  for (const row of mirrorRows) {
    const g = String(row.gtin ?? "").trim();
    if (!g) continue;
    const arr = mirrorByGtin.get(g) ?? [];
    arr.push({
      locationId: row.locationId,
      locationName: row.locationName,
      available: Number(row.available ?? 0),
      updatedAt: row.updatedAt,
      priority: Number(row.priority ?? 99),
    });
    mirrorByGtin.set(g, arr);
  }

  const candidates: Candidate[] = [];

  for (const order of orders) {
    const linesWithPhysical = attachPhysicalStockToLines(order.lines, physicalByGtin);
    for (const line of linesWithPhysical) {
      if (!isGalaxusStxSupplierLine(line)) continue;
      const lineId = String(line.id);
      const match = matchByLine.get(lineId);
      if (match && isLocalStockMatchRow(match)) continue;
      if (match && (String(match.stockxOrderId ?? "").trim() || isLikelyStockxRef(match.stockxOrderNumber))) {
        continue;
      }

      const gtin = String(line.gtin ?? "").trim();
      if (gtin && linkedUnitKeys.has(`${order.galaxusOrderId}::${gtin}`)) continue;

      const externalLineId = `GALAXUS:${order.galaxusOrderId}:${line.lineNumber}`;
      const invAt = invByExternalLine.get(externalLineId) ?? null;
      const live = line.physicalStock;
      const liveQty = Number(live?.qty ?? 0);
      const warehouseShipped = Boolean(line.warehouseMarkedShippedAt);
      const mirrors = gtin ? mirrorByGtin.get(gtin) ?? [] : [];
      const physicalTotal = mirrors.reduce((s, r) => s + Math.max(0, r.available), 0);
      const latestMirrorAt = mirrors.reduce(
        (max, r) => (r.updatedAt > max ? r.updatedAt : max),
        new Date(0)
      );

      // Prefer live stock location; else best mirror row that currently holds qty.
      const liveLoc =
        live && live.qty > 0
          ? { name: live.locationName, id: live.locationId }
          : null;
      const positiveMirror = mirrors
        .filter((r) => r.available > 0)
        .sort((a, b) => a.priority - b.priority)[0];
      const preferred = liveLoc
        ? liveLoc
        : positiveMirror
          ? { name: positiveMirror.locationName, id: positiveMirror.locationId }
          : { name: null as string | null, id: null as string | null };

      let reason: string | null = null;
      if (liveQty > 0) reason = "LIVE_PHYSICAL";
      else if (warehouseShipped) reason = "WAREHOUSE_SHIPPED";

      // Fixed-price lane handled via ensureLocalStockMatchesForOrder below.
      if (!reason) continue;

      candidates.push({
        orderPk: order.id,
        galaxusOrderId: order.galaxusOrderId,
        lineId,
        lineNumber: line.lineNumber,
        gtin: line.gtin,
        providerKey: line.providerKey,
        productName: line.productName,
        recipientName: order.recipientName,
        orderDate: order.orderDate,
        warehouseShipped,
        hasInventoryEvent: Boolean(invAt),
        mirrorUpdatedNearEvent: false,
        livePhysicalQty: liveQty,
        preferredLocationName: preferred.name,
        preferredLocationId: preferred.id,
        reason,
      });
    }
  }

  console.log(`[backfill-local-stock] candidates=${candidates.length}`);
  for (const c of candidates.slice(0, 40)) {
    console.log(
      `  ${c.galaxusOrderId} line=${c.lineNumber} ${c.reason} gtin=${c.gtin} loc=${c.preferredLocationName ?? "—"} · ${c.productName}`
    );
  }
  if (candidates.length > 40) console.log(`  … +${candidates.length - 40} more`);

  // Always run ensureLocal across recent orders (fixed-price lane + live qty + shipped).
  let ensureCreated = 0;
  let ensureUpdated = 0;
  for (const order of orders) {
    if (!APPLY) continue;
    const res = await ensureLocalStockMatchesForOrder({
      order,
      reason: "LOCAL_PHYSICAL_STOCK_BACKFILL_ENSURE",
    });
    ensureCreated += res.created;
    ensureUpdated += res.updated;
  }
  console.log(
    `[backfill-local-stock] ensureLocal created=${ensureCreated} updated=${ensureUpdated} (apply=${APPLY})`
  );

  let written = 0;
  for (const c of candidates) {
    if (!APPLY) continue;
    // Skip if ensureLocal already created a match.
    const existing = await (prisma as any).galaxusStockxMatch.findFirst({
      where: { galaxusOrderLineId: c.lineId, unitIndex: 0 },
      select: { matchType: true, stockxStatus: true, stockxOrderNumber: true, stockxOrderId: true },
    });
    if (existing && isLocalStockMatchRow(existing)) continue;
    if (existing && (String(existing.stockxOrderId ?? "").trim() || isLikelyStockxRef(existing.stockxOrderNumber))) {
      continue;
    }

    const order = orders.find((o) => o.id === c.orderPk);
    const line = order?.lines.find((l) => l.id === c.lineId);
    if (!order || !line) continue;

    await upsertGalaxusLocalStockMatch({
      order,
      line,
      stockxAmount: 0,
      reason: `LOCAL_PHYSICAL_STOCK_BACKFILL:${c.reason}`,
      locationName: c.preferredLocationName,
      locationId: c.preferredLocationId,
    });
    written += 1;
  }

  console.log(`[backfill-local-stock] candidate upserts=${written} apply=${APPLY}`);
  if (!APPLY) console.log("[backfill-local-stock] dry-run only — re-run with --apply to write");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
