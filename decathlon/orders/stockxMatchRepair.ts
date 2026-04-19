import { prisma } from "@/app/lib/prisma";

/**
 * StockX rows point at DecathlonOrderLine.id. If Mirakl changes a line identifier, a new line row
 * can be created while the match still references the old line. Re-attach when unambiguous.
 */
export async function repairDecathlonStockxMatchLineRefs(orderDbId: string) {
  const lines = await prisma.decathlonOrderLine.findMany({
    where: { orderId: orderDbId },
    select: { id: true, lineNumber: true },
    orderBy: [{ lineNumber: "asc" }, { id: "asc" }],
  });
  if (lines.length === 0) return;

  const lineIds = new Set(lines.map((l) => l.id));
  const matches = await prisma.decathlonStockxMatch.findMany({
    where: { decathlonOrderId: orderDbId },
  });

  for (const m of matches) {
    if (lineIds.has(m.decathlonOrderLineId)) continue;

    const target =
      lines.length === 1
        ? lines[0]
        : lines.find(
            (l) =>
              l.lineNumber != null &&
              m.decathlonLineNumber != null &&
              l.lineNumber === m.decathlonLineNumber
          ) ?? null;

    if (!target) continue;

    const existingOnTarget = await prisma.decathlonStockxMatch.findUnique({
      where: { decathlonOrderLineId: target.id },
    });
    if (existingOnTarget && existingOnTarget.id !== m.id) continue;

    try {
      await prisma.decathlonStockxMatch.update({
        where: { id: m.id },
        data: { decathlonOrderLineId: target.id },
      });
    } catch {
      // e.g. race / unique constraint
    }
  }
}
