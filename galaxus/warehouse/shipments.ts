import "server-only";

import type { GalaxusOrder, GalaxusOrderLine, Shipment } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { buildDocNumber } from "@/galaxus/edi/docNumbers";
import { allocateSscc } from "@/galaxus/sscc/generator";
import { generateSsccLabelPdf } from "@/galaxus/labels/ssccLabel";
import { getStorageAdapter } from "@/galaxus/storage/storage";
import { packOrderLines } from "./packing";
import { buildProviderKey, extractProviderKeyFromOrderKey, normalizeProviderKey, resolveSupplierCode } from "@/galaxus/supplier/providerKey";
import { accumulateBestCandidates } from "@/galaxus/exports/gtinSelection";
import { renderDeliveryNoteHtml } from "@/galaxus/documents/templates/deliveryNote";
import { renderPdfFromHtml } from "@/galaxus/documents/renderers/playwrightRenderer";
import type { DeliveryNoteData, DeliveryNoteOrderGroup, OrderLine } from "@/galaxus/documents/types";
import {
  GALAXUS_SUPPLIER_ADDRESS_LINES,
  GALAXUS_SUPPLIER_EMAIL,
  GALAXUS_SUPPLIER_NAME,
  GALAXUS_SUPPLIER_PHONE,
  GALAXUS_SUPPLIER_VAT_ID,
  GALAXUS_SUPPLIER_WEBSITE,
} from "@/galaxus/config";

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
  const prismaAny = prisma as any;
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

  const orderAny = order as any;
  validateOrderLines(orderAny.lines);

  const groupedLines = await groupLinesByProviderKey(orderAny.lines);
  const shipments: Shipment[] = [];
  const shippedAt = options.shippedAt ?? new Date();
  const storage = getStorageAdapter();
  let shipmentIndex = 0;

  for (const group of groupedLines) {
    const packed = packOrderLines(group.lines, {
      maxPairsPerParcel: options.maxPairsPerParcel,
      allowSplit: options.allowSplit,
    });

    for (let index = 0; index < packed.length; index += 1) {
      const packageId = await allocateSscc();
      const dispatchNotificationId = buildDispatchNotificationId(order.galaxusOrderId, shipmentIndex);
      const trackingNumber = options.trackingNumbers?.[shipmentIndex] ?? null;
      const packageType = options.packageType ?? "PARCEL";

      const created = await prismaAny.$transaction(async (tx: any) => {
        const shipment = await tx.shipment.create({
          data: {
            orderId: order.id,
            shipmentId: `SHIP-${order.galaxusOrderId}-${group.providerKey}-${Date.now()}-${shipmentIndex + 1}`,
            dispatchNotificationId,
            dispatchNotificationCreatedAt: new Date(),
            incoterms: null,
            packageId,
            deliveryType: options.deliveryType ?? orderAny.deliveryType ?? "warehouse_delivery",
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
            supplierPid: (item.line as any).supplierPid ?? "",
            gtin14: item.line.gtin ?? "",
            buyerPid: (item.line as any).buyerPid ?? null,
            quantity: item.quantity,
          })),
        });

        return shipment;
      });

      const deliveryNotePdf = await renderPdfFromHtml({
        html: renderDeliveryNoteHtml(
          buildDeliveryNoteData(
            orderAny,
            packed[index].items,
            created.dispatchNotificationId,
            created.incoterms,
            created.shipmentId
          )
        ),
        format: "A4",
        showPageNumbers: true,
      });
      const deliveryKey = `galaxus/${order.galaxusOrderId}/delivery_note/${created.id}.pdf`;
      const deliveryStored = await storage.uploadPdf(deliveryKey, deliveryNotePdf);
      await prismaAny.document.create({
        data: {
          orderId: order.id,
          shipmentId: created.id,
          type: "DELIVERY_NOTE",
          version: 1,
          storageUrl: deliveryStored.storageUrl,
        },
      });

      const label = await generateSsccLabelPdf(order, packageId);
      const key = `galaxus/${order.galaxusOrderId}/shipments/${created.id}/sscc-label.pdf`;
      const stored = await storage.uploadPdf(key, label.pdf);

      const updated = await prismaAny.shipment.update({
        where: { id: created.id },
        data: {
          labelZpl: label.zpl,
          labelPdfUrl: stored.storageUrl,
          labelGeneratedAt: new Date(),
        },
      });

      shipments.push(updated);
      shipmentIndex += 1;
    }
  }

  return { status: "created", shipments };
}

