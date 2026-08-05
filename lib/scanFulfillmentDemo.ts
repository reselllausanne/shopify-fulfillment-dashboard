import "server-only";

import { renderPdfFromHtml } from "@/galaxus/documents/renderers/playwrightRenderer";

export const SCAN_DEMO_DECATHLON_CODE = "1000";
export const SCAN_DEMO_GALAXUS_CODE = "1001";

export type ScanDemoChannel = "decathlon" | "galaxus";

export type ScanDemoDocument = {
  parcelIndex: number;
  type: "label" | "packing_slip" | "delivery_note";
  base64: string;
  mimeType: string;
  filename: string;
};

export function isScanFulfillmentDemoEnabled() {
  return String(process.env.SCAN_FULFILLMENT_DEMO ?? "").trim() === "1";
}

export function resolveScanDemoChannel(code?: string | null): ScanDemoChannel | null {
  if (!isScanFulfillmentDemoEnabled()) return null;
  const normalized = String(code ?? "").trim();
  if (normalized === SCAN_DEMO_DECATHLON_CODE) return "decathlon";
  if (normalized === SCAN_DEMO_GALAXUS_CODE) return "galaxus";
  return null;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSwissPostLabelHtml(input: {
  title: string;
  recipientName: string;
  recipientStreet: string;
  recipientCity: string;
  trackingNumber: string;
  reference: string;
  channel: ScanDemoChannel;
  parcelIndex: number;
  parcelTotal: number;
}) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: 62mm 86mm; margin: 2mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 0; color: #111; }
    .banner { background: #ffcc00; color: #d40511; font-weight: 700; font-size: 11px; padding: 4px 6px; text-transform: uppercase; }
    .demo { background: #111; color: #fff; font-size: 9px; padding: 3px 6px; letter-spacing: 0.04em; }
    .block { padding: 8px 10px; border-bottom: 1px solid #ddd; }
    .small { font-size: 9px; color: #555; }
    .name { font-size: 14px; font-weight: 700; margin-top: 4px; }
    .addr { font-size: 11px; line-height: 1.35; margin-top: 2px; }
    .barcode { margin: 10px auto 4px; width: 90%; height: 42px; background:
      repeating-linear-gradient(90deg, #000 0 2px, #fff 2px 4px, #000 4px 5px, #fff 5px 8px); }
    .tracking { text-align: center; font-family: monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; }
    .meta { font-size: 9px; color: #444; text-align: center; margin-top: 6px; }
  </style>
</head>
<body>
  <div class="demo">DEMO — no Swiss Post / no marketplace API</div>
  <div class="banner">Swiss Post · PRI · ${escapeHtml(input.title)}</div>
  <div class="block">
    <div class="small">Recipient</div>
    <div class="name">${escapeHtml(input.recipientName)}</div>
    <div class="addr">${escapeHtml(input.recipientStreet)}<br/>${escapeHtml(input.recipientCity)}</div>
  </div>
  <div class="block">
    <div class="barcode"></div>
    <div class="tracking">${escapeHtml(input.trackingNumber)}</div>
    <div class="meta">${escapeHtml(input.reference)} · parcel ${input.parcelIndex}/${input.parcelTotal}</div>
  </div>
</body>
</html>`;
}

function renderDecathlonPackingSlipHtml(input: {
  orderNumber: string;
  parcelIndex: number;
  parcelTotal: number;
  productTitle: string;
  size: string;
  gtin: string;
  quantity: number;
  packageType: string;
}) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: A4; margin: 14mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
    .demo { background: #111; color: #fff; padding: 6px 10px; font-size: 11px; margin-bottom: 12px; }
    h1 { font-size: 20px; margin: 0 0 4px; color: #0082c3; }
    .sub { color: #666; margin-bottom: 18px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
    th { background: #f3f6f8; }
    .box { margin-top: 18px; padding: 10px; border: 1px dashed #0082c3; background: #f7fbfd; }
  </style>
</head>
<body>
  <div class="demo">DEMO packing slip — Mirakl OR72 not called</div>
  <h1>Decathlon delivery note</h1>
  <div class="sub">Order ${escapeHtml(input.orderNumber)} · shipment ${input.parcelIndex}/${input.parcelTotal}</div>
  <table>
    <thead>
      <tr><th>Product</th><th>Size</th><th>GTIN</th><th>Qty</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>${escapeHtml(input.productTitle)}</td>
        <td>${escapeHtml(input.size)}</td>
        <td>${escapeHtml(input.gtin)}</td>
        <td>${input.quantity}</td>
      </tr>
    </tbody>
  </table>
  <div class="box">
    <strong>Package type:</strong> ${escapeHtml(input.packageType)}<br/>
    <strong>Instructions:</strong> long item — use T4 carton, one pair per parcel for this demo.
  </div>
</body>
</html>`;
}

function renderGalaxusDeliveryNoteHtml(input: {
  orderNumber: string;
  productTitle: string;
  size: string;
  gtin: string;
}) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: A4; margin: 14mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
    .demo { background: #111; color: #fff; padding: 6px 10px; font-size: 11px; margin-bottom: 12px; }
    h1 { font-size: 20px; margin: 0 0 4px; color: #000; }
    .addr { margin: 16px 0; line-height: 1.5; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
    th { background: #f3f3f3; }
  </style>
</head>
<body>
  <div class="demo">DEMO delivery note — Galaxus DELR/ORDR not sent</div>
  <h1>Galaxus direct delivery note</h1>
  <div class="addr">
    <strong>Digitec Galaxus AG</strong><br/>
    Ferroring 23<br/>
    CH-5612 Villmergen
  </div>
  <div>Order: ${escapeHtml(input.orderNumber)}</div>
  <table>
    <thead>
      <tr><th>Description</th><th>Size</th><th>GTIN</th><th>Qty</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>${escapeHtml(input.productTitle)}</td>
        <td>${escapeHtml(input.size)}</td>
        <td>${escapeHtml(input.gtin)}</td>
        <td>1</td>
      </tr>
    </tbody>
  </table>
</body>
</html>`;
}

async function pdfToDocument(
  pdf: Buffer,
  input: Omit<ScanDemoDocument, "base64" | "mimeType">
): Promise<ScanDemoDocument> {
  return {
    ...input,
    mimeType: "application/pdf",
    base64: pdf.toString("base64"),
  };
}

export async function buildScanFulfillmentDemoDocuments(code: string): Promise<{
  ok: true;
  channel: ScanDemoChannel;
  documents: ScanDemoDocument[];
}> {
  const channel = resolveScanDemoChannel(code);
  if (!channel) {
    throw new Error("Unknown demo code");
  }

  const documents: ScanDemoDocument[] = [];

  if (channel === "decathlon") {
    const parcels = [
      {
        productTitle: "Nike Air Max 95 OG Big Bubble",
        size: "EU 44",
        gtin: "196152123456",
        packageType: "T4 long",
        tracking: "99.70.123456.12345678",
      },
      {
        productTitle: "adidas Yeezy Slide Onyx",
        size: "EU 45",
        gtin: "196152987654",
        packageType: "T4 long",
        tracking: "99.70.123456.87654321",
      },
    ];
    const orderNumber = "DEMO-DEC-1000";
    const parcelTotal = parcels.length;

    for (let index = 0; index < parcels.length; index += 1) {
      const parcel = parcels[index];
      const parcelIndex = index + 1;
      const labelPdf = await renderPdfFromHtml({
        html: renderSwissPostLabelHtml({
          title: "Decathlon direct",
          recipientName: "Decathlon Suisse SA",
          recipientStreet: "Route de la Fonderie 5",
          recipientCity: "1700 Fribourg · CH",
          trackingNumber: parcel.tracking,
          reference: `${orderNumber}-P${parcelIndex}`,
          channel,
          parcelIndex,
          parcelTotal,
        }),
        width: "62mm",
        height: "86mm",
        marginTop: "0",
        marginRight: "0",
        marginBottom: "0",
        marginLeft: "0",
      });
      const slipPdf = await renderPdfFromHtml({
        html: renderDecathlonPackingSlipHtml({
          orderNumber,
          parcelIndex,
          parcelTotal,
          productTitle: parcel.productTitle,
          size: parcel.size,
          gtin: parcel.gtin,
          quantity: 1,
          packageType: parcel.packageType,
        }),
        format: "A4",
        showPageNumbers: false,
      });

      documents.push(
        await pdfToDocument(labelPdf, {
          parcelIndex,
          type: "label",
          filename: `demo-decathlon-label-${parcelIndex}.pdf`,
        }),
        await pdfToDocument(slipPdf, {
          parcelIndex,
          type: "packing_slip",
          filename: `demo-decathlon-packing-slip-${parcelIndex}.pdf`,
        })
      );
    }

    return { ok: true, channel, documents };
  }

  const orderNumber = "DEMO-GX-1001";
  const labelPdf = await renderPdfFromHtml({
    html: renderSwissPostLabelHtml({
      title: "Galaxus direct delivery",
      recipientName: "M. Müller",
      recipientStreet: "Musterstrasse 12",
      recipientCity: "8001 Zürich · CH",
      trackingNumber: "99.70.654321.11223344",
      reference: orderNumber,
      channel,
      parcelIndex: 1,
      parcelTotal: 1,
    }),
    width: "62mm",
    height: "86mm",
    marginTop: "0",
    marginRight: "0",
    marginBottom: "0",
    marginLeft: "0",
  });
  const notePdf = await renderPdfFromHtml({
    html: renderGalaxusDeliveryNoteHtml({
      orderNumber,
      productTitle: "New Balance 550 White Green",
      size: "EU 42.5",
      gtin: "196152555444",
    }),
    format: "A4",
    showPageNumbers: false,
  });

  documents.push(
    await pdfToDocument(labelPdf, {
      parcelIndex: 1,
      type: "label",
      filename: "demo-galaxus-label.pdf",
    }),
    await pdfToDocument(notePdf, {
      parcelIndex: 1,
      type: "delivery_note",
      filename: "demo-galaxus-delivery-note.pdf",
    })
  );

  return { ok: true, channel, documents };
}

export function buildScanDemoScanPayload(channel: ScanDemoChannel) {
  const awb = channel === "decathlon" ? SCAN_DEMO_DECATHLON_CODE : SCAN_DEMO_GALAXUS_CODE;
  return {
    ok: true,
    status: "FOUND" as const,
    awb,
    fulfillmentDemo: channel,
    match: null,
    decathlon:
      channel === "decathlon"
        ? {
            matchId: "demo-decathlon",
            orderId: "DEMO-DEC-1000",
            orderDbId: "demo-decathlon",
            orderNumber: "DEMO-DEC-1000",
            orderState: "SHIPPING",
            lineId: "demo-line-1",
            miraklOrderLineId: "demo-mirakl-line-1",
            quantity: 1,
          }
        : null,
    galaxus:
      channel === "galaxus"
        ? {
            matchId: "demo-galaxus",
            orderId: "DEMO-GX-1001",
            orderDbId: "demo-galaxus",
            orderNumber: "DEMO-GX-1001",
            deliveryType: "direct_delivery",
            isDirectDelivery: true,
            allLinked: true,
            alreadyFulfilled: false,
            trackingNumber: null,
          }
        : null,
    inboundHome: null,
  };
}
