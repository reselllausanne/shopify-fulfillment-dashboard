import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";
import { isGalaxusShipmentDispatchConfirmed } from "@/galaxus/orders/shipmentDispatch";
import { getInvoiceLineProgressByOrderIds } from "@/galaxus/edi/invoiceCoverage";
import { buildLinkedCountByOrderId } from "@/galaxus/orders/lineProcurement";
import { getOpenWarehouseLineCountByOrderId } from "@/galaxus/warehouse/shipmentLineCoverage";

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
    const excludeDeliveryType = String(searchParams.get("excludeDeliveryType") ?? "").trim();
    const includeInvoice = searchParams.get("includeInvoice") !== "0";
    const includeLinked = searchParams.get("includeLinked") !== "0";
    const includeWarehouse = searchParams.get("includeWarehouse") !== "0";
    const q = String(searchParams.get("q") ?? "").trim();
    const warehouseOpen = searchParams.get("warehouseOpen") === "1";

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
    } else if (excludeDeliveryType) {
      baseWhere.deliveryType = { not: excludeDeliveryType };
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
                  {
                    lines: {
                      some: {
                        OR: [
                          { gtin: { contains: q, mode: "insensitive" } },
                          { supplierSku: { contains: q, mode: "insensitive" } },
                          { productName: { contains: q, mode: "insensitive" } },
                          { description: { contains: q, mode: "insensitive" } },
                          { supplierPid: { contains: q, mode: "insensitive" } },
                        ],
                      },
                    },
                  },
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
    if (includeInvoice && orderIds.length > 0) {
      try {
        invoiceProgressByOrderId = await getInvoiceLineProgressByOrderIds(orderIds);
      } catch (err) {
        console.error("[GALAXUS][ORDERS] Invoice progress batch failed:", err);
      }
    }
    // Align with order-detail procurement.ok (match rows OR StxPurchaseUnit OR warehouse stock).
    // Old SQL only counted GalaxusStockxMatch rows → STX-linked-via-units showed 0/N on left list.
    const linkedCountByOrderId = new Map<string, number>();
    if (includeLinked && orderIds.length > 0) {
      try {
        const orderRefs = orders.map((o) => o.galaxusOrderId).filter(Boolean);
        const prismaAny = prisma as any;
        const [lines, stockxMatches, stxUnits] = await Promise.all([
          prisma.galaxusOrderLine.findMany({
            where: { orderId: { in: orderIds } },
            select: {
              id: true,
              orderId: true,
              gtin: true,
              quantity: true,
              supplierPid: true,
              supplierSku: true,
              supplierVariantId: true,
              providerKey: true,
            },
          }),
          prismaAny.galaxusStockxMatch?.findMany
            ? prismaAny.galaxusStockxMatch
                .findMany({
                  where: { galaxusOrderId: { in: orderIds } },
                  select: {
                    galaxusOrderId: true,
                    galaxusOrderLineId: true,
                    galaxusGtin: true,
                    unitIndex: true,
                    stockxOrderId: true,
                    stockxOrderNumber: true,
                    stockxAmount: true,
                    stockxCurrencyCode: true,
                    stockxAwb: true,
                  },
                })
                .catch(() => [])
            : Promise.resolve([]),
          orderRefs.length > 0 && prismaAny.stxPurchaseUnit?.findMany
            ? prismaAny.stxPurchaseUnit
                .findMany({
                  where: {
                    galaxusOrderId: { in: orderRefs },
                    stockxOrderId: { not: null },
                    cancelledAt: null,
                  },
                  select: {
                    galaxusOrderId: true,
                    gtin: true,
                    supplierVariantId: true,
                    stockxOrderId: true,
                    stockxOrderNumber: true,
                    stockxSettledAmount: true,
                    stockxSettledCurrency: true,
                    awb: true,
                    cancelledAt: true,
                  },
                })
                .catch(() => [])
            : Promise.resolve([]),
        ]);
        const computed = buildLinkedCountByOrderId({
          orders,
          lines,
          stockxMatches: Array.isArray(stockxMatches) ? stockxMatches : [],
          stxUnits: Array.isArray(stxUnits) ? stxUnits : [],
        });
        for (const [id, count] of computed) {
          linkedCountByOrderId.set(id, count);
        }
      } catch {
        // If tables aren't available yet, just skip linked counts.
      }
    }
    const warehouseShippedByOrderId = new Map<string, number>();
    if (includeWarehouse && orderIds.length > 0) {
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
    let warehouseOpenLineCountByOrderId: Map<string, number> | null = null;
    if (warehouseOpen && orderIds.length > 0) {
      try {
        warehouseOpenLineCountByOrderId = await getOpenWarehouseLineCountByOrderId(orderIds);
      } catch (err) {
        console.error("[GALAXUS][ORDERS] Warehouse open line counts failed:", err);
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
      const linkedCount = includeLinked ? (linkedCountByOrderId.get(order.id) ?? 0) : 0;
      const warehouseLinesShipped = includeWarehouse ? (warehouseShippedByOrderId.get(order.id) ?? 0) : 0;
      const warehouseOpenLineCount =
        warehouseOpenLineCountByOrderId != null
          ? (warehouseOpenLineCountByOrderId.get(order.id) ?? 0)
          : null;
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
        warehouseOpenLineCount,
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
