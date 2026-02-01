import type { DeliveryNoteData, DeliveryNoteOrderGroup, OrderLine } from "../types";
import { baseStyles } from "./styles";
import { escapeHtml, formatDate } from "./format";

function renderLine(line: OrderLine): string {
  const descriptionParts = [
    `<strong>${escapeHtml(line.description)}</strong>`,
    line.size ? `<div class="small muted">Size: ${escapeHtml(line.size)}</div>` : "",
    line.gtin ? `<div class="small muted">GTIN: ${escapeHtml(line.gtin)}</div>` : "",
    line.providerKey ? `<div class="small muted">ProviderKey: ${escapeHtml(line.providerKey)}</div>` : "",
  ].filter(Boolean);

  return `
    <tr>
      <td class="nowrap">${escapeHtml(line.articleNumber ?? "")}</td>
      <td>${descriptionParts.join("")}</td>
      <td class="right nowrap">${line.quantity}</td>
    </tr>
  `;
}

function renderGroup(group: DeliveryNoteOrderGroup, isFirst: boolean): string {
  return `
    <div style="${isFirst ? "" : "page-break-before: always;"}">
      <div class="row mb12">
        <div class="col">
          <div class="title">Delivery Note</div>
        </div>
        <div class="col right">
          <div><strong>Order no. (PO):</strong> ${escapeHtml(group.orderNumber)}</div>
          <div><strong>Delivery date:</strong> ${formatDate(group.deliveryDate)}</div>
        </div>
      </div>
      <div class="hr"></div>
      <table class="mb16">
        <thead>
          <tr>
            <th class="w-art">Article no.</th>
            <th class="w-desc">Description</th>
            <th class="w-qty right">Quantity</th>
          </tr>
        </thead>
        <tbody>
          ${group.lines.map(renderLine).join("")}
        </tbody>
      </table>
    </div>
  `;
}

export function renderDeliveryNoteHtml(data: DeliveryNoteData): string {
  const buyerAddressLines = [
    data.buyer.line1,
    data.buyer.line2,
    `${data.buyer.postalCode} ${data.buyer.city}`,
    data.buyer.country,
  ].filter(Boolean);

  const supplierAddressLines = data.supplier.addressLines.filter(Boolean);

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>${baseStyles}</style>
      </head>
      <body>
        <div class="row mb16">
          <div class="col">
            <div class="muted small mb8"><strong>Delivery address</strong></div>
            <div class="box">
              <div><strong>${escapeHtml(data.buyer.name)}</strong></div>
              <div class="small">${buyerAddressLines.map(escapeHtml).join("<br>")}</div>
            </div>
          </div>
          <div class="col">
            <div class="muted small mb8"><strong>Supplier</strong></div>
            <div class="box">
              <div><strong>${escapeHtml(data.supplier.name)}</strong></div>
              <div class="small">${supplierAddressLines.map(escapeHtml).join("<br>")}</div>
              <div class="small">
                ${data.supplier.phone ? `Phone: ${escapeHtml(data.supplier.phone)}<br>` : ""}
                ${data.supplier.email ? `Email: ${escapeHtml(data.supplier.email)}<br>` : ""}
                ${data.supplier.website ? `${escapeHtml(data.supplier.website)}<br>` : ""}
              </div>
            </div>
          </div>
        </div>

        ${data.groups.map((group, index) => renderGroup(group, index === 0)).join("")}
      </body>
    </html>
  `;
}
