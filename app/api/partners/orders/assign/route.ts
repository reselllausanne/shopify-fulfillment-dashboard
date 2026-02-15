import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const orderId = body?.orderId ? String(body.orderId) : null;
    const partnerId = body?.partnerId ? String(body.partnerId) : null;
    const partnerKey = body?.partnerKey ? String(body.partnerKey) : null;

    if (!orderId || (!partnerId && !partnerKey)) {
      return NextResponse.json(
        { ok: false, error: "orderId and partnerId/partnerKey are required" },
        { status: 400 }
      );
    }

    const partner = await (prisma as any).partner.findFirst({
      where: partnerId ? { id: partnerId } : { key: partnerKey },
    });
    if (!partner) {
      return NextResponse.json({ ok: false, error: "Partner not found" }, { status: 404 });
    }

    const order = await prisma.galaxusOrder.findFirst({
      where: {
        OR: [{ id: orderId }, { galaxusOrderId: orderId }],
      },
      include: { lines: true },
    });
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    const partnerOrder = await (prisma as any).partnerOrder.upsert({
      where: {
        partnerId_galaxusOrderId: {
          partnerId: partner.id,
          galaxusOrderId: order.galaxusOrderId,
        },
      },
      create: {
        partnerId: partner.id,
        galaxusOrderId: order.galaxusOrderId,
        status: "ASSIGNED",
        sentAt: new Date(),
      },
      update: {
        status: "ASSIGNED",
        sentAt: new Date(),
      },
    });

    const gtins = order.lines
      .map((line) => line.gtin)
      .filter((value): value is string => Boolean(value));
    const partnerVariants = await (prisma as any).partnerVariant.findMany({
      where: {
        partnerId: partner.id,
        gtin: { in: gtins },
      },
    });

    const partnerVariantByGtin = new Map<string, any>();
    for (const variant of partnerVariants) {
      const gtin = String(variant.gtin ?? "");
      if (!gtin) continue;
      const existing = partnerVariantByGtin.get(gtin);
      if (!existing || Number(variant.stock ?? 0) > Number(existing.stock ?? 0)) {
        partnerVariantByGtin.set(gtin, variant);
      }
    }

    await (prisma as any).partnerOrderLine.deleteMany({
      where: { partnerOrderId: partnerOrder.id },
    });

    await (prisma as any).partnerOrderLine.createMany({
      data: order.lines.map((line) => {
        const matched = line.gtin ? partnerVariantByGtin.get(String(line.gtin)) : null;
        return {
          partnerOrderId: partnerOrder.id,
          partnerVariantId: matched?.id ?? null,
          gtin: line.gtin ?? null,
          quantity: line.quantity ?? 1,
        };
      }),
    });

    return NextResponse.json({
      ok: true,
      partnerOrderId: partnerOrder.id,
      galaxusOrderId: order.galaxusOrderId,
      partnerId: partner.id,
    });
  } catch (error: any) {
    console.error("[PARTNER][ORDER][ASSIGN] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
