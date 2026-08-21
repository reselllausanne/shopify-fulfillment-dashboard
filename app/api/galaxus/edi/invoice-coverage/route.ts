import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getInvoicedQuantitiesByOrderLineId } from "@/galaxus/edi/invoiceCoverage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INVOICE_COVERAGE_TTL_MS = 60_000;
const invoiceCoverageCache = new Map<string, { at: number; body: unknown }>();
const invoiceCoverageInflight = new Map<string, Promise<unknown>>();

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

    const cacheKey = order.id;
    const cached = invoiceCoverageCache.get(cacheKey);
    if (cached && Date.now() - cached.at < INVOICE_COVERAGE_TTL_MS) {
      return NextResponse.json(cached.body);
    }
    const pending = invoiceCoverageInflight.get(cacheKey);
    if (pending) {
      const body = await pending;
      return NextResponse.json(body);
    }

    const run = (async () => {
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

      return { ok: true, coverage };
    })();
    invoiceCoverageInflight.set(cacheKey, run);
    try {
      const body = await run;
      invoiceCoverageCache.set(cacheKey, { at: Date.now(), body });
      return NextResponse.json(body);
    } finally {
      invoiceCoverageInflight.delete(cacheKey);
    }
  } catch (error: any) {
    console.error("[GALAXUS][EDI][INVOICE-COVERAGE] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed" }, { status: 500 });
  }
}
