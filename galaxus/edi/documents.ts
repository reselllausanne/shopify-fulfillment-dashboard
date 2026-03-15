import type { GalaxusOrder, GalaxusOrderLine, Shipment } from "@prisma/client";
import { buildDocNumber } from "./docNumbers";
import { buildEdiFilename, EdiDocType } from "./filenames";
import {
  buildDispatchXml,
  buildInvoiceXml,
  buildOrderResponseXml,
} from "./opentrans/builder";
import {
  buildBuyerParty,
  buildDeliveryParty,
  buildDispatchLines,
  buildEdiLines,
  buildSupplierParty,
  calculateTotals,
} from "./mapper";

type EdiOutput = {
  docType: EdiDocType;
  filename: string;
  content: string;
};

export function buildOrderResponse(
  order: GalaxusOrder,
  lines: GalaxusOrderLine[],
  options: {
    supplierId: string;
    status: "ACCEPTED" | "REJECTED" | "OUT_OF_STOCK";
    reason?: string | null;
    arrivalByGtin?: Record<string, { start: Date; end: Date }>;
  }
): EdiOutput {
  const docId = buildDocNumber("GORDR");
  const fallbackArrival = addBusinessDays(new Date(), 4);
  const arrivalByGtin = options.arrivalByGtin ?? {};
  const ediLines = buildEdiLines(lines).map((line) => {
    const gtin = line.gtin ?? null;
    const arrival = gtin ? arrivalByGtin[gtin] ?? null : null;
    const start = arrival?.start ?? line.arrivalDateStart ?? fallbackArrival;
    const end = arrival?.end ?? line.arrivalDateEnd ?? line.arrivalDateStart ?? fallbackArrival;
    return {
      ...line,
      arrivalDateStart: start,
      arrivalDateEnd: end,
    };
  });
  const xml = buildOrderResponseXml({
    docId,
    orderId: order.galaxusOrderId,
    orderNumber: order.orderNumber ?? null,
    orderDate: order.orderDate,
    responseDate: new Date(),
    currency: order.currencyCode,
    buyer: buildBuyerParty(order),
    supplier: buildSupplierParty(),
    lines: ediLines,
    status: options.status,
    statusReason: options.reason ?? null,
    deliveryDate: order.deliveryDate ?? null,
    supplierOrderId:
      ("supplierOrderId" in order
        ? (order as { supplierOrderId?: string | null }).supplierOrderId
        : null) ?? order.galaxusOrderId,
  });

  return {
    docType: "ORDR",
    filename: buildEdiFilename({
      docType: "ORDR",
      supplierId: options.supplierId,
      orderId: order.galaxusOrderId,
      docNo: docId,
    }),
    content: xml,
  };
}

function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) {
      added += 1;
    }
  }
  return result;
}

export function buildDispatchNotification(
  order: GalaxusOrder,
  lines: GalaxusOrderLine[],
  shipment: Shipment & {
    packageId?: string | null;
    dispatchNotificationId?: string | null;
    carrierFinal?: string | null;
  },
  items: Array<{
    supplierPid: string;
    gtin14: string;
    buyerPid?: string | null;
    quantity: number;
  }>,
  options: {
    supplierId: string;
    arrivalByGtin?: Record<string, { start: Date; end: Date }>;
  }
): EdiOutput {
  const metaBySupplierPid = new Map<string, { description: string; lineNumber: number }>();
  for (const line of lines) {
    const supplierPid =
      ("supplierPid" in line ? (line as { supplierPid?: string | null }).supplierPid : null) ??
      line.providerKey ??
      null;
    if (supplierPid) {
      metaBySupplierPid.set(supplierPid, {
        description: line.productName,
        lineNumber: line.lineNumber,
      });
    }
  }

  const packageId = shipment.packageId ?? "";
  const ediLines = buildDispatchLines(
    items,
    order.galaxusOrderId,
    packageId,
    Object.fromEntries(metaBySupplierPid),
    options.arrivalByGtin ?? {}
  );
  const dispatchNotificationId = shipment.dispatchNotificationId ?? buildDocNumber("GDELR");
  const xml = buildDispatchXml({
    docId: dispatchNotificationId,
    orderId: order.galaxusOrderId,
    orderNumber: order.orderNumber ?? null,
    orderDate: order.orderDate,
    generationDate: new Date(),
    dispatchNotificationId,
    dispatchDate: shipment.shippedAt ?? new Date(),
    currency: order.currencyCode,
    buyer: buildBuyerParty(order),
    supplier: buildSupplierParty(),
    lines: ediLines,
    shipmentId: shipment.shipmentId,
    shipmentCarrier: null,
    deliveryParty: buildDeliveryParty(order),
  });

  return {
    docType: "DELR",
    filename: buildEdiFilename({
      docType: "DELR",
      supplierId: options.supplierId,
      orderId: order.galaxusOrderId,
      docNo: dispatchNotificationId,
    }),
    content: xml,
  };
}

