import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { purgeGalaxusOrderFromDb } from "@/galaxus/orders/purgeFromDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findOrderDbId(orderIdParam: string): Promise<string | null> {
  const byId = await prisma.galaxusOrder.findUnique({
    where: { id: orderIdParam },
    select: { id: true },
  });
  if (byId) return byId.id;
  const byGx = await prisma.galaxusOrder.findUnique({
    where: { galaxusOrderId: orderIdParam },
    select: { id: true },
  });
  return byGx?.id ?? null;
}

/**
 * POST body:
 * - confirmGalaxusOrderId (required): must match the order's public Galaxus id (prevents wrong-order deletes).
 * - force (optional): allow purge when not soft-cancelled in DB and/or when DELR was sent.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId: orderIdParam } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      confirmGalaxusOrderId?: string;
      force?: boolean;
    };

    const confirm = String(body?.confirmGalaxusOrderId ?? "").trim();
    if (!confirm) {
      return NextResponse.json(
        { ok: false, error: "confirmGalaxusOrderId is required (must match the order's Galaxus id)." },
        { status: 400 }
      );
    }

    const dbId = await findOrderDbId(orderIdParam);
    if (!dbId) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    const order = await prisma.galaxusOrder.findUnique({
      where: { id: dbId },
      select: { id: true, galaxusOrderId: true },
    });
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    if (confirm !== order.galaxusOrderId) {
      return NextResponse.json(
        {
          ok: false,
          error: "confirmGalaxusOrderId does not match this order's galaxusOrderId.",
        },
        { status: 400 }
      );
    }

    const force = Boolean(body?.force);

    try {
      const result = await purgeGalaxusOrderFromDb(prisma, order.id, { force });
      return NextResponse.json({ ok: true, ...result });
    } catch (e: any) {
      const msg = String(e?.message ?? "Purge failed");
      if (msg.includes("not marked cancelled") || msg.includes("DELR sent")) {
        return NextResponse.json({ ok: false, error: msg }, { status: 409 });
      }
      throw e;
    }
  } catch (error: any) {
    console.error("[GALAXUS][ORDERS][PURGE] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Purge failed" }, { status: 500 });
  }
}
