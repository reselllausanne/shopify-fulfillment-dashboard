import type { GalaxusOrder, GalaxusOrderLine } from "@prisma/client";
import { DocumentType } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import {
  GALAXUS_BUYER_ADDRESS1,
  GALAXUS_BUYER_ADDRESS2,
  GALAXUS_BUYER_CITY,
  GALAXUS_BUYER_COUNTRY,
  GALAXUS_BUYER_NAME,
  GALAXUS_BUYER_POSTAL_CODE,
  GALAXUS_SUPPLIER_ADDRESS_LINES,
  GALAXUS_SUPPLIER_EMAIL,
  GALAXUS_SUPPLIER_NAME,
  GALAXUS_SUPPLIER_PHONE,
  GALAXUS_SUPPLIER_VAT_ID,
  GALAXUS_SUPPLIER_WEBSITE,
} from "../config";
import { createSsccBarcodeDataUrl } from "../barcodes/barcode";
import { getStorageAdapter } from "../storage/storage";
import { renderDeliveryNoteHtml } from "./templates/deliveryNote";
import { renderInvoiceHtml } from "./templates/invoice";
import { renderLabelHtml } from "./templates/label";
import { renderPdfFromHtml } from "./renderers/playwrightRenderer";
import type { Company, DeliveryNoteData, InvoiceData, LabelData, OrderLine, VatSummaryLine } from "./types";
import crypto from "crypto";

type GenerateOptions = {
  orderId: string;
  types?: DocumentType[];
};

export class DocumentService {
  async generateForOrder(options: GenerateOptions) {
    const order = await prisma.galaxusOrder.findUnique({
      where: { id: options.orderId },
      include: {
        lines: true,
        shipments: true,
        documents: true,
      },
    });

    if (!order) {
      throw new Error(`Galaxus order not found: ${options.orderId}`);
    }

    const types = options.types ?? [
      DocumentType.INVOICE,
      DocumentType.DELIVERY_NOTE,
      DocumentType.LABEL,
    ];

    const storage = getStorageAdapter();
    const results = [];

    const needsShipment = types.includes(DocumentType.DELIVERY_NOTE) || types.includes(DocumentType.LABEL);
    const shipment = needsShipment ? await resolveShipment(order) : null;

    for (const type of types) {
      let html = "";
      let pdfFormat: "A4" | "A6" = "A4";
      let showPageNumbers = false;

      if (type === DocumentType.INVOICE) {
        const data = buildInvoiceData(order, order.lines);
        html = renderInvoiceHtml(data);
      } else if (type === DocumentType.DELIVERY_NOTE) {
        const data = buildDeliveryNoteData(order, order.lines, shipment);
        html = renderDeliveryNoteHtml(data);
        showPageNumbers = true;
      } else if (type === DocumentType.LABEL) {
        const data = await buildLabelData(order, shipment);
        html = renderLabelHtml(data);
        pdfFormat = "A6";
      }

      const pdfBuffer = await renderPdfFromHtml({ html, format: pdfFormat, showPageNumbers });
      const checksum = crypto.createHash("sha256").update(pdfBuffer).digest("hex");

      const version = getNextVersion(order.documents, type);
      const key = `galaxus/${order.galaxusOrderId}/${type.toLowerCase()}/v${version}.pdf`;
      const stored = await storage.uploadPdf(key, pdfBuffer);

      const document = await prisma.document.create({
        data: {
          orderId: order.id,
          shipmentId: type === DocumentType.LABEL ? shipment?.id ?? null : null,
          type,
          version,
          storageUrl: stored.storageUrl,
          checksum,
        },
      });

      results.push(document);
    }

    return results;
  }
}

function buildSupplier(): Company {
  return {
    name: GALAXUS_SUPPLIER_NAME,
    addressLines: GALAXUS_SUPPLIER_ADDRESS_LINES,
    phone: GALAXUS_SUPPLIER_PHONE || null,
    email: GALAXUS_SUPPLIER_EMAIL || null,
    website: GALAXUS_SUPPLIER_WEBSITE || null,
    vatId: GALAXUS_SUPPLIER_VAT_ID || null,
  };
}

function buildBuyer() {
  return {
    name: GALAXUS_BUYER_NAME,
    line1: GALAXUS_BUYER_ADDRESS1,
    line2: GALAXUS_BUYER_ADDRESS2,
    postalCode: GALAXUS_BUYER_POSTAL_CODE,
    city: GALAXUS_BUYER_CITY,
    country: GALAXUS_BUYER_COUNTRY,
  };
}

