import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { runDirectSwissPostLabelForOrder } from "@/galaxus/directDelivery/runDirectSwissPostLabel";
import { requirePartnerSelfFulfillAccess } from "@/app/api/partners/galaxus/_auth";
import {
  collectGtinsFromLines,
  lineMatchesPartnerScope,
  resolvePartnerGtins,
} from "@/app/api/partners/galaxus/orders/partnerLineScope";

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
        include: { lines: true },
      })) ??
      (await prisma.galaxusOrder.findUnique({
        where: { galaxusOrderId: orderId },
        include: { lines: true },
      }));
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }
    const gtinSet = await resolvePartnerGtins(
      collectGtinsFromLines(order.lines),
      access.providerKey
    );
    const outOfScope = order.lines.some(
      (line) => !lineMatchesPartnerScope(line, access.providerKey, gtinSet)
    );
    if (outOfScope) {
      return NextResponse.json(
        { ok: false, error: "Order contains lines outside partner scope" },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      includeLabelData?: boolean;
      allowReprint?: boolean;
      requireLinked?: boolean;
    };
    const result = await runDirectSwissPostLabelForOrder(order.id, {
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
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed" }, { status: 500 });
  }
}
