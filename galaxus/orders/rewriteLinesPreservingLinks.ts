/**
 * ORDP line rewrite deletes GalaxusOrderLine rows → CASCADE wipes GalaxusStockxMatch /
 * GalaxusExternalBuy. Snapshot those children first and remount onto new line ids so
 * "already linked" survives price/ETA nudges (and operators do not re-buy).
 */
import { sameGtinKey } from "@/galaxus/orders/gtinKey";

type LineMeta = { id: string; lineNumber: number | null; gtin: string | null };

function pickTargetLine(
  newLines: LineMeta[],
  old: LineMeta | undefined,
  fallback: { galaxusLineNumber?: number | null; galaxusGtin?: string | null }
): LineMeta | null {
  if (newLines.length === 0) return null;
  if (old?.lineNumber != null) {
    const byNum = newLines.find((l) => l.lineNumber === old.lineNumber);
    if (byNum) return byNum;
  }
  if (fallback.galaxusLineNumber != null) {
    const byNum = newLines.find((l) => l.lineNumber === fallback.galaxusLineNumber);
    if (byNum) return byNum;
  }
  const gtin = String(old?.gtin ?? fallback.galaxusGtin ?? "").trim();
  if (gtin) {
    const byGtin = newLines.find((l) => l.gtin && sameGtinKey(String(l.gtin), gtin));
    if (byGtin) return byGtin;
  }
  return newLines.length === 1 ? newLines[0] : null;
}

function stripRowMeta<T extends Record<string, unknown>>(row: T): Omit<T, "id" | "createdAt" | "updatedAt"> {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = row as any;
  return rest;
}

export async function rewriteGalaxusOrderLinesPreservingLinks(
  tx: any,
  orderDbId: string,
  lines: Array<{
    lineNumber: number;
    supplierPid: string | null;
    buyerPid: string | null;
    orderUnit: string | null;
    supplierSku: string | null;
    supplierVariantId: string | null;
    productName: string;
    description: string | null;
    size: string | null;
    gtin: string | null;
    providerKey: string | null;
    quantity: number;
    qtyConfirmed: number | null;
    vatRate: any;
    taxAmountPerUnit: any;
    unitNetPrice: any;
    lineNetAmount: any;
    priceLineAmount: any;
    arrivalDateStart: Date | null;
    arrivalDateEnd: Date | null;
    currencyCode: string;
  }>
): Promise<{ remountedMatches: number; remountedExternalBuys: number }> {
  const existingLines: LineMeta[] = await tx.galaxusOrderLine.findMany({
    where: { orderId: orderDbId },
    select: { id: true, lineNumber: true, gtin: true },
  });
  const oldIds = existingLines.map((l) => l.id);
  const metaByOldId = new Map(existingLines.map((l) => [l.id, l]));

  const matches =
    oldIds.length > 0
      ? await tx.galaxusStockxMatch.findMany({ where: { galaxusOrderLineId: { in: oldIds } } })
      : [];
  const externalBuys =
    oldIds.length > 0
      ? await tx.galaxusExternalBuy.findMany({ where: { galaxusOrderLineId: { in: oldIds } } })
      : [];

  await tx.galaxusOrderLine.deleteMany({ where: { orderId: orderDbId } });
  await tx.galaxusOrderLine.createMany({
    data: lines.map((line) => ({
      orderId: orderDbId,
      lineNumber: line.lineNumber,
      supplierPid: line.supplierPid,
      buyerPid: line.buyerPid,
      orderUnit: line.orderUnit,
      supplierSku: line.supplierSku,
      supplierVariantId: line.supplierVariantId,
      productName: line.productName,
      description: line.description,
      size: line.size,
      gtin: line.gtin,
      providerKey: line.providerKey,
      quantity: line.quantity,
      qtyConfirmed: line.qtyConfirmed,
      vatRate: line.vatRate,
      taxAmountPerUnit: line.taxAmountPerUnit,
      unitNetPrice: line.unitNetPrice,
      lineNetAmount: line.lineNetAmount,
      priceLineAmount: line.priceLineAmount,
      arrivalDateStart: line.arrivalDateStart,
      arrivalDateEnd: line.arrivalDateEnd,
      currencyCode: line.currencyCode,
    })),
  });

  const newLines: LineMeta[] = await tx.galaxusOrderLine.findMany({
    where: { orderId: orderDbId },
    select: { id: true, lineNumber: true, gtin: true },
  });

  let remountedMatches = 0;
  for (const m of matches) {
    const old = metaByOldId.get(String(m.galaxusOrderLineId));
    const target = pickTargetLine(newLines, old, {
      galaxusLineNumber: m.galaxusLineNumber ?? null,
      galaxusGtin: m.galaxusGtin ?? null,
    });
    if (!target) continue;
    const data = stripRowMeta(m) as any;
    data.galaxusOrderLineId = target.id;
    data.galaxusLineNumber = target.lineNumber ?? data.galaxusLineNumber ?? null;
    data.galaxusOrderId = orderDbId;
    try {
      await tx.galaxusStockxMatch.create({ data });
      remountedMatches += 1;
    } catch (err: any) {
      // unique (lineId, unitIndex) collision — keep existing
      console.warn("[galaxus][ingest] remount match skipped", {
        orderId: orderDbId,
        stockxOrderNumber: m.stockxOrderNumber,
        error: err?.message ?? err,
      });
    }
  }

  let remountedExternalBuys = 0;
  for (const b of externalBuys) {
    const old = metaByOldId.get(String(b.galaxusOrderLineId));
    const target = pickTargetLine(newLines, old, {
      galaxusLineNumber: old?.lineNumber ?? null,
      galaxusGtin: old?.gtin ?? null,
    });
    if (!target) continue;
    const data = stripRowMeta(b) as any;
    data.galaxusOrderLineId = target.id;
    data.galaxusOrderId = orderDbId;
    try {
      await tx.galaxusExternalBuy.create({ data });
      remountedExternalBuys += 1;
    } catch (err: any) {
      console.warn("[galaxus][ingest] remount external buy skipped", {
        orderId: orderDbId,
        supplierOrderNumber: b.supplierOrderNumber,
        error: err?.message ?? err,
      });
    }
  }

  return { remountedMatches, remountedExternalBuys };
}