async function groupLinesByProviderKey(lines: Array<any>) {
  const groups = new Map<string, any[]>();
  for (const line of lines) {
    const providerKey = await resolveProviderKeyForLine(line);
    const existing = groups.get(providerKey) ?? [];
    existing.push(line);
    groups.set(providerKey, existing);
  }

  return Array.from(groups.entries()).map(([providerKey, groupLines]) => ({
    providerKey,
    lines: groupLines,
  }));
}

async function resolveProviderKeyForLine(line: any): Promise<string> {
  const direct = extractProviderKeyFromOrderKey(line.providerKey ?? null);
  if (direct) return direct;

  const variantId = line.supplierVariantId ?? null;
  if (variantId) {
    return normalizeProviderKey(resolveSupplierCode(variantId)) ?? "UNK";
  }

  const gtin = line.gtin ?? null;
  if (gtin) {
    const mappings = await prisma.variantMapping.findMany({
      where: { gtin, status: { in: ["MATCHED", "SUPPLIER_GTIN", "PARTNER_GTIN"] } },
      include: {
        supplierVariant: true,
        kickdbVariant: { include: { product: true } },
      },
    });
    if (mappings.length > 0) {
      const bestByGtin = accumulateBestCandidates(mappings, new Map());
      const candidate = bestByGtin.get(gtin);
      const variant = candidate?.variant ?? null;
      const fromVariant =
        normalizeProviderKey(variant?.providerKey ?? null) ??
        (variant?.supplierVariantId ? normalizeProviderKey(resolveSupplierCode(variant.supplierVariantId)) : null);
      if (fromVariant) return fromVariant;
    }
  }

  return "UNK";
}

function buildDeliveryNoteData(
  order: GalaxusOrder,
  items: Array<{ line: GalaxusOrderLine; quantity: number }>,
  deliveryNoteNumber: string | null,
  incoterms: string | null,
  shipmentId: string
): DeliveryNoteData {
  const lines: OrderLine[] = items.map((item) => {
    const line = item.line as any;
    const providerKey = buildProviderKey(line.gtin, line.supplierVariantId) ?? line.gtin ?? "";
    const unitNetPrice = Number(line.unitNetPrice ?? 0);
    const lineNetAmount = unitNetPrice * item.quantity;
    return {
      lineNumber: line.lineNumber,
      articleNumber: providerKey,
      description: line.productName ?? "Item",
      size: line.size ?? null,
      gtin: line.gtin ?? null,
      providerKey,
      sku: line.supplierSku ?? line.supplierVariantId ?? null,
      quantity: item.quantity,
      vatRate: Number(line.vatRate ?? 0),
      unitNetPrice,
      lineNetAmount,
    };
  });

  const group: DeliveryNoteOrderGroup = {
    orderNumber: order.orderNumber ?? order.galaxusOrderId,
    deliveryDate: order.deliveryDate,
    lines,
  };

  return {
    shipmentId,
    createdAt: new Date(),
    deliveryNoteNumber: deliveryNoteNumber ?? buildDeliveryNoteNumber(order),
    incoterms: incoterms ?? null,
    buyer: {
      name: order.recipientName ?? "",
      line1: order.recipientAddress1 ?? "",
      line2: order.recipientAddress2 ?? null,
      postalCode: order.recipientPostalCode ?? "",
      city: order.recipientCity ?? "",
      country: order.recipientCountry ?? "",
    },
    supplier: {
      name: GALAXUS_SUPPLIER_NAME,
      addressLines: GALAXUS_SUPPLIER_ADDRESS_LINES,
      phone: GALAXUS_SUPPLIER_PHONE ?? null,
      email: GALAXUS_SUPPLIER_EMAIL ?? null,
      website: GALAXUS_SUPPLIER_WEBSITE ?? null,
      vatId: GALAXUS_SUPPLIER_VAT_ID ?? null,
    },
    orderReference: order.orderNumber ?? order.galaxusOrderId,
    referencePerson: order.referencePerson ?? null,
    yourReference: order.yourReference ?? null,
    buyerPhone: order.recipientPhone ?? null,
    afterSalesHandling: order.afterSalesHandling ?? false,
    legalNotice: null,
    groups: [group],
  };
}

function buildDeliveryNoteNumber(order: GalaxusOrder): string {
  const base = buildDocNumber("GDN");
  const normalized = order.galaxusOrderId.replace(/[^A-Za-z0-9]/g, "");
  return `${base}-${normalized}`;
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

function validateOrderLines(lines: Array<any>) {
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
