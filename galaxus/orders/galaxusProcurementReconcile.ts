import { prisma } from "@/app/lib/prisma";
import { sameGtinKey } from "@/galaxus/orders/gtinKey";
import { autoLinkUnclaimedStockxBuysForGalaxusOrder } from "@/galaxus/orders/autoLinkStockxBuys";
import { repairGalaxusStockxMatchLineRefs } from "@/galaxus/orders/galaxusStockxMatchRepair";
import {
  expandGtinsForDbLookup,
  migrateLinkedStxUnitsToCurrentNeeds,
  reserveStxPurchaseUnitsForOrder,
  resolveGalaxusOrderByIdOrRef,
} from "@/galaxus/stx/purchaseUnits";
import {
  galaxusLineWarehouseStockHint,
  isGalaxusStxSupplierLine,
} from "@/galaxus/warehouse/lineInventorySource";
import { ensureLocalStockMatchesForOrder } from "@/galaxus/orders/localStockMatch";

function isUnknownCancelledAtArg(error: unknown): boolean {
  const message = String((error as any)?.message ?? "");
  return message.includes("Unknown argument `cancelledAt`");
}

async function findLinkedUnitsForOrder(galaxusOrderId: string) {
  const prismaAny = prisma as any;
  try {
    return await prismaAny.stxPurchaseUnit.findMany({
      where: {
        galaxusOrderId,
        stockxOrderId: { not: null },
        cancelledAt: null,
      },
    });
  } catch (error) {
    if (!isUnknownCancelledAtArg(error)) throw error;
    return prismaAny.stxPurchaseUnit.findMany({
      where: {
        galaxusOrderId,
        stockxOrderId: { not: null },
      },
    });
  }
}

