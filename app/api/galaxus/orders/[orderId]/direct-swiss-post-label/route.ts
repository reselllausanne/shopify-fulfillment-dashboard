import { NextRequest, NextResponse } from "next/server";
import { runDirectSwissPostLabelForOrder } from "@/galaxus/directDelivery/runDirectSwissPostLabel";
import { printDirectDeliveryDocumentsLocally } from "@/galaxus/directDelivery/printDirectDocuments";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";

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
    };
    const allowReprint = Boolean(body?.allowReprint);
    const includeLabelData = body?.includeLabelData !== false;

    const result = await runDirectSwissPostLabelForOrder(orderId, {
      includeLabelData,
      allowReprint,
      requireLinked: body?.requireLinked,
    });

    if (!result.ok) {
      const status =
        result.error === "Order not found"
          ? 404
          : result.error === "Order is not direct_delivery"
            ? 400
            : result.error === "Order not fully linked yet"
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

    return NextResponse.json({
      ...result,
      browserPrintConfig: printed.browserPrintConfig ?? result.browserPrintConfig,
      printJobResult: printed.printJobResult,
      deliveryNotePrintResult: printed.deliveryNotePrintResult,
    });
  } catch (error: any) {
    console.error("[GALAXUS][DIRECT-SWISS-POST-LABEL] Failed:", error);
    const message = String(error?.message ?? "Failed");
    const status = /unreachable|timeout|fetch failed/i.test(message) ? 502 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
