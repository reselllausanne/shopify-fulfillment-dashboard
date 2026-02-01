import type { LabelData } from "../types";
import { labelStyles } from "./styles";
import { escapeHtml } from "./format";

export function renderLabelHtml(data: LabelData): string {
  const orderList = data.orderNumbers.map(escapeHtml).join(", ");
  const buyerAddressLines = [
    data.buyer.line1,
    data.buyer.line2,
    `${data.buyer.postalCode} ${data.buyer.city}`,
    data.buyer.country,
  ].filter(Boolean);

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>${labelStyles}</style>
      </head>
      <body>
        <div class="label">
          <div class="title">Internal QR Label</div>
          <div class="section">
            <strong>Shipment:</strong> ${escapeHtml(data.shipmentId)}
          </div>
          <div class="section">
            <strong>Orders:</strong> ${orderList}
          </div>
          <div class="section">
            <strong>Ship to:</strong><br>
            ${escapeHtml(data.buyer.name)}<br>
            ${buyerAddressLines.map(escapeHtml).join("<br>")}
          </div>
          <div class="qr">
            <img src="${data.qrDataUrl}" alt="QR code">
          </div>
        </div>
      </body>
    </html>
  `;
}
