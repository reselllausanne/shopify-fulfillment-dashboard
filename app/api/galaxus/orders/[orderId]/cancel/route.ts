import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { notifyGalaxusOrderCancelled } from "@/lib/stockxOpsAlerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findOrder(orderId: string) {
  const byId = await prisma.galaxusOrder.findUnique({
    where: { id: orderId },
    include: { lines: { select: { productName: true, description: true }, take: 5 } },
  });
  if (byId) return byId;
  return prisma.galaxusOrder.findUnique({
    where: { galaxusOrderId: orderId },
    include: { lines: { select: { productName: true, description: true }, take: 5 } },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const body = await request.json().catch(() => ({}));
    const confirm = Boolean(body?.confirm);
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

    if (!confirm) {
      return NextResponse.json({ ok: false, error: "Confirmation required" }, { status: 400 });
    }

    const order = await findOrder(orderId);
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }
    if (order.archivedAt) {
      return NextResponse.json({ ok: false, error: "Archived orders cannot be cancelled" }, { status: 409 });
    }
    if (order.cancelledAt) {
      return NextResponse.json({
        ok: true,
        cancelledAt: order.cancelledAt.toISOString(),
        alreadyCancelled: true,
      });
    }

    const updated = await prisma.galaxusOrder.update({
      where: { id: order.id },
      data: { cancelledAt: new Date(), cancelReason: reason || null },
      select: { cancelledAt: true, cancelReason: true },
    });

    const productTitles = (order.lines ?? [])
      .map((l) => String(l.productName ?? l.description ?? "").trim())
      .filter(Boolean);
    const notify = await notifyGalaxusOrderCancelled({
      orderDbId: order.id,
      galaxusOrderId: order.galaxusOrderId,
      cancelledAt: updated.cancelledAt,
      cancelReason: updated.cancelReason,
      productTitles,
    }).catch((e: any) => ({ emailed: false, error: String(e?.message ?? e) }));

    return NextResponse.json({
      ok: true,
      cancelledAt: updated.cancelledAt?.toISOString() ?? null,
      cancelReason: updated.cancelReason ?? null,
      opsAlert: notify,
    });
  } catch (error: any) {
    console.error("[GALAXUS][ORDERS][CANCEL] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Cancel failed" }, { status: 500 });
  }
}
