import "server-only";

import type { GalaxusOrder } from "@prisma/client";
import { createSsccBarcodeDataUrl, normalizeSscc } from "@/galaxus/barcodes/barcode";
import { renderLabelHtml } from "@/galaxus/documents/templates/label";
import { renderPdfFromHtml } from "@/galaxus/documents/renderers/playwrightRenderer";
import type { Address, LabelData } from "@/galaxus/documents/types";
import {
  GALAXUS_SUPPLIER_ADDRESS_LINES,
  GALAXUS_SUPPLIER_NAME,
} from "@/galaxus/config";

type SsccLabelResult = {
  sscc: string;
  zpl: string;
  pdf: Buffer;
  barcodeDataUrl: string;
};

export async function generateSsccLabelPdf(order: GalaxusOrder, sscc: string): Promise<SsccLabelResult> {
  const normalized = normalizeSscc(sscc);
  const barcodeDataUrl = await createSsccBarcodeDataUrl(normalized);
  const data: LabelData = {
    shipmentId: "",
    orderNumbers: [order.orderNumber ?? order.galaxusOrderId],
    sender: buildSupplierAddress(),
    recipient: buildRecipient(order),
    sscc: normalized,
    barcodeDataUrl,
  };
  const html = renderLabelHtml(data);
  const pdf = await renderPdfFromHtml({ html, width: "4in", height: "6in" });
  const zpl = buildSsccZpl(normalized);
  return { sscc: normalized, zpl, pdf, barcodeDataUrl };
}

export function buildSsccZpl(sscc: string): string {
  const normalized = normalizeSscc(sscc);
  return [
    "^XA",
    "^PW812",
    "^LL1218",
    "^FO40,40^A0N,36,36^FD(00) " + normalized + "^FS",
    "^FO40,100^BY2,3,120^BCN,120,Y,N,N^FD>;00" + normalized + "^FS",
    "^XZ",
  ].join("\n");
}

function buildSupplierAddress(): Address {
  const [line1, postalLine, countryLine] = GALAXUS_SUPPLIER_ADDRESS_LINES;
  const { postalCode, city } = parsePostalLine(postalLine);
  return {
    name: GALAXUS_SUPPLIER_NAME,
    line1: line1 ?? "",
    line2: null,
    postalCode,
    city,
    country: countryLine ?? "",
    vatId: null,
  };
}

function buildRecipient(order: GalaxusOrder): Address {
  return {
    name: order.recipientName ?? order.customerName,
    line1: order.recipientAddress1 ?? order.customerAddress1,
    line2: order.recipientAddress2 ?? order.customerAddress2 ?? null,
    postalCode: order.recipientPostalCode ?? order.customerPostalCode,
    city: order.recipientCity ?? order.customerCity,
    country: order.recipientCountry ?? order.customerCountry,
    vatId: order.customerVatId ?? null,
  };
}

function parsePostalLine(line?: string) {
  if (!line) return { postalCode: "", city: "" };
  const parts = line.split(" ");
  const postalCode = parts.shift() ?? "";
  return { postalCode, city: parts.join(" ") };
}
