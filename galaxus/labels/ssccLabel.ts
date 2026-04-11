import "server-only";

import type { GalaxusOrder } from "@prisma/client";
import { createSsccBarcodeDataUrl, normalizeSscc } from "@/galaxus/barcodes/barcode";
import { renderBasicSsccLabelHtml, renderLabelHtml } from "@/galaxus/documents/templates/label";
import { renderPdfFromHtml } from "@/galaxus/documents/renderers/playwrightRenderer";
import type { Address, LabelData } from "@/galaxus/documents/types";
import {
  GALAXUS_SUPPLIER_ADDRESS_LINES,
  GALAXUS_SUPPLIER_NAME,
  GALAXUS_SSCC_SENDER_ADDRESS_LINES,
  GALAXUS_SSCC_SENDER_NAME,
  GALAXUS_SSCC_RECIPIENT_CITY,
  GALAXUS_SSCC_RECIPIENT_COUNTRY,
  GALAXUS_SSCC_RECIPIENT_LINE2,
  GALAXUS_SSCC_RECIPIENT_NAME,
  GALAXUS_SSCC_RECIPIENT_POSTAL_CODE,
  GALAXUS_SSCC_RECIPIENT_STREET,
} from "@/galaxus/config";

type SsccLabelResult = {
  sscc: string;
  zpl: string;
  pdf: Buffer;
  barcodeDataUrl: string;
};

export async function generateSsccLabelPdf(
  order: GalaxusOrder,
  sscc: string,
  options?: { shipmentId?: string | null; orderNumbers?: string[] | null }
): Promise<SsccLabelResult> {
  const normalized = normalizeSscc(sscc);
  const barcodeDataUrl = await createSsccBarcodeDataUrl(normalized);
  const fallbackOrder = order.orderNumber ?? order.galaxusOrderId;
  const orderNumbers = (options?.orderNumbers?.length ? options.orderNumbers : [fallbackOrder]).filter(
    (value): value is string => Boolean(value)
  );
  const shipmentId = options?.shipmentId ?? order.galaxusOrderId ?? "";
  const data: LabelData = {
    shipmentId,
    orderNumbers,
    sender: buildSupplierAddress(),
    recipient: buildRecipient(),
    sscc: normalized,
    barcodeDataUrl,
  };
  const html = renderLabelHtml(data);
  const pdf = await renderPdfFromHtml({ html, width: "4in", height: "6in" });
  const zpl = buildSsccZpl(normalized);
  return { sscc: normalized, zpl, pdf, barcodeDataUrl };
}

export async function generateBasicSsccLabelPdf(sscc: string): Promise<SsccLabelResult> {
  const normalized = normalizeSscc(sscc);
  const barcodeDataUrl = await createSsccBarcodeDataUrl(normalized);
  const html = renderBasicSsccLabelHtml({
    recipient: buildRecipient(),
    sscc: normalized,
    barcodeDataUrl,
  });
  const pdf = await renderPdfFromHtml({ html, width: "4in", height: "6in" });
  const zpl = buildSsccZpl(normalized);
  return { sscc: normalized, zpl, pdf, barcodeDataUrl };
}

export async function generateCustomSsccLabelPdf(params: {
  sscc: string;
  shipmentId?: string | null;
  orderNumbers?: string[];
  sender: Address;
  recipient: Address;
  printOptions?: {
    width?: string;
    height?: string;
    rotate180?: boolean;
    rotateDegrees?: number;
    marginTop?: string;
    marginRight?: string;
    marginBottom?: string;
    marginLeft?: string;
  };
}): Promise<SsccLabelResult> {
  const normalized = normalizeSscc(params.sscc);
  const barcodeDataUrl = await createSsccBarcodeDataUrl(normalized);
  const data: LabelData = {
    shipmentId: params.shipmentId ?? "",
    orderNumbers: params.orderNumbers ?? [],
    sender: params.sender,
    recipient: params.recipient,
    sscc: normalized,
    barcodeDataUrl,
  };
  const html = renderLabelHtml(data);
  const compactHtml = params.printOptions ? applyCompactPrintOverrides(html) : html;
  const rotateDegrees = Number(params.printOptions?.rotateDegrees);
  const effectiveRotation = Number.isFinite(rotateDegrees)
    ? normalizeRotation(rotateDegrees)
    : params.printOptions?.rotate180
    ? 180
    : 0;
  const rotatedHtml =
    effectiveRotation !== 0 ? applyBodyRotation(compactHtml, effectiveRotation) : compactHtml;
  const pdf = await renderPdfFromHtml({
    html: rotatedHtml,
    width: params.printOptions?.width ?? "4in",
    height: params.printOptions?.height ?? "6in",
    marginTop: params.printOptions?.marginTop ?? "14mm",
    marginRight: params.printOptions?.marginRight ?? "12mm",
    marginBottom: params.printOptions?.marginBottom ?? "14mm",
    marginLeft: params.printOptions?.marginLeft ?? "12mm",
  });
  const zpl = buildSsccZpl(normalized);
  return { sscc: normalized, zpl, pdf, barcodeDataUrl };
}

