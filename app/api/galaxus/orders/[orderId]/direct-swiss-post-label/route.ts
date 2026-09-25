import { NextRequest, NextResponse } from "next/server";
import { runDirectSwissPostLabelForOrder } from "@/galaxus/directDelivery/runDirectSwissPostLabel";
import { printDirectDeliveryDocumentsLocally } from "@/galaxus/directDelivery/printDirectDocuments";
import { resolveDirectDeliveryNoteMeta } from "@/galaxus/directDelivery/resolveDeliveryNoteUrl";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const staffRole = await getStaffRoleFromRequest(request);
    if (!staffRole) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const { orderId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      includeLabelData?: boolean;
      allowReprint?: boolean;
      requireLinked?: boolean;
      selection?: Array<{ lineId?: string; quantity?: number }>;
    };
    const allowReprint = Boolean(body?.allowReprint);
    const includeLabelData = body?.includeLabelData !== false;
    const selection = Array.isArray(body?.selection)
      ? body.selection
          .map((item) => ({
            lineId: String(item?.lineId ?? "").trim(),
            quantity: Math.max(0, Math.floor(Number(item?.quantity ?? 0))),
          }))
          .filter((item) => item.lineId && item.quantity > 0)
      : [];

    const result = await runDirectSwissPostLabelForOrder(orderId, {
      includeLabelData,
      allowReprint,
      // StockX link ≠ Swiss Post eligibility. Default off; opt-in via body.
      requireLinked: body?.requireLinked === true,
      selection: selection.length > 0 ? selection : undefined,
    });

    if (!result.ok) {
      const status =
        result.error === "Order not found"
          ? 404
          : result.error === "Order is not direct_delivery"
            ? 400
            : result.error === "Order not fully linked yet" ||
                result.error === "Selected pair not linked yet"
              ? 409
              : result.error === "Order already has a finalized shipment (DELR sent)"
                ? 409
                : result.swissPost
                  ? 502
                  : 500;
      return NextResponse.json(result, { status });
    }

    const printed = await printDirectDeliveryDocumentsLocally({
      orderRef: orderId,
      shipmentId: result.shipmentId,
      status: result.status,
      allowReprint,
      labelData: result.labelData
        ? { base64: result.labelData.base64, extension: result.labelData.extension }
        : null,
      browserPrintConfig: result.browserPrintConfig,
    });

    const orderRow = await prisma.galaxusOrder.findFirst({
      where: { OR: [{ id: orderId }, { galaxusOrderId: orderId }] },
      select: { id: true },
    });
    const deliveryNote = orderRow
      ? await resolveDirectDeliveryNoteMeta({
          orderDbId: orderRow.id,
          shipmentId: result.shipmentId,
        })
      : { physicalDeliveryNoteRequired: false, deliveryNoteUrl: null };

    return NextResponse.json({
      ...result,
      browserPrintConfig: printed.browserPrintConfig ?? result.browserPrintConfig,
      printJobResult: printed.printJobResult,
      deliveryNotePrintResult: printed.deliveryNotePrintResult,
      physicalDeliveryNoteRequired: deliveryNote.physicalDeliveryNoteRequired,
      deliveryNoteUrl: deliveryNote.deliveryNoteUrl,
    });
  } catch (error: any) {
    console.error("[GALAXUS][DIRECT-SWISS-POST-LABEL] Failed:", error);
    const message = String(error?.message ?? "Failed");
    const status = /unreachable|timeout|fetch failed/i.test(message) ? 502 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
