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
import type { DispatchShipmentItemInput } from "./mapper";
import type { EdiOrderLine } from "./opentrans/types";

type EdiOutput = {
  docType: EdiDocType;
  filename: string;
  content: string;
};

export type CustomInvoiceLineInput = {
  orderReferenceId: string;
  description: string;
  quantity: number;
  unitNetPrice: number;
  vatRate: number;
  lineNetAmount?: number | null;
  taxAmountPerUnit?: number | null;
  supplierPid?: string | null;
  buyerPid?: string | null;
  orderUnit?: string | null;
  gtin?: string | null;
  providerKey?: string | null;
  /** When set, ties the line to a GalaxusOrderLine for duplicate-invoice checks */
  orderLineId?: string | null;
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

function buildDispatchMetaMaps(orders: Array<GalaxusOrder & { lines: GalaxusOrderLine[] }>) {
  const metaByKey: Record<string, { description: string; lineNumber: number }> = {};
  const metaBySupplierPid: Record<string, { description: string; lineNumber: number }> = {};
  for (const ord of orders) {
    const oid = String(ord.galaxusOrderId ?? "").trim();
    for (const line of ord.lines ?? []) {
      const supplierPid =
        ("supplierPid" in line ? (line as { supplierPid?: string | null }).supplierPid : null) ??
        (line as any).providerKey ??
        null;
      const sp = String(supplierPid ?? "").trim();
      const gtin = String((line as any).gtin ?? "").trim();
      if (oid && sp && gtin) {
        metaByKey[`${oid}|${sp}|${gtin}`] = {
          description: line.productName,
          lineNumber: line.lineNumber,
        };
      }
      if (sp && !metaBySupplierPid[sp]) {
        metaBySupplierPid[sp] = {
          description: line.productName,
          lineNumber: line.lineNumber,
        };
      }
    }
  }
  return { metaByKey, metaBySupplierPid };
}

export function buildDispatchNotification(
  order: GalaxusOrder,
  /** All orders that contribute lines to this dispatch (same delivery party expected). Each must include `lines`. */
  ordersForMeta: Array<GalaxusOrder & { lines: GalaxusOrderLine[] }>,
  shipment: Shipment & {
    packageId?: string | null;
    dispatchNotificationId?: string | null;
    carrierFinal?: string | null;
    carrierRaw?: string | null;
    trackingNumber?: string | null;
  },
  items: DispatchShipmentItemInput[],
  options: {
    supplierId: string;
    arrivalByGtin?: Record<string, { start: Date; end: Date }>;
  }
): EdiOutput {
  const { metaByKey, metaBySupplierPid } = buildDispatchMetaMaps(ordersForMeta);

  const packageId = shipment.packageId ?? "";
  const isDirect =
    String(order.deliveryType ?? "").toLowerCase() === "direct_delivery" ||
    String((shipment as any)?.deliveryType ?? "").toLowerCase() === "direct_delivery";
  const ediLines = buildDispatchLines(
    items,
    order.galaxusOrderId,
    packageId,
    metaByKey,
    metaBySupplierPid,
    options.arrivalByGtin ?? {},
    { includeLogisticsDetails: !isDirect }
  );
  const dispatchNotificationId = shipment.dispatchNotificationId ?? buildDocNumber("GDELR");
  const shipmentId = shipment.trackingNumber ?? null;
  const shipmentCarrier = shipment.carrierFinal ?? shipment.carrierRaw ?? null;
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
    shipmentId,
    shipmentCarrier,
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
  options: { supplierId: string; invoiceNoPartner?: string | null; deliveryCharge?: number | null }
): EdiOutput {
  const docId = buildDocNumber("GINVO");
  const ediLines = buildEdiLines(lines);
  const { totals: goodsTotals, vatSummary } = calculateTotals(ediLines);
  const explicitDeliveryCharge =
    typeof options.deliveryCharge === "number" && Number.isFinite(options.deliveryCharge)
      ? Math.max(0, options.deliveryCharge)
      : null;
  const isDirectDelivery = String((order as { deliveryType?: string | null }).deliveryType ?? "")
    .toLowerCase()
    .trim() === "direct_delivery";
  const deliveryCharge = explicitDeliveryCharge ?? (isDirectDelivery ? 6 : null);
  const totals = buildInvoiceTotals(goodsTotals, vatSummary, deliveryCharge);
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
    deliveryCharge,
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

function buildInvoiceTotals(
  goodsTotals: { net: number; vat: number; gross: number },
  vatSummary: { vatRate: number }[],
  deliveryCharge: number | null
) {
  const topRate = vatSummary[0]?.vatRate ?? 0;
  const deliveryVatRate = Number.isFinite(topRate) ? topRate : 0;
  const charge = deliveryCharge && deliveryCharge > 0 ? deliveryCharge : 0;
  const deliveryVat = charge > 0 ? (charge * deliveryVatRate) / 100 : 0;
  const deliveryGross = charge + deliveryVat;
  return {
    net: goodsTotals.net,
    vat: goodsTotals.vat + deliveryVat,
    gross: goodsTotals.net + goodsTotals.vat + deliveryGross,
  };
}

function toNumber(value: unknown, fallback = 0) {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function buildCustomInvoice(
  order: GalaxusOrder,
  lines: CustomInvoiceLineInput[],
  options: { supplierId: string; invoiceNoPartner?: string | null; deliveryCharge?: number | null }
): EdiOutput {
  const docId = buildDocNumber("GINVO");
  const ediLines: EdiOrderLine[] = lines.map((line, index) => {
    const quantity = toNumber(line.quantity, 0);
    const unitNetPrice = toNumber(line.unitNetPrice, 0);
    const explicitLineNet = line.lineNetAmount != null ? toNumber(line.lineNetAmount, NaN) : NaN;
    const lineNetAmount = Number.isFinite(explicitLineNet)
      ? explicitLineNet
      : Number((unitNetPrice * quantity).toFixed(2));
    return {
      lineNumber: index + 1,
      description: line.description?.trim() || "Item",
      quantity,
      unitNetPrice,
      lineNetAmount,
      vatRate: toNumber(line.vatRate, 0),
      taxAmountPerUnit:
        line.taxAmountPerUnit != null ? toNumber(line.taxAmountPerUnit, 0) : null,
      supplierPid: line.supplierPid ?? null,
      buyerPid: line.buyerPid ?? null,
      orderUnit: line.orderUnit ?? null,
      providerKey: line.providerKey ?? null,
      gtin: line.gtin ?? null,
      orderReferenceId: line.orderReferenceId?.trim() || order.galaxusOrderId,
    };
  });

  const { totals: goodsTotals, vatSummary } = calculateTotals(ediLines);
  const deliveryCharge =
    typeof options.deliveryCharge === "number" && Number.isFinite(options.deliveryCharge)
      ? Math.max(0, options.deliveryCharge)
      : null;
  const totals = buildInvoiceTotals(goodsTotals, vatSummary, deliveryCharge);

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
    deliveryCharge,
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

