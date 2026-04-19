import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findOrder(orderId: string) {
  const byId = await prisma.galaxusOrder.findUnique({ where: { id: orderId } });
  if (byId) return byId;
  return prisma.galaxusOrder.findUnique({ where: { galaxusOrderId: orderId } });
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
    return NextResponse.json({
      ok: true,
      cancelledAt: updated.cancelledAt?.toISOString() ?? null,
      cancelReason: updated.cancelReason ?? null,
    });
  } catch (error: any) {
    console.error("[GALAXUS][ORDERS][CANCEL] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Cancel failed" }, { status: 500 });
  }
}