export function buildOutOfStockNotice(
  order: GalaxusOrder,
  lines: GalaxusOrderLine[],
  options: { supplierId: string; reason?: string | null }
): EdiOutput {
  const docId = buildDocNumber("GEOLN");
  const ediLines = buildEdiLines(lines);
  const xml = buildOrderResponseXml({
    docId,
    orderId: order.galaxusOrderId,
    orderNumber: order.orderNumber ?? null,
    orderDate: order.orderDate,
    responseDate: new Date(),
    currency: order.currencyCode,
    buyer: buildBuyerParty(order),
    supplier: buildSupplierParty(),
    lines: ediLines,
    status: "OUT_OF_STOCK",
    statusReason: options.reason ?? "OUT_OF_STOCK",
  });

  return {
    docType: "EOLN",
    filename: buildEdiFilename({
      docType: "EOLN",
      supplierId: options.supplierId,
      orderId: order.galaxusOrderId,
      docNo: docId,
    }),
    content: xml,
  };
}

export function buildCancelResponse(
  order: GalaxusOrder,
  lines: GalaxusOrderLine[],
  options: { supplierId: string; reason?: string | null }
): EdiOutput {
  const docId = buildDocNumber("GCANR");
  const ediLines = buildEdiLines(lines);
  const xml = buildOrderResponseXml({
    docId,
    orderId: order.galaxusOrderId,
    orderNumber: order.orderNumber ?? null,
    orderDate: order.orderDate,
    responseDate: new Date(),
    currency: order.currencyCode,
    buyer: buildBuyerParty(order),
    supplier: buildSupplierParty(),
    lines: ediLines,
    status: "REJECTED",
    statusReason: options.reason ?? "CANCEL_CONFIRMED",
  });

  return {
    docType: "CANR",
    filename: buildEdiFilename({
      docType: "CANR",
      supplierId: options.supplierId,
      orderId: order.galaxusOrderId,
      docNo: docId,
    }),
    content: xml,
  };
}

export function buildInvoice(
  order: GalaxusOrder,
  lines: GalaxusOrderLine[],
  options: { supplierId: string; invoiceNoPartner?: string | null }
): EdiOutput {
  const docId = buildDocNumber("GINVO");
  const ediLines = buildEdiLines(lines);
  const { totals, vatSummary } = calculateTotals(ediLines);
  const orderAny = order as unknown as {
    supplierOrderId?: string | null;
    deliveryDate?: Date | null;
    shipments?: Array<{
      dispatchNotificationId?: string | null;
      shippedAt?: Date | null;
    }>;
  };
  const shipment = orderAny.shipments?.[0] ?? null;
  const fallbackDelivery = addBusinessDays(new Date(), 4);
  const deliveryStartDate = orderAny.deliveryDate ?? shipment?.shippedAt ?? fallbackDelivery;
  const deliveryEndDate = orderAny.deliveryDate ?? shipment?.shippedAt ?? deliveryStartDate;
  const xml = buildInvoiceXml({
    docId,
    orderId: order.galaxusOrderId,
    orderNumber: order.orderNumber ?? null,
    orderDate: order.orderDate,
    generationDate: new Date(),
    invoiceDate: new Date(),
    deliveryNoteId: shipment?.dispatchNotificationId ?? null,
    deliveryStartDate,
    deliveryEndDate,
    supplierOrderId: orderAny.supplierOrderId ?? order.galaxusOrderId,
    currency: order.currencyCode,
    buyer: buildBuyerParty(order),
    supplier: buildSupplierParty(),
    deliveryParty: buildDeliveryParty(order),
    lines: ediLines,
    totals,
    vatSummary,
  });

  return {
    docType: "INVO",
    filename: buildEdiFilename({
      docType: "INVO",
      supplierId: options.supplierId,
      orderId: order.galaxusOrderId,
      docNo: docId,
    }),
    content: xml,
  };
}

