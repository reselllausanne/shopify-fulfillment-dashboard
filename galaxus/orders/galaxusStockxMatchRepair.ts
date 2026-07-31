import { prisma } from "@/app/lib/prisma";
import { sameGtinKey } from "@/galaxus/orders/gtinKey";

/**
 * StockX rows point at GalaxusOrderLine.id. Re-attach when line id drifted but GTIN / line number still match.
 */
export async function repairGalaxusStockxMatchLineRefs(orderDbId: string) {
  const lines = await prisma.galaxusOrderLine.findMany({
    where: { orderId: orderDbId },
    select: { id: true, lineNumber: true, gtin: true },
    orderBy: [{ lineNumber: "asc" }, { id: "asc" }],
  });
  if (lines.length === 0) return;

  const lineIds = new Set(lines.map((l) => l.id));
  const matches = await (prisma as any).galaxusStockxMatch.findMany({
    where: { galaxusOrderId: orderDbId },
  });

  for (const m of matches) {
    if (lineIds.has(m.galaxusOrderLineId)) continue;

    const gtin = String(m.galaxusGtin ?? "").trim();
    let target =
      lines.length === 1
        ? lines[0]
        : gtin
          ? lines.find((l) => l.gtin && sameGtinKey(String(l.gtin), gtin)) ?? null
          : null;

    if (!target) {
      target =
        lines.length === 1
          ? lines[0]
          : lines.find(
              (l) =>
                l.lineNumber != null &&
                m.galaxusLineNumber != null &&
                l.lineNumber === m.galaxusLineNumber
            ) ?? null;
    }

    if (!target) continue;

    const existingOnTarget = await (prisma as any).galaxusStockxMatch.findUnique({
      where: {
        galaxusOrderLineId_unitIndex: {
          galaxusOrderLineId: target.id,
          unitIndex: Number(m.unitIndex ?? 0),
        },
      },
    });
    if (existingOnTarget && existingOnTarget.id !== m.id) continue;

    try {
      await (prisma as any).galaxusStockxMatch.update({
        where: { id: m.id },
        data: { galaxusOrderLineId: target.id },
      });
    } catch {
      // race / unique constraint
    }
  }
}