function buildSupplierAddress() {
  const [line1, postalLine, countryLine] = GALAXUS_SUPPLIER_ADDRESS_LINES;
  const { postalCode, city } = parsePostalLine(postalLine);
  return {
    name: GALAXUS_SUPPLIER_NAME,
    line1: line1 ?? "",
    line2: null,
    postalCode,
    city,
    country: countryLine ?? "",
  };
}

function parsePostalLine(line?: string) {
  if (!line) return { postalCode: "", city: "" };
  const parts = line.split(" ");
  const postalCode = parts.shift() ?? "";
  return { postalCode, city: parts.join(" ") };
}

function buildRecipient(order: GalaxusOrder) {
  return {
    name: order.recipientName ?? GALAXUS_BUYER_NAME,
    line1: order.recipientAddress1 ?? GALAXUS_BUYER_ADDRESS1,
    line2: order.recipientAddress2 ?? GALAXUS_BUYER_ADDRESS2,
    postalCode: order.recipientPostalCode ?? GALAXUS_BUYER_POSTAL_CODE,
    city: order.recipientCity ?? GALAXUS_BUYER_CITY,
    country: order.recipientCountry ?? GALAXUS_BUYER_COUNTRY,
  };
}

function buildOrderLines(lines: GalaxusOrderLine[]): OrderLine[] {
  return lines.map((line) => ({
    lineNumber: line.lineNumber,
    articleNumber: line.gtin ?? line.providerKey ?? "",
    description: line.productName,
    size: line.size,
    gtin: line.gtin,
    providerKey: line.providerKey,
    sku: line.supplierSku ?? line.supplierVariantId ?? null,
    quantity: line.quantity,
    vatRate: Number(line.vatRate),
    unitNetPrice: Number(line.unitNetPrice),
    lineNetAmount: Number(line.lineNetAmount),
  }));
}

function buildInvoiceData(order: GalaxusOrder, lines: GalaxusOrderLine[]): InvoiceData {
  const orderLines = buildOrderLines(lines);
  const { vatSummary, totals } = calculateTotals(orderLines);

  return {
    invoiceNumber: buildInvoiceNumber(order),
    orderNumber: order.orderNumber ?? null,
    orderDate: order.orderDate,
    deliveryDate: order.deliveryDate,
    currency: order.currencyCode,
    buyer: buildBuyer(),
    supplier: buildSupplier(),
    lines: orderLines,
    vatSummary,
    totals,
  };
}

function buildDeliveryNoteData(
  order: GalaxusOrder,
  lines: GalaxusOrderLine[],
  shipment: {
    shipmentId: string;
    deliveryNoteNumber: string;
    deliveryNoteCreatedAt: Date;
    incoterms: string | null;
    createdAt: Date;
  } | null
): DeliveryNoteData {
  return {
    shipmentId: shipment?.shipmentId ?? "",
    createdAt: shipment?.deliveryNoteCreatedAt ?? new Date(),
    deliveryNoteNumber: shipment?.deliveryNoteNumber ?? buildDeliveryNoteNumber(order),
    incoterms: shipment?.incoterms ?? null,
    buyer: buildRecipient(order),
    supplier: buildSupplier(),
    orderReference: order.orderNumber ?? order.galaxusOrderId,
    referencePerson: order.referencePerson ?? null,
    yourReference: order.yourReference ?? null,
    buyerPhone: order.recipientPhone ?? null,
    afterSalesHandling: order.afterSalesHandling ?? false,
    legalNotice:
      "Payment has already been made directly to Galaxus. In the event of a return, please use the returns process in your customer account on digitec.ch or galaxus.ch. Orders placed via digitec.ch and galaxus.ch are subject to the General Terms and Conditions of Digitec Galaxus AG. For questions, visit https://www.galaxus.ch/help",
    groups: [
      {
        orderNumber: order.orderNumber ?? order.galaxusOrderId,
        deliveryDate: order.deliveryDate,
        lines: buildOrderLines(lines),
      },
    ],
  };
}

async function buildLabelData(
  order: GalaxusOrder,
  shipment: { shipmentId: string; sscc: string | null } | null
): Promise<LabelData> {
  const sscc = shipment?.sscc ?? buildSscc(order);
  const barcodeDataUrl = await createSsccBarcodeDataUrl(sscc);

  return {
    shipmentId: shipment?.shipmentId ?? "",
    orderNumbers: [order.orderNumber ?? order.galaxusOrderId],
    sender: buildSupplierAddress(),
    recipient: buildRecipient(order),
    sscc,
    barcodeDataUrl,
  };
}

