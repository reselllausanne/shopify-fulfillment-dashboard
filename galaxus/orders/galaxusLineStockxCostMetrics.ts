import { prisma } from "@/app/lib/prisma";
import { getStxLinkStatusForOrder } from "@/galaxus/stx/purchaseUnits";
import { attachProcurementToLines } from "@/galaxus/orders/lineProcurement";

/**
 * Same StockX COGS resolution as Galaxus order API / warehouse UI (`attachProcurementToLines`),
 * batched for margin metrics.
 */
export async function galaxusLineStockxCostChfByLineId(
  lines: Array<{
    id: string;
    orderId: string;
    order?: { galaxusOrderId?: string | null } | null;
    [key: string]: unknown;
  }>
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!lines.length) return out;

  const lineIds = lines.map((l) => l.id);
  const prismaAny = prisma as any;
  const matches = await prismaAny.galaxusStockxMatch.findMany({
    where: { galaxusOrderLineId: { in: lineIds } },
    orderBy: { updatedAt: "desc" },
  });

  const refs = [
    ...new Set(lines.map((l) => String(l.order?.galaxusOrderId ?? "").trim()).filter(Boolean)),
  ] as string[];

  const stxUnits =
    refs.length > 0
      ? await prismaAny.stxPurchaseUnit.findMany({
          where: { galaxusOrderId: { in: refs } },
          orderBy: { updatedAt: "desc" },
          select: {
            galaxusOrderId: true,
            gtin: true,
            supplierVariantId: true,
            stockxOrderId: true,
            stockxOrderNumber: true,
            stockxSettledAmount: true,
            stockxSettledCurrency: true,
            awb: true,
            cancelledAt: true,
          },
        })
      : [];

  const unitsByRef = new Map<string, any[]>();
  for (const u of stxUnits) {
    const r = String(u.galaxusOrderId ?? "").trim();
    if (!r) continue;
    const arr = unitsByRef.get(r) ?? [];
    arr.push(u);
    unitsByRef.set(r, arr);
  }

  const stxByRef = new Map<string, Awaited<ReturnType<typeof getStxLinkStatusForOrder>> | null>();
  await Promise.all(
    refs.map((ref) =>
      getStxLinkStatusForOrder(ref)
        .then((s) => {
          stxByRef.set(ref, s);
        })
        .catch(() => {
          stxByRef.set(ref, null);
        })
    )
  );

  const linesByOrderId = new Map<string, typeof lines>();
  for (const line of lines) {
    const oid = String(line.orderId);
    const arr = linesByOrderId.get(oid) ?? [];
    arr.push(line);
    linesByOrderId.set(oid, arr);
  }

  for (const [, olines] of linesByOrderId) {
    const ref = String(olines[0]?.order?.galaxusOrderId ?? "").trim();
    if (!ref) continue;
    const st = stxByRef.get(ref) ?? null;
    const units = unitsByRef.get(ref) ?? [];
    const lidSet = new Set(olines.map((l) => l.id));
    const omatches = (matches as any[]).filter((m) => lidSet.has(String(m.galaxusOrderLineId ?? "")));
    const enriched = attachProcurementToLines(olines as any[], st, omatches, units);
    for (const row of enriched) {
      const c = row.procurement?.stockxCostChf;
      if (c != null && Number.isFinite(Number(c)) && Number(c) > 0) {
        out.set(String(row.id), Number(c));
      }
    }
  }

  return out;
}
