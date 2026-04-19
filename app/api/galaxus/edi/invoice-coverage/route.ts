import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getInvoicedQuantitiesByOrderLineId } from "@/galaxus/edi/invoiceCoverage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const orderIdRaw = String(searchParams.get("orderId") ?? "").trim();
    if (!orderIdRaw) {
      return NextResponse.json({ ok: false, error: "orderId is required" }, { status: 400 });
    }

    const order =
      (await prisma.galaxusOrder.findUnique({
        where: { id: orderIdRaw },
        select: { id: true },
      })) ??
      (await prisma.galaxusOrder.findUnique({
        where: { galaxusOrderId: orderIdRaw },
        select: { id: true },
      }));
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    const lines = await prisma.galaxusOrderLine.findMany({
      where: { orderId: order.id },
      select: {
        id: true,
        quantity: true,
        lineNumber: true,
        buyerPid: true,
        supplierPid: true,
        gtin: true,
      },
    });
    const invoiced = await getInvoicedQuantitiesByOrderLineId(order.id, lines as any);

    const coverage: Record<string, { ordered: number; invoiced: number }> = {};
    for (const line of lines) {
      const ordered = Number(line.quantity);
      const orderedQty = Number.isFinite(ordered) ? ordered : 0;
      const done = invoiced.get(line.id) ?? 0;
      coverage[line.id] = { ordered: orderedQty, invoiced: done };
    }

    return NextResponse.json({ ok: true, coverage });
  } catch (error: any) {
    console.error("[GALAXUS][EDI][INVOICE-COVERAGE] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed" }, { status: 500 });
  }
}
