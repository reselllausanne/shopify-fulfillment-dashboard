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
  buildDeliveryParty,
  buildDispatchLines,
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
  options: { supplierId: string }
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
    Object.fromEntries(metaBySupplierPid)
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
    shipmentId: shipment.trackingNumber ?? shipment.shipmentId,
    shipmentCarrier: shipment.carrierFinal ?? null,
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
