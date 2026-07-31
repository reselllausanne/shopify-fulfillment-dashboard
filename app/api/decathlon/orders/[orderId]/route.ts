import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import {
  applyDecathlonLineSaleSnapshots,
  loadDecathlonLineSaleSnapshots,
} from "@/decathlon/orders/saleLineSnapshot";
import { enrichDecathlonOrderLinesWithKickdb } from "@/decathlon/orders/kickdbLineEnrichment";
import { enrichDecathlonOrderLinesWithSupplierCatalog } from "@/decathlon/orders/supplierCatalogLineEnrichment";
import { buildDecathlonLineStockHints } from "@/decathlon/orders/gtinStockHints";
import { repairDecathlonStockxMatchLineRefs } from "@/decathlon/orders/stockxMatchRepair";
import {
  attachPhysicalStockToLines,
  buildPhysicalStockByGtinMap,
} from "@/shopify/inventory/orderLinePhysicalStock";
import {
  canPartnerAccessDecathlonOrder,
  filterDecathlonLinesForPartner,
} from "@/decathlon/orders/partnerLineScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const decathlonOrderInclude = (viewFull: boolean) =>
  ({
    lines: true,
    shipments: { include: { lines: true } },
    stockxMatches: true,
    ...(viewFull ? { documents: true } : {}),
  }) as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const { searchParams } = new URL(request.url);
    const scope = String(searchParams.get("scope") ?? "").trim().toLowerCase();
    const view = String(searchParams.get("view") ?? "full").trim().toLowerCase();
    const viewFull = view !== "minimal";
    const partnerSession = scope === "partner" ? await getPartnerSession(request) : null;
    const partnerKey = normalizeProviderKey(partnerSession?.partnerKey ?? null);
    if (scope === "partner" && !partnerSession) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (scope === "partner" && !partnerKey) {
      return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });
    }
    const order = await prisma.decathlonOrder.findFirst({
      where: { OR: [{ id: orderId }, { orderId }] },
      include: decathlonOrderInclude(viewFull),
    });
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

    const linesRaw: any[] =
      scope === "partner" && partnerKey
        ? filterDecathlonLinesForPartner(orderWithMatches.lines ?? [], orderWithMatches, partnerKey)
        : orderWithMatches.lines ?? [];

    const [saleSnapshots, kickdbByLineId, catalogByLineId, partnerRows] = await Promise.all([
      loadDecathlonLineSaleSnapshots(linesRaw),
      enrichDecathlonOrderLinesWithKickdb(linesRaw),
      enrichDecathlonOrderLinesWithSupplierCatalog(linesRaw),
      prisma.partner.findMany({ where: { active: true }, select: { key: true } }),
    ]);
    const lines = applyDecathlonLineSaleSnapshots(linesRaw, saleSnapshots);
    const stockHintsByLineId = await buildDecathlonLineStockHints(
      lines,
      partnerRows.map((row) => row.key)
    );
    const physicalStockByGtin = await buildPhysicalStockByGtinMap(
      lines.map((line: { gtin?: string | null }) => line.gtin)
    );
    const linesEnriched = attachPhysicalStockToLines(
      lines.map((line) => ({
        ...line,
        kickdb: kickdbByLineId.get(line.id) ?? null,
        catalog: catalogByLineId.get(line.id) ?? null,
        stockHints: stockHintsByLineId.get(line.id) ?? [],
      })),
      physicalStockByGtin
    );

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