function calculateTotals(lines: OrderLine[]): { vatSummary: VatSummaryLine[]; totals: InvoiceData["totals"] } {
  const vatMap = new Map<number, VatSummaryLine>();
  let net = 0;
  let vat = 0;

  for (const line of lines) {
    const lineNet = line.lineNetAmount;
    const lineVat = (lineNet * line.vatRate) / 100;
    const lineGross = lineNet + lineVat;
    net += lineNet;
    vat += lineVat;

    const existing = vatMap.get(line.vatRate);
    if (existing) {
      existing.netAmount += lineNet;
      existing.vatAmount += lineVat;
      existing.grossAmount += lineGross;
    } else {
      vatMap.set(line.vatRate, {
        vatRate: line.vatRate,
        netAmount: lineNet,
        vatAmount: lineVat,
        grossAmount: lineGross,
      });
    }
  }

  return {
    vatSummary: Array.from(vatMap.values()).sort((a, b) => a.vatRate - b.vatRate),
    totals: {
      net,
      vat,
      gross: net + vat,
    },
  };
}

function getNextVersion(documents: { type: DocumentType; version: number }[], type: DocumentType) {
  const versions = documents.filter((doc) => doc.type === type).map((doc) => doc.version);
  return versions.length === 0 ? 1 : Math.max(...versions) + 1;
}

function buildInvoiceNumber(order: GalaxusOrder): string {
  const stampSource = order.createdAt ?? order.orderDate;
  const stamp = formatInvoiceTimestamp(stampSource);
  const suffix = order.id.replace(/-/g, "").slice(0, 6).toUpperCase();
  return `GX-INV-${stamp}-${suffix}`;
}

function buildDeliveryNoteNumber(order: GalaxusOrder): string {
  const stampSource = order.createdAt ?? order.orderDate;
  const stamp = formatInvoiceTimestamp(stampSource);
  const suffix = order.id.replace(/-/g, "").slice(0, 6).toUpperCase();
  return `DN-${stamp}-${suffix}`;
}

function buildSscc(order: GalaxusOrder): string {
  const numericSeed = order.id.replace(/\D/g, "");
  const base = `${Date.now()}${numericSeed}`;
  return base.slice(0, 18).padEnd(18, "0");
}

function formatInvoiceTimestamp(date: Date): string {
  const iso = date.toISOString().replace(/[-:]/g, "").split(".")[0];
  const [datePart, timePart] = iso.split("T");
  return `${datePart}-${timePart}`;
}

async function resolveShipment(
  order: GalaxusOrder & {
    shipments?: {
      id: string;
      shipmentId: string;
      createdAt: Date;
    }[];
  }
): Promise<{
  id: string;
  shipmentId: string;
  deliveryNoteNumber: string;
  deliveryNoteCreatedAt: Date;
  incoterms: string | null;
  sscc: string | null;
  createdAt: Date;
}> {
  if (order.shipments && order.shipments.length > 0) {
    const existing = order.shipments[0];
    const full = await prisma.shipment.findUnique({
      where: { id: existing.id },
    });
    const deliveryNoteNumber = full?.deliveryNoteNumber ?? buildDeliveryNoteNumber(order);
    const deliveryNoteCreatedAt = full?.deliveryNoteCreatedAt ?? existing.createdAt;

    if (!full?.deliveryNoteNumber || !full?.deliveryNoteCreatedAt || !full?.sscc) {
      await prisma.shipment.update({
        where: { id: existing.id },
        data: {
          deliveryNoteNumber,
          deliveryNoteCreatedAt,
          sscc: full?.sscc ?? buildSscc(order),
        },
      });
    }

    return {
      id: existing.id,
      shipmentId: existing.shipmentId,
      deliveryNoteNumber,
      deliveryNoteCreatedAt,
      incoterms: full?.incoterms ?? null,
      sscc: full?.sscc ?? buildSscc(order),
      createdAt: existing.createdAt,
    };
  }

  const shipment = await prisma.shipment.create({
    data: {
      orderId: order.id,
      shipmentId: `SHIP-${order.galaxusOrderId}-${Date.now()}`,
      deliveryNoteNumber: buildDeliveryNoteNumber(order),
      deliveryNoteCreatedAt: new Date(),
      sscc: buildSscc(order),
    },
  });

  return {
    id: shipment.id,
    shipmentId: shipment.shipmentId,
    deliveryNoteNumber: shipment.deliveryNoteNumber ?? buildDeliveryNoteNumber(order),
    deliveryNoteCreatedAt: shipment.deliveryNoteCreatedAt ?? shipment.createdAt,
    incoterms: shipment.incoterms ?? null,
    sscc: shipment.sscc ?? null,
    createdAt: shipment.createdAt,
  };
}
