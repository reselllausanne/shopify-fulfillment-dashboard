import "server-only";

import type { GalaxusOrder, GalaxusOrderLine, Shipment } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { buildDocNumber } from "@/galaxus/edi/docNumbers";
import { allocateSscc } from "@/galaxus/sscc/generator";
import { generateSsccLabelPdf } from "@/galaxus/labels/ssccLabel";
import { getStorageAdapter } from "@/galaxus/storage/storage";
import { packOrderLines } from "./packing";

type CreateShipmentsOptions = {
  orderId: string;
  maxPairsPerParcel?: number;
  allowSplit?: boolean;
  trackingNumbers?: string[];
  carrierRaw?: string | null;
  carrierFinal?: string | null;
  shippedAt?: Date;
  deliveryType?: string;
  packageType?: "PARCEL" | "PALLET";
  force?: boolean;
};

type CreateShipmentsResult = {
  status: "created" | "skipped" | "error";
  shipments: Shipment[];
  message?: string;
};

export async function createShipmentsForOrder(options: CreateShipmentsOptions): Promise<CreateShipmentsResult> {
  const order = await resolveOrder(options.orderId);
  if (!order) {
    return { status: "error", shipments: [], message: "Order not found" };
  }

  if (!options.force) {
    const existing = await prisma.shipment.findFirst({ where: { orderId: order.id } });
    if (existing) {
      return { status: "skipped", shipments: [], message: "Shipments already exist" };
    }
  }

  validateOrderLines(order.lines);

  const packed = packOrderLines(order.lines, {
    maxPairsPerParcel: options.maxPairsPerParcel,
    allowSplit: options.allowSplit,
  });

  const shipments: Shipment[] = [];
  const shippedAt = options.shippedAt ?? new Date();
  const storage = getStorageAdapter();

  for (let index = 0; index < packed.length; index += 1) {
    const packageId = await allocateSscc();
    const dispatchNotificationId = buildDispatchNotificationId(order.galaxusOrderId, index);
    const trackingNumber = options.trackingNumbers?.[index] ?? null;
    const packageType = options.packageType ?? "PARCEL";

    const created = await prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.create({
        data: {
          orderId: order.id,
          shipmentId: `SHIP-${order.galaxusOrderId}-${Date.now()}-${index + 1}`,
          dispatchNotificationId,
          dispatchNotificationCreatedAt: new Date(),
          incoterms: null,
          packageId,
          deliveryType: options.deliveryType ?? order.deliveryType ?? "warehouse_delivery",
          carrierRaw: options.carrierRaw ?? "eurosender",
          carrierFinal: options.carrierFinal ?? null,
          trackingNumber,
          packageType,
          shippedAt,
          delrStatus: "PENDING",
        },
      });

      await tx.shipmentItem.createMany({
        data: packed[index].items.map((item) => ({
          shipmentId: shipment.id,
          orderId: order.id,
          supplierPid: item.line.supplierPid ?? "",
          gtin14: item.line.gtin ?? "",
          buyerPid: item.line.buyerPid ?? null,
          quantity: item.quantity,
        })),
      });

      return shipment;
    });

    const label = await generateSsccLabelPdf(order, packageId);
    const key = `galaxus/${order.galaxusOrderId}/shipments/${created.id}/sscc-label.pdf`;
    const stored = await storage.uploadPdf(key, label.pdf);

    const updated = await prisma.shipment.update({
      where: { id: created.id },
      data: {
        labelZpl: label.zpl,
        labelPdfUrl: stored.storageUrl,
        labelGeneratedAt: new Date(),
      },
    });

    shipments.push(updated);
  }

  return { status: "created", shipments };
}

async function resolveOrder(orderIdOrRef: string) {
  const order = await prisma.galaxusOrder.findUnique({
    where: { id: orderIdOrRef },
    include: { lines: true },
  });
  if (order) return order;
  return prisma.galaxusOrder.findUnique({
    where: { galaxusOrderId: orderIdOrRef },
    include: { lines: true },
  });
}

function validateOrderLines(lines: GalaxusOrderLine[]) {
  for (const line of lines) {
    if (!line.supplierPid) {
      throw new Error(`Missing supplier PID for line ${line.lineNumber}`);
    }
    if (!line.gtin) {
      throw new Error(`Missing GTIN for line ${line.lineNumber}`);
    }
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new Error(`Invalid quantity for line ${line.lineNumber}`);
    }
  }
}

function buildDispatchNotificationId(orderRef: string, index: number) {
  const base = buildDocNumber("GDN");
  const normalized = orderRef.replace(/[^A-Za-z0-9]/g, "");
  return `${base}-${normalized}-P${index + 1}`;
}
