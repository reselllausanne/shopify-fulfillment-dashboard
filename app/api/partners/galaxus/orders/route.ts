import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { isGalaxusShipmentDispatchConfirmed } from "@/galaxus/orders/shipmentDispatch";
import {
  collectGtinsFromLines,
  lineMatchesPartnerScope,
  resolvePartnerGtins,
} from "./partnerLineScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const SCAN_BATCH_SIZE = 250;
const MAX_SCAN_LOOPS = 20;

export async function GET(req: NextRequest) {
  try {
    const session = await getPartnerSession(req);
    if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const pk = normalizeProviderKey(session.partnerKey);
    if (!pk) return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "50"), 1), 200);
    const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
    const wantedCount = offset + limit + 1;

    const matched: Array<{
      id: string;
      galaxusOrderId: string;
      orderNumber: string;
      orderDate: Date;
      deliveryType: string | null;
      cancelledAt: Date | null;
      archivedAt: Date | null;
      ordrStatus: string | null;
      shippedCount: number;
      fulfilledCount: number;
      totalUnits: number;
      lineCount: number;
      fulfillmentState: string;
      _count: { lines: number; shipments: number };
    }> = [];

    let scanOffset = 0;
    let loops = 0;
    let reachedEnd = false;

    while (matched.length < wantedCount && loops < MAX_SCAN_LOOPS) {
      loops += 1;

      const orders = await prisma.galaxusOrder.findMany({
        orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
        take: SCAN_BATCH_SIZE,
        skip: scanOffset,
        select: {
          id: true,
          galaxusOrderId: true,
          orderNumber: true,
          orderDate: true,
          deliveryType: true,
          cancelledAt: true,
          archivedAt: true,
          ordrStatus: true,
          lines: {
            select: {
              id: true,
              gtin: true,
              quantity: true,
              providerKey: true,
              supplierVariantId: true,
            },
          },
          shipments: {
            select: {
              shippedAt: true,
              trackingNumber: true,
              galaxusShippedAt: true,
              delrSentAt: true,
              delrStatus: true,
            },
          },
          _count: { select: { lines: true, shipments: true } },
        },
      });

      if (orders.length === 0) {
        reachedEnd = true;
        break;
      }
      scanOffset += orders.length;

      const batchGtins = collectGtinsFromLines(orders.flatMap((order) => order.lines));
      const partnerGtins = await resolvePartnerGtins(batchGtins, pk);

      for (const order of orders) {
        const partnerLines = order.lines.filter((line) => lineMatchesPartnerScope(line, pk, partnerGtins));
        if (partnerLines.length === 0) continue;

        const totalUnits = partnerLines.reduce((sum, line) => sum + Number(line.quantity ?? 0), 0);
        const isDirect = String(order.deliveryType ?? "").toLowerCase() === "direct_delivery";
        const shippedCount = isDirect
          ? order.shipments.filter((shipment) => Boolean(shipment.trackingNumber)).length
          : order.shipments.filter(isGalaxusShipmentDispatchConfirmed).length;
        const fulfilledCount = isDirect
          ? order.shipments.filter((shipment) => Boolean(shipment.delrSentAt)).length
          : order.shipments.filter((shipment) => {
              const delrStatus = String(shipment.delrStatus ?? "").toUpperCase();
              return Boolean(shipment.delrSentAt) || delrStatus === "UPLOADED" || delrStatus === "SENT";
            }).length;
        const fulfillmentState =
          fulfilledCount > 0 ? "fulfilled" : shippedCount > 0 ? "shipped" : "to_process";

        matched.push({
          id: order.id,
          galaxusOrderId: order.galaxusOrderId,
          orderNumber: order.orderNumber ?? order.galaxusOrderId,
          orderDate: order.orderDate,
          deliveryType: order.deliveryType ?? null,
          cancelledAt: order.cancelledAt ?? null,
          archivedAt: order.archivedAt ?? null,
          ordrStatus: order.ordrStatus ?? null,
          shippedCount,
          fulfilledCount,
          totalUnits,
          lineCount: partnerLines.length,
          fulfillmentState,
          _count: order._count,
        });

        if (matched.length >= wantedCount) break;
      }

      if (orders.length < SCAN_BATCH_SIZE) {
        reachedEnd = true;
        break;
      }
    }

    const items = matched.slice(offset, offset + limit);
    const hasMore = matched.length > offset + limit || !reachedEnd;

    return NextResponse.json({
      ok: true,
      items,
      nextOffset: hasMore && items.length > 0 ? offset + items.length : null,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to load Galaxus orders" },
      { status: 500 }
    );
  }
}
