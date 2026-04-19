import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getStxLinkStatusForOrder } from "@/galaxus/stx/purchaseUnits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveOrder(orderIdOrRef: string) {
  return (
    (await prisma.galaxusOrder.findUnique({
      where: { id: orderIdOrRef },
      include: { lines: true },
    })) ??
    (await prisma.galaxusOrder.findUnique({
      where: { galaxusOrderId: orderIdOrRef },
      include: { lines: true },
    }))
  );
}

/** True if line is procurement-linked (match row or STX unit linked for this GTIN). */
async function isLineLinked(order: { id: string; galaxusOrderId: string }, line: { id: string; gtin: string | null }) {
  const match = await (prisma as any).galaxusStockxMatch.findFirst({
    where: { galaxusOrderLineId: line.id },
    select: { stockxOrderNumber: true },
  });
  if (match && String(match.stockxOrderNumber ?? "").trim()) return true;

  const gtin = String(line.gtin ?? "").trim();
  if (!gtin) return false;

  const stx = await getStxLinkStatusForOrder(order.galaxusOrderId).catch(() => null);
  const bucket = stx?.buckets?.find((b: any) => String(b?.gtin ?? "") === gtin);
  if (bucket && Number(bucket.needed) > 0 && Number(bucket.linked) >= Number(bucket.needed)) return true;

  return false;
}

/**
 * Mark a single order line as shipped in the warehouse (persisted).
 * Only allowed when the line is procurement-linked and not already marked.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orderId: string; lineId: string }> }
) {
  try {
    const { orderId, lineId } = await params;
    const order = await resolveOrder(orderId);
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }
    const line = (order.lines ?? []).find((l: any) => l.id === lineId);
    if (!line) {
      return NextResponse.json({ ok: false, error: "Line not found" }, { status: 404 });
    }
    if ((line as any).warehouseMarkedShippedAt) {
      return NextResponse.json({ ok: false, error: "Already marked shipped" }, { status: 409 });
    }

    const linked = await isLineLinked(order as any, line as any);
    if (!linked) {
      return NextResponse.json(
        { ok: false, error: "Line must be linked (StockX sync or manual match) before marking shipped" },
        { status: 400 }
      );
    }

    const updated = await prisma.galaxusOrderLine.update({
      where: { id: lineId },
      data: { warehouseMarkedShippedAt: new Date() },
      select: { id: true, warehouseMarkedShippedAt: true },
    });

    return NextResponse.json({
      ok: true,
      line: {
        id: updated.id,
        warehouseMarkedShippedAt: updated.warehouseMarkedShippedAt?.toISOString() ?? null,
      },
    });
  } catch (error: any) {
    console.error("[GALAXUS][LINE_WAREHOUSE_SHIPPED]", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed" }, { status: 500 });
  }
}
