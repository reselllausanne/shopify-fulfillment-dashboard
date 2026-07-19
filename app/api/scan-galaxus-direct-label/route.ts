import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { runDirectSwissPostLabelForOrder } from "@/galaxus/directDelivery/runDirectSwissPostLabel";
import { getStxLinkStatusForOrder } from "@/galaxus/stx/purchaseUnits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const normalizeCode = (code?: string | null) => {
  if (!code) return "";
  const trimmed = code.trim();
  const cleaned = trimmed.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "");
  if (/^\d{13,}$/.test(cleaned)) {
    return cleaned.slice(-12);
  }
  return cleaned;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const orderDbId = String(body?.orderDbId ?? "").trim();
    const rawCode = String(body?.awb ?? body?.code ?? "").trim();
    const awb = normalizeCode(rawCode);
    const includeLabelData = Boolean(body?.includeLabelData ?? true);
    const allowReprint = Boolean(body?.allowReprint ?? true);

    let resolvedOrderDbId = orderDbId;
    if (!resolvedOrderDbId && awb) {
      const awbCandidates = Array.from(
        new Set([awb, rawCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()].filter(Boolean))
      );
      const trackingUrlFilters = awbCandidates
        .filter((candidate) => candidate.length >= 6)
        .map((candidate) => ({ stockxTrackingUrl: { contains: candidate } }));
      const stockxOrderFilters = awbCandidates
        .filter((candidate) => candidate.length >= 6)
        .map((candidate) => ({ stockxOrderNumber: { contains: candidate, mode: "insensitive" as const } }));

      const match = await prisma.galaxusStockxMatch.findFirst({
        where: {
          OR: [
            { stockxAwb: { in: awbCandidates } },
            ...trackingUrlFilters,
            ...stockxOrderFilters,
          ],
        },
        select: {
          galaxusOrderId: true,
          order: {
            select: {
              id: true,
              deliveryType: true,
              orderNumber: true,
              galaxusOrderId: true,
            },
          },
        },
      });
      resolvedOrderDbId = match?.order?.id ?? match?.galaxusOrderId ?? "";
    }

    if (!resolvedOrderDbId) {
      return NextResponse.json(
        { ok: false, error: "No Galaxus order linked to this AWB" },
        { status: 404 }
      );
    }

    const order = await prisma.galaxusOrder.findFirst({
      where: { OR: [{ id: resolvedOrderDbId }, { galaxusOrderId: resolvedOrderDbId }] },
      select: {
        id: true,
        galaxusOrderId: true,
        orderNumber: true,
        deliveryType: true,
      },
    });
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }
    if (String(order.deliveryType ?? "").toLowerCase() !== "direct_delivery") {
      return NextResponse.json(
        { ok: false, error: "Order is not direct_delivery" },
        { status: 400 }
      );
    }

    const linkStatus = await getStxLinkStatusForOrder(order.id).catch(() => null);
    if (linkStatus && !linkStatus.allLinked) {
      return NextResponse.json(
        {
          ok: false,
          error: "Order not fully linked yet",
          orderNumber: order.orderNumber,
          galaxusOrderId: order.galaxusOrderId,
        },
        { status: 409 }
      );
    }

    const result = await runDirectSwissPostLabelForOrder(order.id, {
      includeLabelData,
      allowReprint,
      requireLinked: false,
    });

    if (!result.ok) {
      const status =
        result.error === "Order already has a finalized shipment (DELR sent)"
          ? 409
          : result.swissPost
            ? 502
            : 500;
      return NextResponse.json(
        {
          ...result,
          orderNumber: order.orderNumber,
          galaxusOrderId: order.galaxusOrderId,
        },
        { status }
      );
    }

    return NextResponse.json({
      ...result,
      orderNumber: order.orderNumber,
      galaxusOrderId: order.galaxusOrderId,
    });
  } catch (error: any) {
    console.error("[SCAN-GALAXUS-DIRECT-LABEL]", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to generate Galaxus direct label" },
      { status: 500 }
    );
  }
}
