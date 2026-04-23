import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string; lineId: string }> }
) {
  try {
    const prismaAny = prisma as any;
    const { orderId, lineId } = await params;
    const body = await request.json().catch(() => ({}));
    const partnerId = body?.partnerId ? String(body.partnerId) : null;
    const rawPartnerKey = body?.partnerKey != null ? String(body.partnerKey) : null;

    if (!orderId || !lineId) {
      return NextResponse.json({ ok: false, error: "orderId and lineId required" }, { status: 400 });
    }

    let partnerKey: string | null = null;
    if (rawPartnerKey && rawPartnerKey.trim() !== "") {
      const normalized = normalizeProviderKey(rawPartnerKey);
      if (!normalized) {
        return NextResponse.json({ ok: false, error: "Invalid partner key" }, { status: 400 });
      }
      if (normalized === "THE") {
        partnerKey = normalized;
      } else {
        const partner = await prismaAny.partner.findFirst({
          where: partnerId ? { id: partnerId } : { key: normalized },
          select: { key: true },
        });
        if (!partner) {
          return NextResponse.json({ ok: false, error: "Partner not found" }, { status: 404 });
        }
        partnerKey = normalizeProviderKey(partner.key);
      }
    }

    const order =
      (await prismaAny.decathlonOrder.findUnique({ where: { id: orderId } })) ??
      (await prismaAny.decathlonOrder.findUnique({ where: { orderId } }));
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    const line = await prismaAny.decathlonOrderLine.findFirst({
      where: { orderId: order.id, OR: [{ id: lineId }, { orderLineId: lineId }] },
    });
    if (!line) {
      return NextResponse.json({ ok: false, error: "Order line not found" }, { status: 404 });
    }

    const updated = await prismaAny.decathlonOrderLine.update({
      where: { id: line.id },
      data: { partnerKey },
    });

    return NextResponse.json({ ok: true, lineId: updated.id, partnerKey: updated.partnerKey });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Line assignment failed" },
      { status: 500 }
    );
  }
}
