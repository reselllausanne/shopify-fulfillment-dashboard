import type { GalaxusOrder, GalaxusOrderLine, Shipment } from "@prisma/client";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
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
} from "@/galaxus/config";
import type { EdiOrderLine, EdiParty, EdiTotals, EdiVatSummaryLine } from "./opentrans/types";

export function buildBuyerParty(order: GalaxusOrder): EdiParty {
  return {
    id: GALAXUS_BUYER_NAME,
    name: order.recipientName ?? GALAXUS_BUYER_NAME,
    street: order.recipientAddress1 ?? GALAXUS_BUYER_ADDRESS1,
    street2: order.recipientAddress2 ?? GALAXUS_BUYER_ADDRESS2,
    postalCode: order.recipientPostalCode ?? GALAXUS_BUYER_POSTAL_CODE,
    city: order.recipientCity ?? GALAXUS_BUYER_CITY,
    country: order.recipientCountry ?? GALAXUS_BUYER_COUNTRY,
    vatId: order.customerVatId ?? null,
  };
}

export function buildSupplierParty(): EdiParty {
  const [line1, postalLine, countryLine] = GALAXUS_SUPPLIER_ADDRESS_LINES;
  const { postalCode, city } = parsePostalLine(postalLine);
  return {
    id: GALAXUS_SUPPLIER_NAME,
    name: GALAXUS_SUPPLIER_NAME,
    street: line1 ?? "",
    street2: null,
    postalCode,
    city,
    country: countryLine ?? "",
    vatId: GALAXUS_SUPPLIER_VAT_ID || null,
    email: GALAXUS_SUPPLIER_EMAIL || null,
    phone: GALAXUS_SUPPLIER_PHONE || null,
  };
}

export function buildEdiLines(lines: GalaxusOrderLine[]): EdiOrderLine[] {
  return lines.map((line) => ({
    lineNumber: line.lineNumber,
    description: line.productName,
    quantity: line.quantity,
    unitNetPrice: Number(line.unitNetPrice),
    lineNetAmount: Number(line.lineNetAmount),
    vatRate: Number(line.vatRate),
    supplierPid: line.supplierPid ?? null,
    buyerPid: line.buyerPid ?? null,
    orderUnit: line.orderUnit ?? null,
    providerKey: buildProviderKey(line.gtin, line.supplierVariantId),
    gtin: line.gtin ?? null,
  }));
}

export function calculateTotals(lines: EdiOrderLine[]): { totals: EdiTotals; vatSummary: EdiVatSummaryLine[] } {
  const vatMap = new Map<number, EdiVatSummaryLine>();
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
    totals: { net, vat, gross: net + vat },
    vatSummary: Array.from(vatMap.values()).sort((a, b) => a.vatRate - b.vatRate),
  };
}

export function buildDispatchInfo(shipment: Shipment | null) {
  return {
    shipmentId: shipment?.shipmentId ?? null,
    trackingNumber: shipment?.trackingNumber ?? null,
    carrier: shipment?.carrier ?? null,
  };
}

function parsePostalLine(line?: string) {
  if (!line) return { postalCode: "", city: "" };
  const parts = line.split(" ");
  const postalCode = parts.shift() ?? "";
  return { postalCode, city: parts.join(" ") };
}
