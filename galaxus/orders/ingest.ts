import { prisma } from "@/app/lib/prisma";
import type { GalaxusOrderInput } from "./types";

type IngestResult = {
  galaxusOrderId: string;
  orderId: string;
  lines: number;
  shipments: number;
  statusEvents: number;
};

type ComparableLine = {
  lineNumber: number;
  supplierPid: string | null;
  buyerPid: string | null;
  orderUnit: string | null;
  supplierSku: string | null;
  supplierVariantId: string | null;
  productName: string;
  description: string | null;
  size: string | null;
  gtin: string | null;
  providerKey: string | null;
  quantity: number;
  qtyConfirmed: number | null;
  vatRate: string;
  taxAmountPerUnit: string | number | null;
  unitNetPrice: string;
  lineNetAmount: string;
  priceLineAmount: string | number | null;
  arrivalDateStart: Date | null;
  arrivalDateEnd: Date | null;
  currencyCode: string;
};

type ComparableShipment = {
  orderId: string | null;
  dispatchNotificationId: string | null;
  dispatchNotificationCreatedAt: Date | null;
  incoterms: string | null;
  packageId: string | null;
  deliveryType: string | null;
  carrierRaw: string | null;
  carrierFinal: string | null;
  trackingNumber: string | null;
  packageType: string | null;
  shippedAt: Date | null;
  delrFileName: string | null;
  delrSentAt: Date | null;
  delrStatus: string | null;
  delrError: string | null;
  labelZpl: string | null;
  labelPdfUrl: string | null;
  labelGeneratedAt: Date | null;
};

type ComparableStatusEvent = {
  source: string | null;
  type: string;
  createdAt: Date | null;
  payloadJson?: unknown;
};

type ComparableShipmentItem = {
  supplierPid: string;
  gtin14: string;
  buyerPid: string | null;
  quantity: number;
};

