import { prisma } from "@/app/lib/prisma";

export type AvailableLocalStockLot = {
  sku: string;
  lotId: string;
  qtyAvailable: number;
  unitCostChf: number;
  costBasis: string;
  origin: string;
  locationId: string;
  locationName: string;
  enteredAt: string;
};

type LocalStockPrisma = {
  localStockLot: {
    findMany: (args: any) => Promise<
      Array<{
        id: string;
        sku: string | null;
        qtyAvailable: number;
        unitCostChf: unknown;
        costBasis: unknown;
        origin: unknown;
        locationId: string;
        locationName: string;
        enteredAt: Date | string;
      }>
    >;
  };
};

export function normalizeLocalStockSkus(skus: unknown): string[] {
  if (!Array.isArray(skus)) return [];
  return Array.from(
    new Set(
      skus
        .map((sku) => String(sku ?? "").trim())
        .filter(Boolean)
    )
  );
}

export async function getAvailableLocalStockLotsBySku(
  skusInput: unknown,
  prismaClient: LocalStockPrisma = prisma
): Promise<AvailableLocalStockLot[]> {
  const skus = normalizeLocalStockSkus(skusInput);
  if (skus.length === 0) return [];

  const rows = await prismaClient.localStockLot.findMany({
    where: {
      sku: { in: skus },
      status: "OPEN",
      qtyAvailable: { gt: 0 },
    },
    orderBy: [{ enteredAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      sku: true,
      qtyAvailable: true,
      unitCostChf: true,
      costBasis: true,
      origin: true,
      locationId: true,
      locationName: true,
      enteredAt: true,
    },
  });

  const bestBySku = new Map<string, AvailableLocalStockLot>();
  for (const row of rows) {
    const sku = String(row.sku ?? "").trim();
    if (!sku || bestBySku.has(sku)) continue;
    bestBySku.set(sku, {
      sku,
      lotId: row.id,
      qtyAvailable: Math.max(0, Math.trunc(Number(row.qtyAvailable) || 0)),
      unitCostChf: Number(row.unitCostChf) || 0,
      costBasis: String(row.costBasis),
      origin: String(row.origin),
      locationId: row.locationId,
      locationName: row.locationName,
      enteredAt:
        row.enteredAt instanceof Date
          ? row.enteredAt.toISOString()
          : new Date(row.enteredAt).toISOString(),
    });
  }

  return skus.flatMap((sku) => {
    const lot = bestBySku.get(sku);
    return lot ? [lot] : [];
  });
}
