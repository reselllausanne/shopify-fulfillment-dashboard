import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const body = await request.json().catch(() => ({}));
    const partnerId = body?.partnerId ? String(body.partnerId) : null;
    const rawPartnerKey = body?.partnerKey ? String(body.partnerKey) : null;
    if (!partnerId && !rawPartnerKey) {
      return NextResponse.json(
        { ok: false, error: "partnerId or partnerKey is required" },
        { status: 400 }
      );
    }
    const partner = await prisma.partner.findFirst({
      where: partnerId ? { id: partnerId } : { key: rawPartnerKey ?? undefined },
      select: { key: true, id: true, name: true },
    });
    if (!partner) {
      return NextResponse.json({ ok: false, error: "Partner not found" }, { status: 404 });
    }
    const partnerKey = normalizeProviderKey(partner.key);
    if (!partnerKey) {
      return NextResponse.json({ ok: false, error: "Invalid partner key" }, { status: 400 });
    }
    const order =
      (await prisma.decathlonOrder.findUnique({ where: { id: orderId } })) ??
      (await prisma.decathlonOrder.findUnique({ where: { orderId } }));
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }
    const updated = await prisma.decathlonOrder.update({
      where: { id: order.id },
      data: { partnerKey },
    });
    return NextResponse.json({ ok: true, orderId: updated.id, partnerKey });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Assignment failed" },
      { status: 500 }
    );
  }
}
