import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toPositiveInt(value: unknown, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ orderId: string; lineId: string }> }
) {
  try {
    const { orderId, lineId } = await params;
    const prismaAny = prisma as any;

    const order =
      (await prisma.galaxusOrder.findUnique({
        where: { id: orderId },
        select: { id: true, galaxusOrderId: true },
      })) ??
      (await prisma.galaxusOrder.findUnique({
        where: { galaxusOrderId: orderId },
        select: { id: true, galaxusOrderId: true },
      }));

    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    const line = await prisma.galaxusOrderLine.findFirst({
      where: { id: lineId, orderId: order.id },
      select: {
        id: true,
        lineNumber: true,
        quantity: true,
        gtin: true,
        supplierPid: true,
        supplierVariantId: true,
      },
    });

    if (!line) {
      return NextResponse.json({ ok: false, error: "Order line not found" }, { status: 404 });
    }

    const summary = await prismaAny.$transaction(async (tx: any) => {
      const shippedOrDelr = await tx.shipment.findFirst({
        where: {
          orderId: order.id,
          OR: [
            { delrSentAt: { not: null } },
            { shippedAt: { not: null } },
            { trackingNumber: { not: null } },
          ],
        },
        select: { id: true },
      });
      if (shippedOrDelr) {
        throw new Error("Cannot remove line after shipment is shipped or DELR sent.");
      }

      const lineQty = toPositiveInt(line.quantity, 1);
      const gtin = String(line.gtin ?? "").trim();
      const supplierPid = String(line.supplierPid ?? "").trim();
      const supplierVariantId = String(line.supplierVariantId ?? "").trim();

      let removedFromShipmentItems = 0;
      let deletedShipmentItems = 0;
      let updatedShipmentItems = 0;

      if (gtin) {
        let remainingToRemove = lineQty;
        const shipmentItemWhere: Record<string, unknown> = {
          orderId: order.id,
          gtin14: gtin,
        };
        if (supplierPid) shipmentItemWhere.supplierPid = supplierPid;

        const shipmentItems = await tx.shipmentItem.findMany({
          where: shipmentItemWhere,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true, quantity: true },
        });

        for (const item of shipmentItems) {
          if (remainingToRemove <= 0) break;
          const itemQty = toPositiveInt(item.quantity, 0);
          if (itemQty <= 0) continue;

          if (itemQty <= remainingToRemove) {
            await tx.shipmentItem.delete({ where: { id: item.id } });
            remainingToRemove -= itemQty;
            removedFromShipmentItems += itemQty;
            deletedShipmentItems += 1;
            continue;
          }

          await tx.shipmentItem.update({
            where: { id: item.id },
            data: { quantity: itemQty - remainingToRemove },
          });
          removedFromShipmentItems += remainingToRemove;
          remainingToRemove = 0;
          updatedShipmentItems += 1;
        }
      }

      let deletedPendingStxUnits = 0;
      if (supplierVariantId.startsWith("stx_") && gtin) {
        const pendingUnits = await tx.stxPurchaseUnit.findMany({
          where: {
            galaxusOrderId: order.galaxusOrderId,
            gtin,
            supplierVariantId,
            stockxOrderId: null,
          },
          orderBy: { createdAt: "asc" },
          take: lineQty,
          select: { id: true },
        });

        if (pendingUnits.length > 0) {
          await tx.stxPurchaseUnit.deleteMany({
            where: { id: { in: pendingUnits.map((unit: any) => unit.id) } },
          });
          deletedPendingStxUnits = pendingUnits.length;
        }
      }

      await tx.galaxusOrderLine.delete({ where: { id: line.id } });

      if (tx.orderRoutingIssue?.deleteMany) {
        await tx.orderRoutingIssue.deleteMany({ where: { orderLineId: line.id } });
      }

      const emptyOpenShipments = await tx.shipment.findMany({
        where: {
          orderId: order.id,
          items: { none: {} },
          supplierOrderRef: null,
          delrSentAt: null,
          shippedAt: null,
          trackingNumber: null,
        },
        select: { id: true },
      });

      if (emptyOpenShipments.length > 0) {
        await tx.shipment.deleteMany({
          where: { id: { in: emptyOpenShipments.map((shipment: any) => shipment.id) } },
        });
      }

      const remainingLines = await tx.galaxusOrderLine.count({ where: { orderId: order.id } });
      const remainingShipments = await tx.shipment.count({ where: { orderId: order.id } });

      return {
        removedLineId: line.id,
        removedLineNumber: line.lineNumber,
        removedLineQty: lineQty,
        removedFromShipmentItems,
        deletedShipmentItems,
        updatedShipmentItems,
        deletedPendingStxUnits,
        deletedEmptyShipments: emptyOpenShipments.length,
        remainingLines,
        remainingShipments,
      };
    });

    return NextResponse.json({
      ok: true,
      orderId: order.id,
      galaxusOrderId: order.galaxusOrderId,
      summary,
    });
  } catch (error: any) {
    console.error("[GALAXUS][ORDERS] Remove line failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to remove order line" },
      { status: 500 }
    );
  }
}
