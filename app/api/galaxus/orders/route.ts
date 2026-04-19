import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";
import { isGalaxusShipmentDispatchConfirmed } from "@/galaxus/orders/shipmentDispatch";
import { getInvoiceLineProgressByOrderIds } from "@/galaxus/edi/invoiceCoverage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? "20"), 500);
    const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
    const view = (searchParams.get("view") ?? "active").toLowerCase();
    if (!["active", "history", "all"].includes(view)) {
      return NextResponse.json({ ok: false, error: "Invalid view filter" }, { status: 400 });
    }
    const sort = (searchParams.get("sort") ?? "createdAt").toLowerCase();
    const orderBy =
      sort === "orderdate" ? { orderDate: "desc" as const } : { createdAt: "desc" as const };
    const deliveryType = String(searchParams.get("deliveryType") ?? "").trim();
    const q = String(searchParams.get("q") ?? "").trim();

    let baseWhere: Record<string, unknown> = {};
    if (view === "history") {
      baseWhere = { OR: [{ archivedAt: { not: null } }, { cancelledAt: { not: null } }] };
    } else if (view === "active") {
      baseWhere = { archivedAt: null, cancelledAt: null };
    } else {
      // view === "all" — include archived / cancelled (e.g. invoice lookup)
      baseWhere = {};
    }
    if (deliveryType) {
      baseWhere.deliveryType = deliveryType;
    }

    const where: Prisma.GalaxusOrderWhereInput =
      q.length > 0
        ? {
            AND: [
              baseWhere as Prisma.GalaxusOrderWhereInput,
              {
                OR: [
                  { galaxusOrderId: { contains: q, mode: "insensitive" } },
                  { orderNumber: { contains: q, mode: "insensitive" } },
                ],
              },
            ],
          }
        : (baseWhere as Prisma.GalaxusOrderWhereInput);

    const orders = await prisma.galaxusOrder.findMany({
      where,
      orderBy,
      take: limit,
      skip: offset,
      select: {
        id: true,
        galaxusOrderId: true,
        orderNumber: true,
        orderDate: true,
        deliveryType: true,
        customerName: true,
        recipientName: true,
        createdAt: true,
        ordrSentAt: true,
        ordrStatus: true,
        archivedAt: true,
        cancelledAt: true,
        cancelReason: true,
        shipments: {
          select: {
            status: true,
            shippedAt: true,
            trackingNumber: true,
            galaxusShippedAt: true,
            delrSentAt: true,
            delrStatus: true,
          },
        },
        _count: {
          select: {
            lines: true,
            shipments: true,
          },
        },
      },
    });

    const orderIds = orders.map((order) => order.id);
    let invoiceProgressByOrderId: Awaited<ReturnType<typeof getInvoiceLineProgressByOrderIds>> | null = null;
    try {
      invoiceProgressByOrderId = await getInvoiceLineProgressByOrderIds(orderIds);
    } catch (err) {
      console.error("[GALAXUS][ORDERS] Invoice progress batch failed:", err);
    }
    const linkedCountByOrderId = new Map<string, number>();
    if (orderIds.length > 0) {
      try {
        const rows = (await prisma.$queryRaw(
          Prisma.sql`
            SELECT m."galaxusOrderId", COUNT(*)::int AS "linkedCount"
            FROM "public"."GalaxusStockxMatch" m
            INNER JOIN "public"."GalaxusOrderLine" l
              ON l."id" = m."galaxusOrderLineId"
            WHERE m."galaxusOrderId" IN (${Prisma.join(orderIds)})
              AND l."orderId" = m."galaxusOrderId"
            GROUP BY m."galaxusOrderId"
          `
        )) as Array<{ galaxusOrderId: string; linkedCount: number }>;
        for (const row of rows) {
          linkedCountByOrderId.set(row.galaxusOrderId, Number(row.linkedCount) || 0);
        }
      } catch {
        // If the table isn't available yet, just skip linked counts.
      }
    }
    const warehouseShippedByOrderId = new Map<string, number>();
    if (orderIds.length > 0) {
      try {
        const rows = await prisma.galaxusOrderLine.groupBy({
          by: ["orderId"],
          where: { orderId: { in: orderIds }, warehouseMarkedShippedAt: { not: null } },
          _count: { _all: true },
        });
        for (const row of rows) {
          warehouseShippedByOrderId.set(row.orderId, Number(row._count?._all ?? 0) || 0);
        }
      } catch {
        // Ignore if warehouseMarkedShippedAt is not available.
      }
    }

    const items = orders.map((order) => {
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
      const linkedCount = linkedCountByOrderId.get(order.id) ?? 0;
      const warehouseLinesShipped = warehouseShippedByOrderId.get(order.id) ?? 0;
      const fulfillmentState =
        fulfilledCount > 0
          ? "fulfilled"
          : shippedCount > 0
          ? "shipped"
          : "to_process";
      const inv = invoiceProgressByOrderId?.get(order.id);
      const { shipments, ...rest } = order;
      return {
        ...rest,
        shippedCount,
        fulfilledCount,
        linkedCount,
        warehouseLinesShipped,
        fulfillmentState,
        invoiceLinesFullyInvoiced:
          invoiceProgressByOrderId != null ? (inv?.linesFullyInvoiced ?? 0) : null,
        invoiceLinesTotal: invoiceProgressByOrderId != null ? (inv?.lineCount ?? rest._count?.lines ?? 0) : null,
      };
    });

    return NextResponse.json({
      ok: true,
      items,
      nextOffset: orders.length === limit ? offset + limit : null,
    });
  } catch (error: any) {
    console.error("[GALAXUS][ORDERS] List failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