function normalizeDateValue(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizeLineKey(line: ComparableLine): string {
  return [
    line.lineNumber,
    line.supplierPid ?? "",
    line.buyerPid ?? "",
    line.orderUnit ?? "",
    line.supplierSku ?? "",
    line.supplierVariantId ?? "",
    line.productName ?? "",
    line.description ?? "",
    line.size ?? "",
    line.gtin ?? "",
    line.providerKey ?? "",
    line.quantity,
    line.qtyConfirmed ?? "",
    String(line.vatRate ?? ""),
    line.taxAmountPerUnit ?? "",
    String(line.unitNetPrice ?? ""),
    String(line.lineNetAmount ?? ""),
    line.priceLineAmount ?? "",
    normalizeDateValue(line.arrivalDateStart),
    normalizeDateValue(line.arrivalDateEnd),
    line.currencyCode ?? "",
  ].join("|");
}

function normalizeShipmentKey(shipment: ComparableShipment): string {
  return [
    shipment.orderId ?? "",
    shipment.dispatchNotificationId ?? "",
    normalizeDateValue(shipment.dispatchNotificationCreatedAt),
    shipment.incoterms ?? "",
    shipment.packageId ?? "",
    shipment.deliveryType ?? "",
    shipment.carrierRaw ?? "",
    shipment.carrierFinal ?? "",
    shipment.trackingNumber ?? "",
    shipment.packageType ?? "",
    normalizeDateValue(shipment.shippedAt),
    shipment.delrFileName ?? "",
    normalizeDateValue(shipment.delrSentAt),
    shipment.delrStatus ?? "",
    shipment.delrError ?? "",
    shipment.labelZpl ?? "",
    shipment.labelPdfUrl ?? "",
    normalizeDateValue(shipment.labelGeneratedAt),
  ].join("|");
}

function normalizeStatusEventKey(event: ComparableStatusEvent): string {
  return [
    event.source ?? "",
    event.type ?? "",
    normalizeDateValue(event.createdAt),
    JSON.stringify(event.payloadJson ?? null),
  ].join("|");
}

function normalizeShipmentItemKey(item: ComparableShipmentItem): string {
  return [item.supplierPid, item.gtin14, item.buyerPid ?? "", item.quantity].join("|");
}

function arraysEqual<T>(left: T[], right: T[], toKey: (value: T) => string): boolean {
  if (left.length !== right.length) return false;
  const leftKeys = left.map(toKey).sort();
  const rightKeys = right.map(toKey).sort();
  for (let i = 0; i < leftKeys.length; i += 1) {
    if (leftKeys[i] !== rightKeys[i]) return false;
  }
  return true;
}

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
  const generationDate = parseDate(order.generationDate, "generationDate");
  const ordrSentAt = parseDate(order.ordrSentAt, "ordrSentAt");
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
    generationDate,
    language: order.language ?? null,
    deliveryDate,
    currencyCode: order.currencyCode ?? "CHF",
    customerName,
    customerAddress1,
    customerAddress2: order.customerAddress2 ?? null,
    customerPostalCode,
    customerCity,
    customerCountry,
    customerCountryCode: order.customerCountryCode ?? null,
    customerEmail: order.customerEmail ?? null,
    customerVatId: order.customerVatId ?? null,
    recipientName: order.recipientName ?? null,
    recipientAddress1: order.recipientAddress1 ?? null,
    recipientAddress2: order.recipientAddress2 ?? null,
    recipientPostalCode: order.recipientPostalCode ?? null,
    recipientCity: order.recipientCity ?? null,
    recipientCountry: order.recipientCountry ?? null,
    recipientCountryCode: order.recipientCountryCode ?? null,
    recipientEmail: order.recipientEmail ?? null,
    recipientPhone: order.deliveryType === "direct_delivery" ? null : order.recipientPhone ?? null,
    referencePerson: order.referencePerson ?? null,
    yourReference: order.yourReference ?? null,
    afterSalesHandling: order.afterSalesHandling ?? false,
    orderNumber: order.orderNumber ?? null,
    customerType: order.customerType ?? null,
    deliveryType: order.deliveryType ?? null,
    isCollectiveOrder: order.isCollectiveOrder ?? null,
    physicalDeliveryNoteRequired: order.physicalDeliveryNoteRequired ?? false,
    saturdayDeliveryAllowed: order.saturdayDeliveryAllowed ?? null,
    endCustomerOrderReference: order.endCustomerOrderReference ?? null,
    buyerIdRef: order.buyerIdRef ?? null,
    supplierIdRef: order.supplierIdRef ?? null,
    supplierOrderId: order.supplierOrderId ?? null,
    ordrSentAt: ordrSentAt ?? null,
    ordrMode: order.ordrMode ?? null,
    buyerPartyId: order.buyerPartyId ?? null,
    buyerPartyGln: order.buyerPartyGln ?? null,
    supplierPartyId: order.supplierPartyId ?? null,
    deliveryPartyId: order.deliveryPartyId ?? null,
    marketplacePartyId: order.marketplacePartyId ?? null,
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
      supplierPid: line.supplierPid ?? null,
      buyerPid: line.buyerPid ?? null,
      orderUnit: line.orderUnit ?? null,
      supplierSku: line.supplierSku ?? null,
      supplierVariantId: line.supplierVariantId ?? null,
      productName: requireString(line.productName, "productName"),
      description: line.description ?? null,
      size: line.size ?? null,
      gtin: line.gtin ?? null,
      providerKey: line.providerKey ?? null,
      quantity: requireNumber(line.quantity, "quantity"),
      qtyConfirmed: line.qtyConfirmed ?? null,
      vatRate: requireString(line.vatRate, "vatRate"),
      taxAmountPerUnit: line.taxAmountPerUnit ?? null,
      unitNetPrice: requireString(line.unitNetPrice, "unitNetPrice"),
      lineNetAmount: requireString(line.lineNetAmount, "lineNetAmount"),
      priceLineAmount: line.priceLineAmount ?? null,
      arrivalDateStart: line.arrivalDateStart ? parseDate(line.arrivalDateStart, "arrivalDateStart") ?? null : null,
      arrivalDateEnd: line.arrivalDateEnd ? parseDate(line.arrivalDateEnd, "arrivalDateEnd") ?? null : null,
      currencyCode: line.currencyCode ?? normalized.currencyCode,
    }));

    const shipments = order.shipments ?? [];
    const statusEvents = order.statusEvents ?? [];

    const prismaAny = prisma as any;
    const ingestStats = {
      linesRewritten: 0,
      linesSkipped: 0,
      /** Incoming ORDP had fewer lines than DB — kept existing lines to avoid data loss */
      linesRewriteSkippedShrinkingPayload: 0,
      shipmentsWritten: 0,
      shipmentsSkipped: 0,
      shipmentItemsRewritten: 0,
      shipmentItemsSkipped: 0,
      statusEventsRewritten: 0,
      statusEventsSkipped: 0,
    };
    const result = await prismaAny.$transaction(async (tx: any) => {
      const existingOrder = await tx.galaxusOrder.findUnique({
        where: { galaxusOrderId: normalized.galaxusOrderId },
        select: {
          id: true,
          orderNumber: true,
          orderDate: true,
          generationDate: true,
          language: true,
          deliveryDate: true,
          currencyCode: true,
          customerName: true,
          customerAddress1: true,
          customerAddress2: true,
          customerPostalCode: true,
          customerCity: true,
          customerCountry: true,
          customerCountryCode: true,
          customerEmail: true,
          customerVatId: true,
          recipientName: true,
          recipientAddress1: true,
          recipientAddress2: true,
          recipientPostalCode: true,
          recipientCity: true,
          recipientCountry: true,
          recipientCountryCode: true,
          recipientEmail: true,
          recipientPhone: true,
          referencePerson: true,
          yourReference: true,
          afterSalesHandling: true,
          customerType: true,
          deliveryType: true,
          isCollectiveOrder: true,
          physicalDeliveryNoteRequired: true,
          saturdayDeliveryAllowed: true,
          endCustomerOrderReference: true,
          buyerIdRef: true,
          supplierIdRef: true,
          supplierOrderId: true,
          ordrSentAt: true,
          ordrMode: true,
          ingestedAt: true,
          ordrStatus: true,
          buyerPartyId: true,
          buyerPartyGln: true,
          supplierPartyId: true,
          deliveryPartyId: true,
          marketplacePartyId: true,
        },
      });

      const orderPayload = {
        orderNumber: normalized.orderNumber,
        orderDate: normalized.orderDate,
        generationDate: normalized.generationDate,
        language: normalized.language,
        deliveryDate: normalized.deliveryDate,
        currencyCode: normalized.currencyCode,
        customerName: normalized.customerName,
        customerAddress1: normalized.customerAddress1,
        customerAddress2: normalized.customerAddress2,
        customerPostalCode: normalized.customerPostalCode,
        customerCity: normalized.customerCity,
        customerCountry: normalized.customerCountry,
        customerCountryCode: normalized.customerCountryCode,
        customerEmail: normalized.customerEmail,
        customerVatId: normalized.customerVatId,
        recipientName: normalized.recipientName,
        recipientAddress1: normalized.recipientAddress1,
        recipientAddress2: normalized.recipientAddress2,
        recipientPostalCode: normalized.recipientPostalCode,
        recipientCity: normalized.recipientCity,
        recipientCountry: normalized.recipientCountry,
        recipientCountryCode: normalized.recipientCountryCode,
        recipientEmail: normalized.recipientEmail,
        recipientPhone: normalized.recipientPhone,
        referencePerson: normalized.referencePerson,
        yourReference: normalized.yourReference,
        afterSalesHandling: normalized.afterSalesHandling,
        customerType: normalized.customerType,
        deliveryType: normalized.deliveryType,
        isCollectiveOrder: normalized.isCollectiveOrder,
        physicalDeliveryNoteRequired: normalized.physicalDeliveryNoteRequired,
        saturdayDeliveryAllowed: normalized.saturdayDeliveryAllowed,
        endCustomerOrderReference: normalized.endCustomerOrderReference,
        buyerIdRef: normalized.buyerIdRef,
        supplierIdRef: normalized.supplierIdRef,
        supplierOrderId: normalized.supplierOrderId,
        ordrSentAt: normalized.ordrSentAt,
        ordrMode: normalized.ordrMode,
        buyerPartyId: normalized.buyerPartyId,
        buyerPartyGln: normalized.buyerPartyGln,
        supplierPartyId: normalized.supplierPartyId,
        deliveryPartyId: normalized.deliveryPartyId,
        marketplacePartyId: normalized.marketplacePartyId,
      };

      const existingOrderPayload = existingOrder
        ? {
            orderNumber: existingOrder.orderNumber,
            orderDate: existingOrder.orderDate,
            generationDate: existingOrder.generationDate,
            language: existingOrder.language,
            deliveryDate: existingOrder.deliveryDate,
            currencyCode: existingOrder.currencyCode,
            customerName: existingOrder.customerName,
            customerAddress1: existingOrder.customerAddress1,
            customerAddress2: existingOrder.customerAddress2,
            customerPostalCode: existingOrder.customerPostalCode,
            customerCity: existingOrder.customerCity,
            customerCountry: existingOrder.customerCountry,
            customerCountryCode: existingOrder.customerCountryCode,
            customerEmail: existingOrder.customerEmail,
            customerVatId: existingOrder.customerVatId,
            recipientName: existingOrder.recipientName,
            recipientAddress1: existingOrder.recipientAddress1,
            recipientAddress2: existingOrder.recipientAddress2,
            recipientPostalCode: existingOrder.recipientPostalCode,
            recipientCity: existingOrder.recipientCity,
            recipientCountry: existingOrder.recipientCountry,
            recipientCountryCode: existingOrder.recipientCountryCode,
            recipientEmail: existingOrder.recipientEmail,
            recipientPhone: existingOrder.recipientPhone,
            referencePerson: existingOrder.referencePerson,
            yourReference: existingOrder.yourReference,
            afterSalesHandling: existingOrder.afterSalesHandling,
            customerType: existingOrder.customerType,
            deliveryType: existingOrder.deliveryType,
            isCollectiveOrder: existingOrder.isCollectiveOrder,
            physicalDeliveryNoteRequired: existingOrder.physicalDeliveryNoteRequired,
            saturdayDeliveryAllowed: existingOrder.saturdayDeliveryAllowed,
            endCustomerOrderReference: existingOrder.endCustomerOrderReference,
            buyerIdRef: existingOrder.buyerIdRef,
            supplierIdRef: existingOrder.supplierIdRef,
            supplierOrderId: existingOrder.supplierOrderId,
            ordrSentAt: existingOrder.ordrSentAt,
            ordrMode: existingOrder.ordrMode,
            buyerPartyId: existingOrder.buyerPartyId,
            buyerPartyGln: existingOrder.buyerPartyGln,
            supplierPartyId: existingOrder.supplierPartyId,
            deliveryPartyId: existingOrder.deliveryPartyId,
            marketplacePartyId: existingOrder.marketplacePartyId,
          }
        : null;

      const savedOrder = existingOrder
        ? arraysEqual(
            [orderPayload] as Array<Record<string, unknown>>,
            [existingOrderPayload ?? {}] as Array<Record<string, unknown>>,
            (row) => JSON.stringify(row)
          )
          ? existingOrder
          : await tx.galaxusOrder.update({
              where: { id: existingOrder.id },
              data: {
                ...orderPayload,
                ...(existingOrder.ingestedAt
                  ? {}
                  : {
                      ingestedAt: new Date(),
                      ordrStatus: existingOrder.ordrSentAt ? "SENT" : "PENDING",
                    }),
              },
            })
        : await tx.galaxusOrder.create({
            data: {
              galaxusOrderId: normalized.galaxusOrderId,
              orderDate: normalized.orderDate,
              generationDate: normalized.generationDate,
              language: normalized.language,
              deliveryDate: normalized.deliveryDate,
              currencyCode: normalized.currencyCode,
              customerName: normalized.customerName,
              customerAddress1: normalized.customerAddress1,
              customerAddress2: normalized.customerAddress2,
              customerPostalCode: normalized.customerPostalCode,
              customerCity: normalized.customerCity,
              customerCountry: normalized.customerCountry,
              customerCountryCode: normalized.customerCountryCode,
              customerEmail: normalized.customerEmail,
              customerVatId: normalized.customerVatId,
              recipientName: normalized.recipientName,
              recipientAddress1: normalized.recipientAddress1,
              recipientAddress2: normalized.recipientAddress2,
              recipientPostalCode: normalized.recipientPostalCode,
              recipientCity: normalized.recipientCity,
              recipientCountry: normalized.recipientCountry,
              recipientCountryCode: normalized.recipientCountryCode,
              recipientEmail: normalized.recipientEmail,
              recipientPhone: normalized.recipientPhone,
              referencePerson: normalized.referencePerson,
              yourReference: normalized.yourReference,
              afterSalesHandling: normalized.afterSalesHandling,
              orderNumber: normalized.orderNumber,
              customerType: normalized.customerType,
              deliveryType: normalized.deliveryType,
              isCollectiveOrder: normalized.isCollectiveOrder,
              physicalDeliveryNoteRequired: normalized.physicalDeliveryNoteRequired,
              saturdayDeliveryAllowed: normalized.saturdayDeliveryAllowed,
              endCustomerOrderReference: normalized.endCustomerOrderReference,
              buyerIdRef: normalized.buyerIdRef,
              supplierIdRef: normalized.supplierIdRef,
              supplierOrderId: normalized.supplierOrderId,
              ordrSentAt: normalized.ordrSentAt,
              ordrMode: normalized.ordrMode,
              ingestedAt: new Date(),
              ordrStatus: normalized.ordrSentAt ? "SENT" : "PENDING",
              buyerPartyId: normalized.buyerPartyId,
              buyerPartyGln: normalized.buyerPartyGln,
              supplierPartyId: normalized.supplierPartyId,
              deliveryPartyId: normalized.deliveryPartyId,
              marketplacePartyId: normalized.marketplacePartyId,
            },
          });

      const existingLines = await tx.galaxusOrderLine.findMany({
        where: { orderId: savedOrder.id },
        select: {
          lineNumber: true,
          supplierPid: true,
          buyerPid: true,
          orderUnit: true,
          supplierSku: true,
          supplierVariantId: true,
          productName: true,
          description: true,
          size: true,
          gtin: true,
          providerKey: true,
          quantity: true,
          qtyConfirmed: true,
          vatRate: true,
          taxAmountPerUnit: true,
          unitNetPrice: true,
          lineNetAmount: true,
          priceLineAmount: true,
          arrivalDateStart: true,
          arrivalDateEnd: true,
          currencyCode: true,
        },
      });

      const linesDiffer = !arraysEqual(
        existingLines as ComparableLine[],
        lines as ComparableLine[],
        normalizeLineKey
      );
      const incomingShrinksLineCount =
        lines.length < existingLines.length && existingLines.length > 0;

      if (linesDiffer) {
        if (incomingShrinksLineCount) {
          // Partial / buggy ORDP can send fewer lines than we already stored; never drop lines.
          ingestStats.linesRewriteSkippedShrinkingPayload += 1;
          console.warn("[galaxus][ingest] skipped line rewrite: fewer lines in payload than DB", {
            galaxusOrderId: normalized.galaxusOrderId,
            dbLineCount: existingLines.length,
            payloadLineCount: lines.length,
          });
        } else {
          await tx.galaxusOrderLine.deleteMany({
            where: { orderId: savedOrder.id },
          });
          await tx.galaxusOrderLine.createMany({
            data: lines.map((line) => ({
              orderId: savedOrder.id,
              lineNumber: line.lineNumber,
              supplierPid: line.supplierPid,
              buyerPid: line.buyerPid,
              orderUnit: line.orderUnit,
              supplierSku: line.supplierSku,
              supplierVariantId: line.supplierVariantId,
              productName: line.productName,
              description: line.description,
              size: line.size,
              gtin: line.gtin,
              providerKey: line.providerKey,
              quantity: line.quantity,
              qtyConfirmed: line.qtyConfirmed,
              vatRate: line.vatRate,
              taxAmountPerUnit: line.taxAmountPerUnit,
              unitNetPrice: line.unitNetPrice,
              lineNetAmount: line.lineNetAmount,
              priceLineAmount: line.priceLineAmount,
              arrivalDateStart: line.arrivalDateStart,
              arrivalDateEnd: line.arrivalDateEnd,
              currencyCode: line.currencyCode,
            })),
          });
          ingestStats.linesRewritten += 1;
        }
      } else {
        ingestStats.linesSkipped += 1;
      }

      for (const shipment of shipments) {
        const shipmentId = requireString(shipment.shipmentId, "shipmentId");
        const shipmentPayload: ComparableShipment = {
          orderId: savedOrder.id,
          dispatchNotificationId: shipment.dispatchNotificationId ?? null,
          dispatchNotificationCreatedAt:
            parseDate(shipment.dispatchNotificationCreatedAt, "dispatchNotificationCreatedAt") ?? null,
          incoterms: shipment.incoterms ?? null,
          packageId: shipment.packageId ?? null,
          deliveryType: shipment.deliveryType ?? null,
          carrierRaw: shipment.carrierRaw ?? null,
          carrierFinal: shipment.carrierFinal ?? null,
          trackingNumber: shipment.trackingNumber ?? null,
          packageType: shipment.packageType ?? null,
          shippedAt: parseDate(shipment.shippedAt, "shippedAt") ?? null,
          delrFileName: shipment.delrFileName ?? null,
          delrSentAt: parseDate(shipment.delrSentAt, "delrSentAt") ?? null,
          delrStatus: shipment.delrStatus ?? null,
          delrError: shipment.delrError ?? null,
          labelZpl: shipment.labelZpl ?? null,
          labelPdfUrl: shipment.labelPdfUrl ?? null,
          labelGeneratedAt: parseDate(shipment.labelGeneratedAt, "labelGeneratedAt") ?? null,
        };

        const existingShipment = await tx.shipment.findUnique({
          where: { shipmentId },
          select: {
            id: true,
            orderId: true,
            dispatchNotificationId: true,
            dispatchNotificationCreatedAt: true,
            incoterms: true,
            packageId: true,
            deliveryType: true,
            carrierRaw: true,
            carrierFinal: true,
            trackingNumber: true,
            packageType: true,
            shippedAt: true,
            delrFileName: true,
            delrSentAt: true,
            delrStatus: true,
            delrError: true,
            labelZpl: true,
            labelPdfUrl: true,
            labelGeneratedAt: true,
          },
        });

        const savedShipment = existingShipment
          ? normalizeShipmentKey(existingShipment as ComparableShipment) === normalizeShipmentKey(shipmentPayload)
            ? existingShipment
            : await tx.shipment.update({
                where: { id: existingShipment.id },
                data: {
                  orderId: savedOrder.id,
                  dispatchNotificationId: shipmentPayload.dispatchNotificationId,
                  dispatchNotificationCreatedAt: shipmentPayload.dispatchNotificationCreatedAt,
                  incoterms: shipmentPayload.incoterms,
                  packageId: shipmentPayload.packageId,
                  deliveryType: shipmentPayload.deliveryType,
                  carrierRaw: shipmentPayload.carrierRaw,
                  carrierFinal: shipmentPayload.carrierFinal,
                  trackingNumber: shipmentPayload.trackingNumber,
                  packageType: shipment.packageType ?? undefined,
                  shippedAt: shipmentPayload.shippedAt,
                  delrFileName: shipmentPayload.delrFileName,
                  delrSentAt: shipmentPayload.delrSentAt,
                  delrStatus: shipmentPayload.delrStatus,
                  delrError: shipmentPayload.delrError,
                  labelZpl: shipmentPayload.labelZpl,
                  labelPdfUrl: shipmentPayload.labelPdfUrl,
                  labelGeneratedAt: shipmentPayload.labelGeneratedAt,
                },
              })
          : await tx.shipment.create({
              data: {
                orderId: savedOrder.id,
                shipmentId,
                dispatchNotificationId: shipmentPayload.dispatchNotificationId,
                dispatchNotificationCreatedAt: shipmentPayload.dispatchNotificationCreatedAt,
                incoterms: shipmentPayload.incoterms,
                packageId: shipmentPayload.packageId,
                deliveryType: shipmentPayload.deliveryType,
                carrierRaw: shipmentPayload.carrierRaw,
                carrierFinal: shipmentPayload.carrierFinal,
                trackingNumber: shipmentPayload.trackingNumber,
                packageType: shipment.packageType ?? undefined,
                shippedAt: shipmentPayload.shippedAt,
                delrFileName: shipmentPayload.delrFileName,
                delrSentAt: shipmentPayload.delrSentAt,
                delrStatus: shipmentPayload.delrStatus,
                delrError: shipmentPayload.delrError,
                labelZpl: shipmentPayload.labelZpl,
                labelPdfUrl: shipmentPayload.labelPdfUrl,
                labelGeneratedAt: shipmentPayload.labelGeneratedAt,
              },
            });
        if (existingShipment) {
          if (
            normalizeShipmentKey(existingShipment as ComparableShipment) === normalizeShipmentKey(shipmentPayload)
          ) {
            ingestStats.shipmentsSkipped += 1;
          } else {
            ingestStats.shipmentsWritten += 1;
          }
        } else {
          ingestStats.shipmentsWritten += 1;
        }

        if (shipment.items && shipment.items.length > 0) {
          const incomingItems = shipment.items.map((item) => ({
            supplierPid: requireString(item.supplierPid, "shipment.items.supplierPid"),
            gtin14: requireString(item.gtin14, "shipment.items.gtin14"),
            buyerPid: item.buyerPid ?? null,
            quantity: requireNumber(item.quantity, "shipment.items.quantity"),
          }));
          const existingItems = await tx.shipmentItem.findMany({
            where: { shipmentId: savedShipment.id },
            select: {
              supplierPid: true,
              gtin14: true,
              buyerPid: true,
              quantity: true,
            },
          });
          if (!arraysEqual(existingItems as ComparableShipmentItem[], incomingItems, normalizeShipmentItemKey)) {
            await tx.shipmentItem.deleteMany({ where: { shipmentId: savedShipment.id } });
            await tx.shipmentItem.createMany({
              data: incomingItems.map((item) => ({
                shipmentId: savedShipment.id,
                orderId: savedOrder.id,
                supplierPid: item.supplierPid,
                gtin14: item.gtin14,
                buyerPid: item.buyerPid,
                quantity: item.quantity,
              })),
            });
            ingestStats.shipmentItemsRewritten += 1;
          } else {
            ingestStats.shipmentItemsSkipped += 1;
          }
        }
      }

      if (statusEvents.length > 0) {
        const incomingEvents = statusEvents.map((event) => ({
          source: event.source ?? "galaxus",
          type: requireString(event.type, "statusEvents.type"),
          payloadJson: event.payloadJson ?? undefined,
          createdAt: parseDate(event.createdAt, "statusEvents.createdAt") ?? null,
        }));
        const existingEvents = await tx.orderStatusEvent.findMany({
          where: { orderId: savedOrder.id, source: "galaxus" },
          select: {
            source: true,
            type: true,
            payloadJson: true,
            createdAt: true,
          },
        });
        if (!arraysEqual(existingEvents as ComparableStatusEvent[], incomingEvents, normalizeStatusEventKey)) {
          await tx.orderStatusEvent.deleteMany({
            where: { orderId: savedOrder.id, source: "galaxus" },
          });
          await tx.orderStatusEvent.createMany({
            data: incomingEvents.map((event) => ({
              orderId: savedOrder.id,
              source: event.source ?? "galaxus",
              type: event.type,
              payloadJson: event.payloadJson ?? undefined,
              createdAt: event.createdAt ?? undefined,
            })),
          });
          ingestStats.statusEventsRewritten += 1;
        } else {
          ingestStats.statusEventsSkipped += 1;
        }
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
    console.info("[galaxus][ingest] order processed", {
      orderId: result.galaxusOrderId,
      lines: result.lines,
      shipments: result.shipments,
      statusEvents: result.statusEvents,
      ...ingestStats,
    });
  }

  return results;
}