/** Persist GalaxusStockxMatch from linked StxPurchaseUnit when UI would show linked but match row missing. */
export async function ensureGalaxusStockxMatchesFromLinkedUnits(
  order: NonNullable<Awaited<ReturnType<typeof resolveGalaxusOrderByIdOrRef>>>
) {
  const prismaAny = prisma as any;
  const linkedUnits = await findLinkedUnitsForOrder(order.galaxusOrderId);
  if (linkedUnits.length === 0) return { upserted: 0 };

  const existingMatches = await prismaAny.galaxusStockxMatch.findMany({
    where: { galaxusOrderId: order.id },
  });
  const matchesByLineId = new Map<string, any[]>();
  const usedStockxIds = new Set<string>();
  for (const m of existingMatches) {
    const lid = String(m.galaxusOrderLineId);
    const arr = matchesByLineId.get(lid) ?? [];
    arr.push(m);
    matchesByLineId.set(lid, arr);
    const claimed = String(m.stockxOrderId ?? m.stockxOrderNumber ?? "").trim();
    if (claimed) usedStockxIds.add(claimed);
  }

  let upserted = 0;
  for (const line of order.lines ?? []) {
    if (!isGalaxusStxSupplierLine(line) || galaxusLineWarehouseStockHint(line)) continue;

    const qty = Math.max(1, Math.round(Number(line.quantity ?? 1)));
    const lineMatches = matchesByLineId.get(String(line.id)) ?? [];
    const occupiedIndexes = new Set(
      lineMatches
        .filter((m: any) => String(m.stockxOrderNumber ?? "").trim())
        .map((m: any) => Number(m.unitIndex ?? 0))
    );
    const gtinKeys = expandGtinsForDbLookup([String(line.gtin ?? "")]);
    const availableUnits = linkedUnits.filter((u: any) => {
      const sid = String(u.stockxOrderId ?? u.stockxOrderNumber ?? "").trim();
      if (!sid || usedStockxIds.has(sid)) return false;
      if (gtinKeys.length === 0) return false;
      return gtinKeys.some((g) => sameGtinKey(g, String(u.gtin ?? "")));
    });

    let unitPtr = 0;
    for (let unitIndex = 0; unitIndex < qty; unitIndex++) {
      if (occupiedIndexes.has(unitIndex)) continue;
      let unit: any = null;
      while (unitPtr < availableUnits.length) {
        const candidate = availableUnits[unitPtr++];
        const sid = String(candidate.stockxOrderId ?? candidate.stockxOrderNumber ?? "").trim();
        if (!sid || usedStockxIds.has(sid)) continue;
        unit = candidate;
        break;
      }
      if (!unit) break;

      const stockxOrderNumber =
        String(unit.stockxOrderNumber ?? "").trim() || String(unit.stockxOrderId ?? "").trim();
      if (!stockxOrderNumber) continue;

      const payload = {
        galaxusOrderId: order.id,
        galaxusOrderRef: order.galaxusOrderId,
        galaxusOrderDate: order.orderDate ?? null,
        galaxusOrderLineId: line.id,
        unitIndex,
        galaxusLineNumber: line.lineNumber ?? null,
        galaxusProductName: line.productName ?? "Item",
        galaxusDescription: line.description ?? null,
        galaxusSize: line.size ?? null,
        galaxusGtin: line.gtin ?? null,
        galaxusProviderKey: line.providerKey ?? null,
        galaxusSupplierSku: line.supplierSku ?? null,
        galaxusQuantity: qty,
        galaxusUnitNetPrice: line.unitNetPrice,
        galaxusLineNetAmount: line.lineNetAmount,
        galaxusVatRate: line.vatRate,
        galaxusCurrencyCode: order.currencyCode ?? "CHF",
        stockxOrderId: unit.stockxOrderId ?? null,
        stockxOrderNumber,
        stockxVariantId: String(unit.supplierVariantId ?? "")
          .replace(/^stx_/i, "")
          .trim() || null,
        stockxAmount:
          unit.stockxSettledAmount != null && Number.isFinite(Number(unit.stockxSettledAmount))
            ? Number(unit.stockxSettledAmount)
            : null,
        stockxCurrencyCode: unit.stockxSettledCurrency ?? null,
        stockxEstimatedDelivery: unit.etaMin ?? null,
        stockxLatestEstimatedDelivery: unit.etaMax ?? null,
        stockxAwb: unit.awb ?? null,
        matchType: "DB_RECONCILE",
        matchReasons: JSON.stringify(["Linked StxPurchaseUnit persisted on order fetch"]),
      };

      await prismaAny.galaxusStockxMatch.upsert({
        where: {
          galaxusOrderLineId_unitIndex: { galaxusOrderLineId: line.id, unitIndex },
        },
        update: {
          ...payload,
          updatedAt: new Date(),
        },
        create: payload,
      });
      usedStockxIds.add(String(unit.stockxOrderId ?? stockxOrderNumber).trim());
      usedStockxIds.add(stockxOrderNumber);
      upserted += 1;
    }
  }

  return { upserted };
}

export type ReconcileGalaxusProcurementOptions = {
  /** Skip StockX auto-link (sync route runs its own linking). */
  skipAutoLink?: boolean;
};

/** Repair line refs, align linked units to current STX variant ids, reserve slots, persist matches. */
export async function reconcileGalaxusOrderProcurement(
  orderIdOrRef: string,
  options?: ReconcileGalaxusProcurementOptions
) {
  const order = await resolveGalaxusOrderByIdOrRef(orderIdOrRef);
  if (!order) return { ok: false as const, reason: "not_found" as const };

  await repairGalaxusStockxMatchLineRefs(order.id);
  const migrated = await migrateLinkedStxUnitsToCurrentNeeds(orderIdOrRef);
  await reserveStxPurchaseUnitsForOrder(orderIdOrRef);
  // Physical in-stock STX lines → LOCAL_STOCK match at ingest (before stock hits 0).
  const localStock = await ensureLocalStockMatchesForOrder({
    order,
    reason: "LOCAL_PHYSICAL_STOCK_ON_INGEST",
  });
  const autoLinked = options?.skipAutoLink
    ? { linked: 0, reason: "skipped" as const }
    : await autoLinkUnclaimedStockxBuysForGalaxusOrder(orderIdOrRef, { skipReserve: true });
  const ensured = await ensureGalaxusStockxMatchesFromLinkedUnits(order);

  return {
    ok: true as const,
    galaxusOrderId: order.galaxusOrderId,
    migratedUnits: migrated.updated,
    localStockMatches: localStock.created,
    autoLinkedBuys: autoLinked.linked,
    ensuredMatches: ensured.upserted,
  };
}
