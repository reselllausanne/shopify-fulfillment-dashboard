import { prisma } from "@/app/lib/prisma";
import type { GalaxusOrderInput } from "./types";

type IngestResult = {
  galaxusOrderId: string;
  orderId: string;
  lines: number;
  shipments: number;
  statusEvents: number;
};

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing or invalid ${field}`);
  }
  return value.trim();
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Missing or invalid ${field}`);
  }
  return value;
}

function parseDate(value: string | undefined, field: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date for ${field}`);
  }
  return date;
}

function parseRequiredDate(value: string, field: string): Date {
  const date = parseDate(value, field);
  if (!date) throw new Error(`Missing ${field}`);
  return date;
}

function normalizeOrder(order: GalaxusOrderInput) {
  const galaxusOrderId = requireString(order.galaxusOrderId, "galaxusOrderId");
  const orderDate = parseRequiredDate(order.orderDate, "orderDate");
  const deliveryDate = parseDate(order.deliveryDate, "deliveryDate");
  const customerName = requireString(order.customerName, "customerName");
  const customerAddress1 = requireString(order.customerAddress1, "customerAddress1");
  const customerPostalCode = requireString(order.customerPostalCode, "customerPostalCode");
  const customerCity = requireString(order.customerCity, "customerCity");
  const customerCountry = requireString(order.customerCountry, "customerCountry");
  if (!Array.isArray(order.lines) || order.lines.length === 0) {
    throw new Error(`Order ${galaxusOrderId} has no lines`);
  }

  return {
    galaxusOrderId,
    orderDate,
    deliveryDate,
    currencyCode: order.currencyCode ?? "CHF",
    customerName,
    customerAddress1,
    customerAddress2: order.customerAddress2 ?? null,
    customerPostalCode,
    customerCity,
    customerCountry,
    customerVatId: order.customerVatId ?? null,
    recipientName: order.recipientName ?? null,
    recipientAddress1: order.recipientAddress1 ?? null,
    recipientAddress2: order.recipientAddress2 ?? null,
    recipientPostalCode: order.recipientPostalCode ?? null,
    recipientCity: order.recipientCity ?? null,
    recipientCountry: order.recipientCountry ?? null,
    recipientPhone: order.recipientPhone ?? null,
    referencePerson: order.referencePerson ?? null,
    yourReference: order.yourReference ?? null,
    afterSalesHandling: order.afterSalesHandling ?? false,
    orderNumber: order.orderNumber ?? null,
  };
}

export async function ingestGalaxusOrders(orders: GalaxusOrderInput[]): Promise<IngestResult[]> {
  if (!Array.isArray(orders) || orders.length === 0) {
    throw new Error("No orders provided.");
  }

  const results: IngestResult[] = [];

  for (const order of orders) {
    const normalized = normalizeOrder(order);
    const lines = order.lines.map((line) => ({
      lineNumber: requireNumber(line.lineNumber, "lineNumber"),
      supplierSku: line.supplierSku ?? null,
      supplierVariantId: line.supplierVariantId ?? null,
      productName: requireString(line.productName, "productName"),
      description: line.description ?? null,
      size: line.size ?? null,
      gtin: line.gtin ?? null,
      providerKey: line.providerKey ?? null,
      quantity: requireNumber(line.quantity, "quantity"),
      vatRate: requireString(line.vatRate, "vatRate"),
      unitNetPrice: requireString(line.unitNetPrice, "unitNetPrice"),
      lineNetAmount: requireString(line.lineNetAmount, "lineNetAmount"),
      currencyCode: line.currencyCode ?? normalized.currencyCode,
    }));

    const shipments = order.shipments ?? [];
    const statusEvents = order.statusEvents ?? [];

    const result = await prisma.$transaction(async (tx) => {
      const savedOrder = await tx.galaxusOrder.upsert({
        where: { galaxusOrderId: normalized.galaxusOrderId },
        create: {
          ...normalized,
        },
        update: {
          orderNumber: normalized.orderNumber,
          orderDate: normalized.orderDate,
          deliveryDate: normalized.deliveryDate,
          currencyCode: normalized.currencyCode,
          customerName: normalized.customerName,
          customerAddress1: normalized.customerAddress1,
          customerAddress2: normalized.customerAddress2,
          customerPostalCode: normalized.customerPostalCode,
          customerCity: normalized.customerCity,
          customerCountry: normalized.customerCountry,
          customerVatId: normalized.customerVatId,
          recipientName: normalized.recipientName,
          recipientAddress1: normalized.recipientAddress1,
          recipientAddress2: normalized.recipientAddress2,
          recipientPostalCode: normalized.recipientPostalCode,
          recipientCity: normalized.recipientCity,
          recipientCountry: normalized.recipientCountry,
          recipientPhone: normalized.recipientPhone,
          referencePerson: normalized.referencePerson,
          yourReference: normalized.yourReference,
          afterSalesHandling: normalized.afterSalesHandling,
        },
      });

      await tx.galaxusOrderLine.deleteMany({
        where: { orderId: savedOrder.id },
      });
      await tx.galaxusOrderLine.createMany({
        data: lines.map((line) => ({
          orderId: savedOrder.id,
          lineNumber: line.lineNumber,
          supplierSku: line.supplierSku,
          supplierVariantId: line.supplierVariantId,
          productName: line.productName,
          description: line.description,
          size: line.size,
          gtin: line.gtin,
          providerKey: line.providerKey,
          quantity: line.quantity,
          vatRate: line.vatRate,
          unitNetPrice: line.unitNetPrice,
          lineNetAmount: line.lineNetAmount,
          currencyCode: line.currencyCode,
        })),
      });

      for (const shipment of shipments) {
        const shipmentId = requireString(shipment.shipmentId, "shipmentId");
        await tx.shipment.upsert({
          where: { shipmentId },
          create: {
            orderId: savedOrder.id,
            shipmentId,
            deliveryNoteNumber: shipment.deliveryNoteNumber ?? null,
            deliveryNoteCreatedAt: parseDate(shipment.deliveryNoteCreatedAt, "deliveryNoteCreatedAt") ?? null,
            incoterms: shipment.incoterms ?? null,
            sscc: shipment.sscc ?? null,
            carrier: shipment.carrier ?? null,
            trackingNumber: shipment.trackingNumber ?? null,
            shippedAt: parseDate(shipment.shippedAt, "shippedAt") ?? null,
          },
          update: {
            orderId: savedOrder.id,
            deliveryNoteNumber: shipment.deliveryNoteNumber ?? null,
            deliveryNoteCreatedAt: parseDate(shipment.deliveryNoteCreatedAt, "deliveryNoteCreatedAt") ?? null,
            incoterms: shipment.incoterms ?? null,
            sscc: shipment.sscc ?? null,
            carrier: shipment.carrier ?? null,
            trackingNumber: shipment.trackingNumber ?? null,
            shippedAt: parseDate(shipment.shippedAt, "shippedAt") ?? null,
          },
        });
      }

      if (statusEvents.length > 0) {
        await tx.orderStatusEvent.deleteMany({
          where: { orderId: savedOrder.id, source: "galaxus" },
        });
        await tx.orderStatusEvent.createMany({
          data: statusEvents.map((event) => ({
            orderId: savedOrder.id,
            source: event.source ?? "galaxus",
            type: requireString(event.type, "statusEvents.type"),
            payloadJson: event.payloadJson ?? undefined,
            createdAt: parseDate(event.createdAt, "statusEvents.createdAt") ?? undefined,
          })),
        });
      }

      return {
        galaxusOrderId: savedOrder.galaxusOrderId,
        orderId: savedOrder.id,
        lines: lines.length,
        shipments: shipments.length,
        statusEvents: statusEvents.length,
      };
    });

    results.push(result);
  }

  return results;
}
