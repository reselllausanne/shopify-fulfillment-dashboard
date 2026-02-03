import type { GalaxusOrder, GalaxusOrderLine, Shipment } from "@prisma/client";
import { buildDocNumber } from "./docNumbers";
import { buildEdiFilename, buildExpinvFilename, EdiDocType } from "./filenames";
import {
  buildDispatchXml,
  buildInvoiceXml,
  buildOrderResponseXml,
} from "./opentrans/builder";
import {
  buildBuyerParty,
  buildDispatchInfo,
  buildEdiLines,
  buildSupplierParty,
  calculateTotals,
} from "./mapper";

export type EdiOutput = {
  docType: EdiDocType;
  filename: string;
  content: string;
};

export function buildOrderResponse(
  order: GalaxusOrder,
  lines: GalaxusOrderLine[],
  options: { supplierId: string; status: "ACCEPTED" | "REJECTED" | "OUT_OF_STOCK"; reason?: string | null }
): EdiOutput {
  const docId = buildDocNumber("GORDR");
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
    status: options.status,
    statusReason: options.reason ?? null,
    deliveryDate: order.deliveryDate ?? null,
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

export function buildDispatchNotification(
  order: GalaxusOrder,
  lines: GalaxusOrderLine[],
  shipment: Shipment | null,
  options: { supplierId: string }
): EdiOutput {
  const docId = buildDocNumber("GDELR");
  const ediLines = buildEdiLines(lines);
  const dispatch = buildDispatchInfo(shipment);
  const xml = buildDispatchXml({
    docId,
    orderId: order.galaxusOrderId,
    orderNumber: order.orderNumber ?? null,
    orderDate: order.orderDate,
    dispatchDate: shipment?.shippedAt ?? new Date(),
    currency: order.currencyCode,
    buyer: buildBuyerParty(order),
    supplier: buildSupplierParty(),
    lines: ediLines,
    trackingNumber: dispatch.trackingNumber,
    carrier: dispatch.carrier,
    shipmentId: dispatch.shipmentId,
  });

  return {
    docType: "DELR",
    filename: buildEdiFilename({
      docType: "DELR",
      supplierId: options.supplierId,
      orderId: order.galaxusOrderId,
      docNo: docId,
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
  const xml = buildInvoiceXml({
    docId,
    orderId: order.galaxusOrderId,
    orderNumber: order.orderNumber ?? null,
    orderDate: order.orderDate,
    invoiceDate: new Date(),
    currency: order.currencyCode,
    buyer: buildBuyerParty(order),
    supplier: buildSupplierParty(),
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

export function buildExpinvFilenameForOrder(
  order: GalaxusOrder,
  invoiceNoPartner: string
): string {
  return buildExpinvFilename({
    orderId: order.galaxusOrderId,
    invoiceNoPartner,
  });
}
