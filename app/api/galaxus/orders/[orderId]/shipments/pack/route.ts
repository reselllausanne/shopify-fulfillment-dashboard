import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { createManualShipmentsForOrder } from "@/galaxus/warehouse/shipments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PackBody = {
  packages?: Array<{ items?: Array<{ lineId?: string; quantity?: number }> }>;
  confirmReplace?: boolean;
};

async function resolveOrderId(orderIdOrRef: string): Promise<string | null> {
  const byId = await prisma.galaxusOrder.findUnique({ where: { id: orderIdOrRef }, select: { id: true } });
  if (byId) return byId.id;
  const byGalaxus = await prisma.galaxusOrder.findUnique({
    where: { galaxusOrderId: orderIdOrRef },
    select: { id: true },
  });
  return byGalaxus?.id ?? null;
}

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const resolvedOrderId = await resolveOrderId(orderId);
    if (!resolvedOrderId) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as PackBody;
    const existingShipmentCount = await prisma.shipment.count({ where: { orderId: resolvedOrderId } });
    if (existingShipmentCount > 0 && !body?.confirmReplace) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "confirmReplace: true is required when shipments already exist — draft packages replace non-final shipments (see Galaxus pack UI)",
        },
        { status: 400 }
      );
    }
    const raw = Array.isArray(body.packages) ? body.packages : [];
    const packages = raw
      .map((pkg) => {
        const items = Array.isArray(pkg?.items) ? pkg.items : [];
        return {
          items: items
            .map((it) => ({
              lineId: String(it?.lineId ?? "").trim(),
              quantity: Math.max(0, Number(it?.quantity ?? 0)),
            }))
            .filter((it) => it.lineId && it.quantity > 0),
        };
      })
      .filter((p) => p.items.length > 0);

    if (packages.length === 0) {
      return NextResponse.json({ ok: false, error: "At least one package with line items is required" }, { status: 400 });
    }

    const result = await createManualShipmentsForOrder({
      orderId: resolvedOrderId,
      packages,
    });

    if (result.status === "error") {
      return NextResponse.json({ ok: false, error: result.message ?? "Pack failed" }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      created: result.shipments.length,
      shipmentIds: result.shipments.map((s) => s.id),
    });
  } catch (error: any) {
    console.error("[GALAXUS][ORDERS][PACK] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Pack failed" }, { status: 500 });
  }
}
