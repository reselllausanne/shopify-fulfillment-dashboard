import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { runDirectSwissPostLabelForOrder } from "@/galaxus/directDelivery/runDirectSwissPostLabel";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
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
    const result = await runDirectSwissPostLabelForOrder(orderId, {
      includeLabelData: Boolean(body?.includeLabelData),
      allowReprint: body?.allowReprint,
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

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[GALAXUS][DIRECT-SWISS-POST-LABEL] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed" }, { status: 500 });
  }
}