function applyBodyRotation(html: string, degrees: number): string {
  return html.replace(
    "<body>",
    `<body style="margin:0; transform: rotate(${degrees}deg); transform-origin: center center;">`
  );
}

function normalizeRotation(raw: number): number {
  const snapped = Math.round(raw / 90) * 90;
  const normalized = ((snapped % 360) + 360) % 360;
  return normalized;
}

function applyCompactPrintOverrides(html: string): string {
  const compactCss = `
    <style>
      @page { margin: 0; }
      html, body { width: 100%; height: 100%; margin: 0; padding: 0; }
      body { font-size: 8px !important; }
      .label {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        padding: 2mm !important;
        border-width: 0.35mm !important;
        overflow: hidden;
      }
      .title { font-size: 9px !important; margin-bottom: 1.5mm !important; }
      .section { font-size: 8px !important; margin-bottom: 1.2mm !important; }
      .grid { gap: 1.2mm !important; }
      .address {
        min-height: 0 !important;
        padding: 1.2mm !important;
        font-size: 7px !important;
        line-height: 1.15 !important;
      }
      .barcode { margin-top: 1.2mm !important; padding: 1.2mm !important; }
      .barcode img { height: 11mm !important; }
      .barcode-text { font-size: 7px !important; margin-top: 0.8mm !important; }
    </style>
  `;
  return html.replace("</head>", `${compactCss}</head>`);
}

function buildSsccZpl(sscc: string): string {
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
  const overrideLines = Array.isArray(GALAXUS_SSCC_SENDER_ADDRESS_LINES)
    ? GALAXUS_SSCC_SENDER_ADDRESS_LINES
    : [];
  const lines = overrideLines.length > 0 ? overrideLines : GALAXUS_SUPPLIER_ADDRESS_LINES;
  const clean = lines.map((line) => String(line ?? "").trim()).filter(Boolean);
  const line1 = clean[0] ?? "";
  let line2: string | null = null;
  let postalCode = "";
  let city = "";
  let country = "";

  const looksPostal = (value: string) => /\d/.test(value) || value.toUpperCase().startsWith("CH-");
  if (clean.length >= 2) {
    if (looksPostal(clean[1])) {
      const parsed = parsePostalLine(clean[1]);
      postalCode = parsed.postalCode;
      city = parsed.city;
      country = clean[2] ?? "";
    } else {
      line2 = clean[1];
      if (clean.length >= 3 && looksPostal(clean[2])) {
        const parsed = parsePostalLine(clean[2]);
        postalCode = parsed.postalCode;
        city = parsed.city;
        country = clean[3] ?? "";
      } else {
        country = clean[2] ?? "";
      }
    }
  }
  if (!country && clean.length > 0) {
    country = clean[clean.length - 1] ?? "";
  }
  return {
    name: GALAXUS_SSCC_SENDER_NAME || GALAXUS_SUPPLIER_NAME,
    line1,
    line2,
    postalCode,
    city,
    country,
    vatId: null,
  };
}

function buildRecipient(): Address {
  return {
    name: GALAXUS_SSCC_RECIPIENT_NAME,
    line1: GALAXUS_SSCC_RECIPIENT_STREET,
    line2: GALAXUS_SSCC_RECIPIENT_LINE2,
    postalCode: GALAXUS_SSCC_RECIPIENT_POSTAL_CODE,
    city: GALAXUS_SSCC_RECIPIENT_CITY,
    country: GALAXUS_SSCC_RECIPIENT_COUNTRY,
    vatId: null,
  };
}

function parsePostalLine(line?: string) {
  if (!line) return { postalCode: "", city: "" };
  const parts = line.split(" ");
  const postalCode = parts.shift() ?? "";
  return { postalCode, city: parts.join(" ") };
}
