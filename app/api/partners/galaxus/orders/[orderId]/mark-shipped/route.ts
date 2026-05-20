import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { deductStockForPartnerOrderFulfillment } from "@/galaxus/partners/partnerOrderStock";
import { requestFeedPush } from "@/galaxus/ops/feedPipeline";
import { resolveAppOriginForPartnerJobs } from "@/app/lib/partnerJobOrigin";
import {
  collectGtinsFromLines,
  lineMatchesPartnerScope,
  resolvePartnerGtins,
} from "../../partnerLineScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const session = await getPartnerSession(req);
    if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const pk = normalizeProviderKey(session.partnerKey);
    if (!pk) return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });
    const { orderId } = await params;

    const order =
      (await prisma.galaxusOrder.findFirst({
        where: { id: orderId },
        include: { lines: true },
      })) ??
      (await prisma.galaxusOrder.findFirst({
        where: { galaxusOrderId: orderId },
        include: { lines: true },
      }));

    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    const gtins = collectGtinsFromLines(order.lines);
    const partnerGtins = await resolvePartnerGtins(gtins, pk);
    const partnerLines = order.lines.filter((line) => lineMatchesPartnerScope(line, pk, partnerGtins));
    const partnerLineIds = partnerLines.map((line) => line.id);

    if (partnerLineIds.length === 0) {
      return NextResponse.json({ ok: false, error: "No partner lines found" }, { status: 404 });
    }

    const now = new Date();
    await prisma.galaxusOrderLine.updateMany({
      where: { id: { in: partnerLineIds } },
      data: { warehouseMarkedShippedAt: now },
    });

    const existingPartnerOrder = await (prisma as any).partnerOrder.findFirst({
      where: { partnerId: session.partnerId, galaxusOrderId: order.galaxusOrderId },
      select: { id: true, status: true },
    });

    const partnerOrder = await (prisma as any).partnerOrder.upsert({
      where: {
        partnerId_galaxusOrderId: {
          partnerId: session.partnerId,
          galaxusOrderId: order.galaxusOrderId,
        },
      },
      create: {
        partnerId: session.partnerId,
        galaxusOrderId: order.galaxusOrderId,
        status: "FULFILLED",
        sentAt: now,
        confirmedAt: now,
      },
      update: {
        status: "FULFILLED",
        confirmedAt: now,
      },
    });

    await (prisma as any).partnerOrderLine.deleteMany({
      where: { partnerOrderId: partnerOrder.id },
    });

    await (prisma as any).partnerOrderLine.createMany({
      data: partnerLines.map((line) => ({
        partnerOrderId: partnerOrder.id,
        partnerVariantId: null,
        supplierVariantId: line.supplierVariantId ?? null,
        gtin: line.gtin ?? null,
        quantity: line.quantity ?? 1,
      })),
    });

    const partnerKeyLower = String(session.partnerKey ?? "").toLowerCase();
    const stockResult = await deductStockForPartnerOrderFulfillment({
      partnerOrderId: partnerOrder.id,
      partnerKeyLower,
      previousStatus: existingPartnerOrder?.status ?? null,
    });
    if (stockResult.adjusted > 0) {
      const origin = resolveAppOriginForPartnerJobs(new URL(req.url).origin);
      if (origin) {
        await requestFeedPush({ origin, scope: "full", triggerSource: "partner-admin", runNow: true });
      }
    }

    return NextResponse.json({
      ok: true,
      updated: partnerLineIds.length,
      stock: {
        adjustedRows: stockResult.adjusted,
        skipped: stockResult.skipped,
        details: stockResult.details,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to mark shipped" },
      { status: 500 }
    );
  }
}
