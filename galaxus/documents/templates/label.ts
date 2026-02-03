import type { LabelData } from "../types";
import { labelStyles } from "./styles";
import { escapeHtml } from "./format";

export function renderLabelHtml(data: LabelData): string {
  const orderList = data.orderNumbers.map(escapeHtml).join(", ");
  const senderLines = [
    data.sender.line1,
    data.sender.line2,
    `${data.sender.postalCode} ${data.sender.city}`,
    data.sender.country,
  ].filter((line): line is string => Boolean(line));
  const recipientLines = [
    data.recipient.line1,
    data.recipient.line2,
    `${data.recipient.postalCode} ${data.recipient.city}`,
    data.recipient.country,
  ].filter((line): line is string => Boolean(line));

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>${labelStyles}</style>
      </head>
      <body>
        <div class="label">
          <div class="title">Delivery Label</div>
          <div class="section"><strong>Shipment:</strong> ${escapeHtml(data.shipmentId)}</div>
          <div class="section"><strong>Orders:</strong> ${orderList}</div>

          <div class="grid">
            <div class="address">
              <strong>Sender:</strong><br>
              ${escapeHtml(data.sender.name)}<br>
              ${senderLines.map(escapeHtml).join("<br>")}
            </div>
            <div class="address">
              <strong>Recipient:</strong><br>
              ${escapeHtml(data.recipient.name)}<br>
              ${recipientLines.map(escapeHtml).join("<br>")}
            </div>
          </div>

          <div class="barcode">
            <img src="${data.barcodeDataUrl}" alt="SSCC barcode">
            <div class="barcode-text"><strong>SSCC:</strong> ${escapeHtml(data.sscc)}</div>
          </div>
        </div>
      </body>
    </html>
  `;
}
