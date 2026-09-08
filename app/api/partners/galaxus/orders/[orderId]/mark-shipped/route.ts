import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession, isPartnerRoleAllowed } from "@/app/lib/partnerAuth";
import { isPartnerSelfFulfillEnabled } from "@/app/lib/partnerSelfFulfill";
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
    if (!isPartnerRoleAllowed(session.role)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    if (!isPartnerSelfFulfillEnabled(session.partnerKey)) {
      return NextResponse.json({ ok: false, error: "Partner self-fulfill disabled" }, { status: 403 });
    }
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
    if (partnerLines.length === 0) {
      return NextResponse.json({ ok: false, error: "No partner lines found" }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      lineIds?: unknown;
    };
    const openPartnerLines = partnerLines.filter((line) => !line.warehouseMarkedShippedAt);
    if (openPartnerLines.length === 0) {
      return NextResponse.json({ ok: false, error: "All partner lines already shipped" }, { status: 409 });
    }
    const openLineIdSet = new Set(openPartnerLines.map((line) => String(line.id)));
    const requestedLineIds = Array.isArray(body?.lineIds)
      ? body.lineIds
          .map((value) => String(value ?? "").trim())
          .filter(Boolean)
      : [];

    let targetLineIds: string[] = [];
    if (requestedLineIds.length > 0) {
      const uniqueRequested = Array.from(new Set(requestedLineIds));
      const invalid = uniqueRequested.filter((lineId) => !openLineIdSet.has(lineId));
      if (invalid.length > 0) {
        return NextResponse.json(
          {
            ok: false,
            error: "Some selected lines are invalid or already shipped",
            invalidLineIds: invalid,
          },
          { status: 400 }
        );
      }
      targetLineIds = uniqueRequested;
    } else if (openPartnerLines.length === 1) {
      targetLineIds = [String(openPartnerLines[0].id)];
    } else {
      return NextResponse.json(
        {
          ok: false,
          error: "Multiple open partner lines. Select lineIds for partial/full fulfillment.",
          requiresLineSelection: true,
          openLines: openPartnerLines.map((line) => ({
            id: line.id,
            lineNumber: line.lineNumber ?? null,
            quantity: line.quantity ?? 0,
            productName: line.productName ?? line.description ?? null,
          })),
        },
        { status: 409 }
      );
    }

    const now = new Date();
    await prisma.galaxusOrderLine.updateMany({
      where: { id: { in: targetLineIds } },
      data: { warehouseMarkedShippedAt: now },
    });

    const refreshedOrder =
      (await prisma.galaxusOrder.findFirst({
        where: { id: order.id },
        include: { lines: true },
      })) ?? order;
    const refreshedGtins = collectGtinsFromLines(refreshedOrder.lines);
    const refreshedPartnerGtins = await resolvePartnerGtins(refreshedGtins, pk);
    const refreshedPartnerLines = refreshedOrder.lines.filter((line) =>
      lineMatchesPartnerScope(line, pk, refreshedPartnerGtins)
    );
    const allPartnerLinesShipped =
      refreshedPartnerLines.length > 0 &&
      refreshedPartnerLines.every((line) => Boolean(line.warehouseMarkedShippedAt));
    const nextPartnerOrderStatus = allPartnerLinesShipped ? "FULFILLED" : "PARTIAL";
    const selectedLineSet = new Set(targetLineIds);
    const selectedPartnerLines = partnerLines.filter((line) => selectedLineSet.has(String(line.id)));

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
        status: nextPartnerOrderStatus,
        sentAt: now,
        confirmedAt: now,
      },
      update: {
        status: nextPartnerOrderStatus,
        confirmedAt: now,
      },
    });

    await (prisma as any).partnerOrderLine.deleteMany({
      where: { partnerOrderId: partnerOrder.id },
    });

    await (prisma as any).partnerOrderLine.createMany({
      data: selectedPartnerLines.map((line) => ({
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
      updated: targetLineIds.length,
      markedLineIds: targetLineIds,
      fulfillmentState: allPartnerLinesShipped ? "fulfilled" : "partial",
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
