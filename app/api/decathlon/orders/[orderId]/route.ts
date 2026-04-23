import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { enrichDecathlonOrderLinesWithKickdb } from "@/decathlon/orders/kickdbLineEnrichment";
import { enrichDecathlonOrderLinesWithSupplierCatalog } from "@/decathlon/orders/supplierCatalogLineEnrichment";
import { repairDecathlonStockxMatchLineRefs } from "@/decathlon/orders/stockxMatchRepair";
import { buildDecathlonLineStockHints } from "@/decathlon/orders/gtinStockHints";
import {
  canPartnerAccessDecathlonOrder,
  filterDecathlonLinesForPartner,
} from "@/decathlon/orders/partnerLineScope";

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
    const partnerAccess = !partnerKey || canPartnerAccessDecathlonOrder(order, partnerKey);
    if (scope === "partner" && partnerKey && !partnerAccess) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    await repairDecathlonStockxMatchLineRefs(order.id);
    const stockxMatches = await prisma.decathlonStockxMatch.findMany({
      where: { decathlonOrderId: order.id },
    });
    const orderWithMatches = { ...order, stockxMatches };

    const lines: any[] =
      scope === "partner" && partnerKey
        ? filterDecathlonLinesForPartner(orderWithMatches.lines ?? [], orderWithMatches, partnerKey)
        : orderWithMatches.lines ?? [];
    const [kickdbByLineId, catalogByLineId, partnerRows] = await Promise.all([
      enrichDecathlonOrderLinesWithKickdb(lines),
      enrichDecathlonOrderLinesWithSupplierCatalog(lines),
      prisma.partner.findMany({ where: { active: true }, select: { key: true } }),
    ]);
    const stockHintsByLineId = await buildDecathlonLineStockHints(
      lines,
      partnerRows.map((row) => row.key)
    );
    const linesEnriched = lines.map((line: { id: string }) => ({
      ...line,
      kickdb: kickdbByLineId.get(line.id) ?? null,
      catalog: catalogByLineId.get(line.id) ?? null,
      stockHints: stockHintsByLineId.get(line.id) ?? [],
    }));

    const byStockxLineId = new Map(stockxMatches.map((m) => [String(m.decathlonOrderLineId), m]));
    const byStockxLineNumber = new Map<number, (typeof stockxMatches)[0]>();
    for (const m of stockxMatches) {
      const n = m.decathlonLineNumber;
      if (n == null || Number.isNaN(Number(n))) continue;
      const num = Number(n);
      if (!byStockxLineNumber.has(num)) byStockxLineNumber.set(num, m);
    }
    const linesWithStockx = linesEnriched.map((line: any) => {
      let sm = byStockxLineId.get(String(line.id)) ?? null;
      if (!sm && line.lineNumber != null) {
        sm = byStockxLineNumber.get(Number(line.lineNumber)) ?? null;
      }
      return { ...line, stockxMatch: sm };
    });

    return NextResponse.json({
      ok: true,
      order: { ...orderWithMatches, lines: linesWithStockx },
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to load order" },
      { status: 500 }
    );
  }
}
