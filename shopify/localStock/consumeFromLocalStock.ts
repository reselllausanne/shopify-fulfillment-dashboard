import { prisma } from "@/app/lib/prisma";

export type ConsumeLocalStockInput = {
  shopifySku?: string | null;
  shopifyVariantId?: string | null;
  /** Prefer this lot when set (manual override). */
  lotId?: string | null;
  revenue: number;
  quantity?: number;
};

export type ConsumeLocalStockResult = {
  lotId: string;
  shopifyVariantId: string;
  inventoryItemId: string | null;
  sku: string | null;
  gtin: string | null;
  unitCostChf: number;
  costBasis: string;
  origin: string;
  locationId: string;
  locationName: string;
  sourceOrderMatchId: string | null;
  supplierCost: number;
  manualCostOverride: number | null;
  marginAmount: number;
  marginPercent: number;
  manualNote: string;
  stockxStatus: "LOCAL_STOCK";
  supplierSource: "LOCAL";
};

function clampDecimal(value: number, maxAbs = 999.99): number {
  if (!Number.isFinite(value)) return 0;
  if (value > maxAbs) return maxAbs;
  if (value < -maxAbs) return -maxAbs;
  return Math.round(value * 100) / 100;
}

function normalizeSku(value: string | null | undefined): string | null {
  const sku = String(value || "").trim();
  return sku || null;
}

/**
 * Consume 1 unit from an OPEN local stock lot (FIFO by enteredAt).
 * Transactional: two concurrent sales cannot take the same last unit.
 * Also clears returnedStockValueChf on the source return match when present.
 */
export async function tryConsumeLocalStockLot(
  input: ConsumeLocalStockInput
): Promise<ConsumeLocalStockResult | null> {
  const qty = Math.max(1, Math.trunc(input.quantity ?? 1));
  if (qty !== 1) {
    // Step 3: one unit per OrderMatch line. Multi-qty later.
    return null;
  }

  const sku = normalizeSku(input.shopifySku);
  const variantId = String(input.shopifyVariantId ?? "").trim() || null;
  const preferredLotId = String(input.lotId ?? "").trim() || null;
  if (!preferredLotId && !sku && !variantId) return null;

  return prisma.$transaction(async (tx) => {
    const lot = preferredLotId
      ? await tx.localStockLot.findFirst({
          where: { id: preferredLotId, status: "OPEN", qtyAvailable: { gt: 0 } },
        })
      : await tx.localStockLot.findFirst({
          where: {
            status: "OPEN",
            qtyAvailable: { gt: 0 },
            OR: [
              ...(sku ? [{ sku }] : []),
              ...(variantId ? [{ shopifyVariantId: variantId }] : []),
            ],
          },
          orderBy: [{ enteredAt: "asc" }, { createdAt: "asc" }],
        });

    if (!lot) return null;

    const updated = await tx.localStockLot.updateMany({
      where: { id: lot.id, qtyAvailable: { gte: 1 }, status: "OPEN" },
      data: {
        qtyAvailable: { decrement: 1 },
        qtySold: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (updated.count !== 1) return null;

    const after = await tx.localStockLot.findUnique({
      where: { id: lot.id },
      select: {
        id: true,
        shopifyVariantId: true,
        inventoryItemId: true,
        gtin: true,
        unitCostChf: true,
        costBasis: true,
        origin: true,
        locationId: true,
        locationName: true,
        sourceOrderMatchId: true,
        qtyAvailable: true,
        sku: true,
      },
    });
    if (!after) return null;

    if (after.qtyAvailable <= 0) {
      await tx.localStockLot.update({
        where: { id: after.id },
        data: { status: "DEPLETED", qtyAvailable: 0, updatedAt: new Date() },
      });
    }

    if (after.sourceOrderMatchId) {
      const source = await tx.orderMatch.findUnique({
        where: { id: after.sourceOrderMatchId },
        select: { id: true, manualNote: true, returnedStockValueChf: true, shopifyOrderName: true },
      });
      if (source && source.returnedStockValueChf != null && Number(source.returnedStockValueChf) > 0) {
        const consumedNote = "Returned stock consumed by local-stock resell.";
        await tx.orderMatch.update({
          where: { id: source.id },
          data: {
            returnedStockValueChf: 0,
            manualNote: source.manualNote ? `${source.manualNote}\n${consumedNote}` : consumedNote,
            updatedAt: new Date(),
          },
        });
      }
    }

    const unitCost = Number(after.unitCostChf) || 0;
    const supplierCost = after.costBasis === "ALREADY_EXPENSED" ? 0 : unitCost;
    const revenue = Number(input.revenue) || 0;
    const marginAmount = clampDecimal(revenue - supplierCost);
    const marginPercent = revenue > 0 ? clampDecimal((marginAmount / revenue) * 100) : 0;
    const sourceLabel = after.sourceOrderMatchId
      ? `sourceMatch=${after.sourceOrderMatchId}`
      : "no source match";
    const manualNote = `Local stock lot ${after.id} (${after.origin}, ${sourceLabel}).`;

    return {
      lotId: after.id,
      shopifyVariantId: after.shopifyVariantId,
      inventoryItemId: after.inventoryItemId,
      sku: after.sku,
      gtin: after.gtin,
      unitCostChf: unitCost,
      costBasis: String(after.costBasis),
      origin: String(after.origin),
      locationId: after.locationId,
      locationName: after.locationName,
      sourceOrderMatchId: after.sourceOrderMatchId,
      supplierCost,
      manualCostOverride: after.costBasis === "ALREADY_EXPENSED" ? 0 : null,
      marginAmount,
      marginPercent,
      manualNote,
      stockxStatus: "LOCAL_STOCK" as const,
      supplierSource: "LOCAL" as const,
    };
  });
}
