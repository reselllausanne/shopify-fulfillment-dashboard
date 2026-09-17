import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { runDirectSwissPostLabelForOrder } from "@/galaxus/directDelivery/runDirectSwissPostLabel";
import { printDirectDeliveryDocumentsLocally } from "@/galaxus/directDelivery/printDirectDocuments";
import { resolveDirectDeliveryNoteMeta } from "@/galaxus/directDelivery/resolveDeliveryNoteUrl";

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

type SelectionItem = { lineId: string; quantity: number };

function parseSelection(body: unknown): SelectionItem[] {
  const raw = (body as { selection?: unknown })?.selection;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item: { lineId?: string; quantity?: number }) => ({
      lineId: String(item?.lineId ?? "").trim(),
      quantity: Math.max(0, Math.floor(Number(item?.quantity ?? 0))),
    }))
    .filter((item) => item.lineId && item.quantity > 0);
}

/**
 * Scan endpoint must never ship sibling pairs. If the client forgot selection,
 * recover the scanned line from AWB → GalaxusStockxMatch. If we still cannot
 * pin a single pair and more than one unit remains open, refuse.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const orderDbId = String(body?.orderDbId ?? "").trim();
    const rawCode = String(body?.awb ?? body?.code ?? "").trim();
    const awb = normalizeCode(rawCode);
    const includeLabelData = Boolean(body?.includeLabelData ?? true);
    // Scan auto-flow must not reprint. Explicit UI can pass allowReprint: true.
    const allowReprint = Boolean(body?.allowReprint ?? false);

    const awbCandidates = Array.from(
      new Set([awb, rawCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()].filter(Boolean))
    );

    let resolvedOrderDbId = orderDbId;
    let awbMatchLineId: string | null = null;

    if (awbCandidates.length > 0) {
      const trackingUrlFilters = awbCandidates
        .filter((candidate) => candidate.length >= 6)
        .map((candidate) => ({ stockxTrackingUrl: { contains: candidate } }));
      const stockxOrderFilters = awbCandidates
        .filter((candidate) => candidate.length >= 6)
        .map((candidate) => ({
          stockxOrderNumber: { contains: candidate, mode: "insensitive" as const },
        }));

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
          galaxusOrderLineId: true,
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
      if (match) {
        awbMatchLineId = String(match.galaxusOrderLineId ?? "").trim() || null;
        if (!resolvedOrderDbId) {
          resolvedOrderDbId = match.order?.id ?? match.galaxusOrderId ?? "";
        }
      }
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
        lines: {
          select: {
            id: true,
            quantity: true,
          },
        },
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

    let selection = parseSelection(body);

    // AWB scan without selection → pin the matched line (qty 1).
    if (selection.length === 0 && awbMatchLineId) {
      selection = [{ lineId: awbMatchLineId, quantity: 1 }];
    }

    const lines = order.lines ?? [];
    const totalOrdered = lines.reduce(
      (sum, line) => sum + Math.max(0, Math.floor(Number(line.quantity ?? 0))),
      0
    );

    // Hard guard: scan API never ships multi-pair / multi-qty without an explicit
    // line selection (would fulfill sibling pairs on the same Galaxus order).
    if (selection.length === 0) {
      if (totalOrdered > 1 || lines.length > 1) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Multi-pair order: scan must select a line (selection). Refusing whole-order ship.",
            orderNumber: order.orderNumber,
            galaxusOrderId: order.galaxusOrderId,
            lineCount: lines.length,
            totalOrdered,
          },
          { status: 400 }
        );
      }
      // Single remaining unit — whole-order == that one pair.
      if (lines.length === 1) {
        selection = [{ lineId: lines[0].id, quantity: 1 }];
      }
    }

    const isPartial = selection.length > 0;

    const result = await runDirectSwissPostLabelForOrder(order.id, {
      includeLabelData,
      allowReprint,
      // Partial path checks only the selected parcel inside runDirectSwissPostLabelForOrder.
      requireLinked: true,
      selection: isPartial ? selection : undefined,
    });

    if (!result.ok) {
      const status =
        result.error === "Order already has a finalized shipment (DELR sent)" ||
        result.error === "Selected pair not linked yet"
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

    const printed = await printDirectDeliveryDocumentsLocally({
      orderRef: order.galaxusOrderId || order.id,
      shipmentId: result.shipmentId,
      status: result.status,
      allowReprint,
      labelData: result.labelData
        ? { base64: result.labelData.base64, extension: result.labelData.extension }
        : null,
      browserPrintConfig: result.browserPrintConfig,
    });

    const deliveryNote = await resolveDirectDeliveryNoteMeta({
      orderDbId: order.id,
      shipmentId: result.shipmentId,
    });

    return NextResponse.json({
      ...result,
      browserPrintConfig: printed.browserPrintConfig ?? result.browserPrintConfig,
      printJobResult: printed.printJobResult,
      deliveryNotePrintResult: printed.deliveryNotePrintResult,
      physicalDeliveryNoteRequired: deliveryNote.physicalDeliveryNoteRequired,
      deliveryNoteUrl: deliveryNote.deliveryNoteUrl,
      orderNumber: order.orderNumber,
      galaxusOrderId: order.galaxusOrderId,
      selection,
    });
  } catch (error: any) {
    console.error("[SCAN-GALAXUS-DIRECT-LABEL]", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to generate Galaxus direct label" },
      { status: 500 }
    );
  }
}
