import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { enrichDecathlonOrderLinesWithKickdb } from "@/decathlon/orders/kickdbLineEnrichment";
import { enrichDecathlonOrderLinesWithSupplierCatalog } from "@/decathlon/orders/supplierCatalogLineEnrichment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const order =
      (await prisma.decathlonOrder.findUnique({
        where: { id: orderId },
        include: {
          lines: true,
          shipments: true,
          documents: true,
          stockxMatches: true,
        },
      })) ??
      (await prisma.decathlonOrder.findUnique({
        where: { orderId },
        include: {
          lines: true,
          shipments: true,
          documents: true,
          stockxMatches: true,
        },
      }));
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    const lines = order.lines ?? [];
    const [kickdbByLineId, catalogByLineId] = await Promise.all([
      enrichDecathlonOrderLinesWithKickdb(lines),
      enrichDecathlonOrderLinesWithSupplierCatalog(lines),
    ]);
    const linesEnriched = lines.map((line: { id: string }) => ({
      ...line,
      kickdb: kickdbByLineId.get(line.id) ?? null,
      catalog: catalogByLineId.get(line.id) ?? null,
    }));

    return NextResponse.json({
      ok: true,
      order: { ...order, lines: linesEnriched },
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to load order" },
      { status: 500 }
    );
  }
}
