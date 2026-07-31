import { prisma } from "@/app/lib/prisma";

export type ResellFromReturnedStockInput = {
  shopifySku?: string | null;
  shopifyLineItemId: string;
  shopifyOrderId: string;
  revenue: number;
  supplierCost: number;
  skipWhenManualCost?: boolean;
};

export type ResellFromReturnedStockResult = {
  supplierCost: number;
  manualCostOverride: number;
  marginAmount: number;
  marginPercent: number;
  consumedReturnMatchId: string;
  manualNote: string;
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

export async function tryApplyResellFromReturnedStock(
  input: ResellFromReturnedStockInput
): Promise<ResellFromReturnedStockResult | null> {
  if (input.skipWhenManualCost) return null;

  const sku = normalizeSku(input.shopifySku);
  if (!sku) return null;
  if (!(input.supplierCost > 0)) return null;

  const source = await prisma.orderMatch.findFirst({
    where: {
      shopifySku: sku,
      returnReason: { not: null },
      returnedStockValueChf: { gt: 0 },
      shopifyLineItemId: { not: input.shopifyLineItemId },
      shopifyOrderId: { not: input.shopifyOrderId },
    },
    orderBy: [{ returnAppliedAt: "asc" }, { updatedAt: "asc" }],
    select: {
      id: true,
      shopifyOrderName: true,
      manualNote: true,
      returnedStockValueChf: true,
    },
  });

  if (!source) return null;

  const revenue = Number(input.revenue) || 0;
  const marginAmount = revenue;
  const marginPercent = revenue > 0 ? clampDecimal(100) : 0;
  const resellNote = `Resold from return on ${source.shopifyOrderName}; cost already counted on original return line.`;
  const consumedNote = "Returned stock consumed by subsequent resell.";

  await prisma.orderMatch.update({
    where: { id: source.id },
    data: {
      returnedStockValueChf: 0,
      manualNote: source.manualNote ? `${source.manualNote}\n${consumedNote}` : consumedNote,
      updatedAt: new Date(),
    },
  });

  return {
    supplierCost: 0,
    manualCostOverride: 0,
    marginAmount,
    marginPercent,
    consumedReturnMatchId: source.id,
    manualNote: resellNote,
  };
}
