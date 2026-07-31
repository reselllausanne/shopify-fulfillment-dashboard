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
async function ensureGalaxusStockxMatchesFromLinkedUnits(
  order: NonNullable<Awaited<ReturnType<typeof resolveGalaxusOrderByIdOrRef>>>
) {
  const prismaAny = prisma as any;
  const linkedUnits = await findLinkedUnitsForOrder(order.galaxusOrderId);
  if (linkedUnits.length === 0) return { upserted: 0 };

  const existingMatches = await prismaAny.galaxusStockxMatch.findMany({
    where: { galaxusOrderId: order.id },
  });
  const matchByLineId = new Map<string, any>();
  for (const m of existingMatches) {
    matchByLineId.set(String(m.galaxusOrderLineId), m);
  }

  let upserted = 0;
  for (const line of order.lines ?? []) {
    if (!isGalaxusStxSupplierLine(line) || galaxusLineWarehouseStockHint(line)) continue;

    const existing = matchByLineId.get(String(line.id));
    if (existing && String(existing.stockxOrderNumber ?? "").trim()) continue;

    const gtinKeys = expandGtinsForDbLookup([String(line.gtin ?? "")]);
    const unit =
      linkedUnits.find(
        (u: any) =>
          gtinKeys.length > 0 &&
          gtinKeys.some((g) => sameGtinKey(g, String(u.gtin ?? ""))) &&
          String(u.stockxOrderId ?? "").trim()
      ) ?? null;

    if (!unit) continue;

    const stockxOrderNumber =
      String(unit.stockxOrderNumber ?? "").trim() || String(unit.stockxOrderId ?? "").trim();
    if (!stockxOrderNumber) continue;

    const qty = Math.max(1, Math.round(Number(line.quantity ?? 1)));
    const payload = {
      galaxusOrderId: order.id,
      galaxusOrderRef: order.galaxusOrderId,
      galaxusOrderDate: order.orderDate ?? null,
      galaxusOrderLineId: line.id,
      unitIndex: 0,
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
      stockxAwb: unit.awb ?? null,
      matchType: "DB_RECONCILE",
      matchReasons: JSON.stringify(["Linked StxPurchaseUnit persisted on order fetch"]),
    };

    await prismaAny.galaxusStockxMatch.upsert({
      where: {
        galaxusOrderLineId_unitIndex: { galaxusOrderLineId: line.id, unitIndex: 0 },
      },
      update: {
        ...payload,
        updatedAt: new Date(),
      },
      create: payload,
    });
    upserted += 1;
    matchByLineId.set(String(line.id), payload);
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
  const autoLinked = options?.skipAutoLink
    ? { linked: 0, reason: "skipped" as const }
    : await autoLinkUnclaimedStockxBuysForGalaxusOrder(orderIdOrRef, { skipReserve: true });
  const ensured = await ensureGalaxusStockxMatchesFromLinkedUnits(order);

  return {
    ok: true as const,
    galaxusOrderId: order.galaxusOrderId,
    migratedUnits: migrated.updated,
    autoLinkedBuys: autoLinked.linked,
    ensuredMatches: ensured.upserted,
  };
}
