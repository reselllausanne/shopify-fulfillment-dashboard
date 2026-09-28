import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { runDirectSwissPostLabelForOrder } from "@/galaxus/directDelivery/runDirectSwissPostLabel";
import {
  applySuccessfulSwissPostLabelToShipment,
  requestSwissPostLabelForOrderWithTrackingHint,
} from "@/galaxus/directDelivery/swissPostLabelFlow";
import { resolveDirectDeliveryNoteMeta } from "@/galaxus/directDelivery/resolveDeliveryNoteUrl";
import {
  requirePartnerSelfFulfillAccess,
  type PartnerSelfFulfillAccess,
} from "@/app/api/partners/galaxus/_auth";
import {
  collectGtinsFromLines,
  lineMatchesPartnerScope,
  resolvePartnerGtins,
} from "@/app/api/partners/galaxus/orders/partnerLineScope";
import {
  filterPartnerShipments,
  isFinalizedPartnerShipment,
  remainingPartnerLineSelection,
} from "@/app/api/partners/galaxus/orders/partnerDirectShipments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const auth = await requirePartnerSelfFulfillAccess(request);
    if (!auth.access) return auth.response!;
    const access = auth.access;
    const { orderId } = await params;
    const order =
      (await prisma.galaxusOrder.findUnique({
        where: { id: orderId },
        include: { lines: true, shipments: { include: { items: true }, orderBy: { createdAt: "asc" } } },
      })) ??
      (await prisma.galaxusOrder.findUnique({
        where: { galaxusOrderId: orderId },
        include: { lines: true, shipments: { include: { items: true }, orderBy: { createdAt: "asc" } } },
      }));
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }
    if (String(order.deliveryType ?? "").toLowerCase() !== "direct_delivery") {
      return NextResponse.json({ ok: false, error: "Order is not direct_delivery" }, { status: 400 });
    }
    const gtinSet = await resolvePartnerGtins(
      collectGtinsFromLines(order.lines),
      access.providerKey
    );
    const partnerLines = order.lines.filter((line) =>
      lineMatchesPartnerScope(line, access.providerKey, gtinSet)
    );
    if (partnerLines.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Order has no lines in partner scope" },
        { status: 403 }
      );
    }
    const isMixed = partnerLines.length < order.lines.length;

    const body = (await request.json().catch(() => ({}))) as {
      includeLabelData?: boolean;
      allowReprint?: boolean;
      requireLinked?: boolean;
      shipmentId?: string;
    };

    const partnerShipments = filterPartnerShipments(order.shipments, access.providerKey);
    const openDrafts = partnerShipments.filter(
      (shipment) => !isFinalizedPartnerShipment(shipment) && !String(shipment.trackingNumber ?? "").trim()
    );
    const requestedDraft = body?.shipmentId
      ? openDrafts.find((shipment) => shipment.id === body.shipmentId)
      : null;
    if (body?.shipmentId && !requestedDraft) {
      return NextResponse.json({ ok: false, error: "Open partner shipment not found" }, { status: 404 });
    }

    // Mixed order (partner + other suppliers): never label the whole order. Label an
    // existing partner draft, or create a parcel with only the partner's remaining lines.
    if (isMixed || requestedDraft) {
      const draft = requestedDraft ?? openDrafts[0] ?? null;
      if (draft) {
        const hint = String(order.galaxusOrderId ?? "").trim() || `GALAXUS-${draft.id}`;
        const swissRes = await requestSwissPostLabelForOrderWithTrackingHint(order, hint);
        if (!swissRes.ok) {
          return NextResponse.json(
            { ok: false, error: "Swiss Post label generation failed", swissPost: swissRes.data, shipmentId: draft.id },
            { status: 502 }
          );
        }
        const result = await applySuccessfulSwissPostLabelToShipment(draft.id, swissRes.data, {
          documentUrlBase: "/api/partners/galaxus/documents",
          delrActor: {
            type: "partner",
            partnerId: access.session.partnerId,
            partnerKey: access.session.partnerKey,
          },
        });
        await logPartnerLabelEvent(order.id, draft.id, access, result.trackingNumber);
        const deliveryNote = await resolveDirectDeliveryNoteMeta({ orderDbId: order.id, shipmentId: draft.id });
        return NextResponse.json({
          ok: true,
          status: "CREATED",
          shipmentId: draft.id,
          url: result.url,
          version: result.version,
          delr: result.delr,
          ordr: result.ordr,
          trackingNumber: result.trackingNumber,
          remainingDrafts: openDrafts.length - 1,
          physicalDeliveryNoteRequired: deliveryNote.physicalDeliveryNoteRequired,
          deliveryNoteUrl: deliveryNote.deliveryNoteUrl,
        });
      }

      const selection = remainingPartnerLineSelection(partnerLines, order.shipments);
      if (selection.length === 0) {
        return NextResponse.json(
          { ok: false, error: "All partner lines already shipped" },
          { status: 409 }
        );
      }
      const result = await runDirectSwissPostLabelForOrder(order.id, {
        includeLabelData: Boolean(body?.includeLabelData),
        requireLinked: body?.requireLinked === true,
        selection,
      });
      return respondWithRunResult(order.id, result, access);
    }

    const result = await runDirectSwissPostLabelForOrder(order.id, {
      includeLabelData: Boolean(body?.includeLabelData),
      allowReprint: body?.allowReprint,
      requireLinked: body?.requireLinked === true,
    });
    return respondWithRunResult(order.id, result, access);
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed" }, { status: 500 });
  }
}

async function logPartnerLabelEvent(
  orderId: string,
  shipmentId: string,
  access: PartnerSelfFulfillAccess,
  trackingNumber: string | null | undefined
) {
  await (prisma as any).orderStatusEvent
    .create({
      data: {
        orderId,
        source: "PARTNER_LABEL",
        type: "UPDATED",
        payloadJson: {
          shipmentId,
          partnerId: access.session.partnerId,
          partnerKey: access.providerKey,
          trackingNumber: trackingNumber ?? null,
        },
      },
    })
    .catch(() => undefined);
}

async function respondWithRunResult(
  orderDbId: string,
  result: Awaited<ReturnType<typeof runDirectSwissPostLabelForOrder>>,
  access: PartnerSelfFulfillAccess
) {
  if (!result.ok) {
    const status =
      result.error === "Order not found"
        ? 404
        : result.error === "Order is not direct_delivery"
          ? 400
          : result.error === "Order not fully linked yet" || result.error === "Selected pair not linked yet"
            ? 409
            : result.error === "Order already has a finalized shipment (DELR sent)"
              ? 409
              : result.swissPost
                ? 502
                : 500;
    return NextResponse.json(result, { status });
  }
  if (result.status === "CREATED" && result.shipmentId) {
    await logPartnerLabelEvent(orderDbId, result.shipmentId, access, result.trackingNumber);
  }
  const deliveryNote = await resolveDirectDeliveryNoteMeta({
    orderDbId,
    shipmentId: result.shipmentId,
  });
  return NextResponse.json({
    ...result,
    physicalDeliveryNoteRequired: deliveryNote.physicalDeliveryNoteRequired,
    deliveryNoteUrl: deliveryNote.deliveryNoteUrl,
  });
}
