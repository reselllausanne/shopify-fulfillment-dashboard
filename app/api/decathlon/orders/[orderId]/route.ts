import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { enrichDecathlonOrderLinesWithKickdb } from "@/decathlon/orders/kickdbLineEnrichment";
import { enrichDecathlonOrderLinesWithSupplierCatalog } from "@/decathlon/orders/supplierCatalogLineEnrichment";
import { repairDecathlonStockxMatchLineRefs } from "@/decathlon/orders/stockxMatchRepair";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const { searchParams } = new URL(request.url);
    const scope = String(searchParams.get("scope") ?? "").trim().toLowerCase();
    const partnerSession = scope === "partner" ? await getPartnerSession(request) : null;
    const partnerKey = normalizeProviderKey(partnerSession?.partnerKey ?? null);
    if (scope === "partner" && !partnerSession) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (scope === "partner" && !partnerKey) {
      return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });
    }
    const order =
      (await prisma.decathlonOrder.findUnique({
        where: { id: orderId },
        include: {
          lines: true,
          shipments: { include: { lines: true } },
          documents: true,
          stockxMatches: true,
        },
      })) ??
      (await prisma.decathlonOrder.findUnique({
        where: { orderId },
        include: {
          lines: true,
          shipments: { include: { lines: true } },
          documents: true,
          stockxMatches: true,
        },
      }));
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }
    const hasPartnerLine = partnerKey
      ? (order.lines ?? []).some((line: any) =>
          String(line.offerSku ?? "").toUpperCase().startsWith(`${partnerKey}_`)
        )
      : false;
    if (scope === "partner" && partnerKey && order.partnerKey !== partnerKey && !hasPartnerLine) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    await repairDecathlonStockxMatchLineRefs(order.id);
    const stockxMatches = await prisma.decathlonStockxMatch.findMany({
      where: { decathlonOrderId: order.id },
    });
    const orderWithMatches = { ...order, stockxMatches };

    let lines: any[] = orderWithMatches.lines ?? [];
    if (scope === "partner" && partnerKey) {
      lines = lines.filter((line: any) =>
        String(line.offerSku ?? "").toUpperCase().startsWith(`${partnerKey}_`)
      );
    }
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
      order: { ...orderWithMatches, lines: linesEnriched },
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to load order" },
      { status: 500 }
    );
  }
}
