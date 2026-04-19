import type { LabelData } from "../types";
import { labelStyles } from "./styles";
import { escapeHtml } from "./format";
import type { Address } from "../types";

export function renderLabelHtml(data: LabelData): string {
  const orderList = data.orderNumbers.map(escapeHtml).join(", ");
  const senderLines = [
    data.sender.line1?.trim() ?? "",
    data.sender.line2?.trim() ?? "",
    `${data.sender.postalCode ?? ""} ${data.sender.city ?? ""}`.trim(),
    data.sender.country?.trim() ?? "",
  ].filter((line): line is string => Boolean(line));
  const recipientLines = [
    data.recipient.line1?.trim() ?? "",
    data.recipient.line2?.trim() ?? "",
    `${data.recipient.postalCode ?? ""} ${data.recipient.city ?? ""}`.trim(),
    data.recipient.country?.trim() ?? "",
  ].filter((line): line is string => Boolean(line));
  const hasSender = Boolean(data.sender.name) || senderLines.length > 0;
  const gridStyle = hasSender ? "" : 'style="grid-template-columns: 1fr;"';

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

          <div class="grid" ${gridStyle}>
            ${
              hasSender
                ? `
                  <div class="address">
                    <strong>Sender:</strong><br>
                    ${escapeHtml(data.sender.name)}<br>
                    ${senderLines.map(escapeHtml).join("<br>")}
                  </div>
                `
                : ""
            }
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

export function renderBasicSsccLabelHtml(params: {
  recipient: Address;
  sscc: string;
  barcodeDataUrl: string;
}): string {
  const recipientLines = [
    params.recipient.line1?.trim() ?? "",
    params.recipient.line2?.trim() ?? "",
    `${params.recipient.postalCode ?? ""} ${params.recipient.city ?? ""}`.trim(),
    params.recipient.country?.trim() ?? "",
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
          <div class="title">SSCC Label</div>
          <div class="grid" style="grid-template-columns: 1fr;">
            <div class="address">
              <strong>Recipient:</strong><br>
              ${escapeHtml(params.recipient.name)}<br>
              ${recipientLines.map(escapeHtml).join("<br>")}
            </div>
          </div>
          <div class="barcode">
            <img src="${params.barcodeDataUrl}" alt="SSCC barcode">
            <div class="barcode-text"><strong>SSCC:</strong> ${escapeHtml(params.sscc)}</div>
          </div>
        </div>
      </body>
    </html>
  `;
}
