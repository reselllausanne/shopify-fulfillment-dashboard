import type { DeliveryNoteData, DeliveryNoteOrderGroup, OrderLine } from "../types";
import { baseStyles } from "./styles";
import { escapeHtml, formatDate } from "./format";

function renderLine(line: OrderLine): string {
  const descriptionParts = [
    `<strong>${escapeHtml(line.description)}</strong>`,
    line.sku ? `<div class="small muted">SKU: ${escapeHtml(line.sku)}</div>` : "",
    line.size ? `<div class="small muted">Size: ${escapeHtml(line.size)}</div>` : "",
    line.gtin ? `<div class="small muted">GTIN: ${escapeHtml(line.gtin)}</div>` : "",
  ].filter(Boolean);

  return `
    <tr>
      <td class="nowrap">${line.lineNumber}</td>
      <td class="right nowrap">${line.quantity}</td>
      <td>${descriptionParts.join("")}</td>
      <td class="nowrap">${escapeHtml(line.articleNumber ?? "")}</td>
      <td class="nowrap">${escapeHtml(line.gtin ?? "")}</td>
    </tr>
  `;
}

function renderGroup(group: DeliveryNoteOrderGroup, isFirst: boolean): string {
  return `
    <div style="${isFirst ? "" : "page-break-before: always;"}">
      <div class="row mb8">
        <div class="col">
          <div class="box small"><strong>Order number</strong><br>${escapeHtml(group.orderNumber)}</div>
        </div>
      </div>
      <table class="mb16">
        <thead>
          <tr>
            <th class="w-qty">Position</th>
            <th class="w-qty right">Quantity</th>
            <th class="w-desc">Product name</th>
            <th class="w-art">Galaxus article number</th>
            <th class="w-art">EAN / GTIN</th>
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
  ].filter((line): line is string => Boolean(line));

  const supplierAddressLines = data.supplier.addressLines.filter(Boolean);
  const deliveryDate = data.groups[0]?.deliveryDate ?? data.createdAt;

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
            <div class="muted small mb8"><strong>Adress of recipient</strong></div>
            <div class="box">
              <div><strong>${escapeHtml(data.buyer.name)}</strong></div>
              <div class="small">${buyerAddressLines.map(escapeHtml).join("<br>")}</div>
            </div>
          </div>
          <div class="col">
            <div class="muted small mb8"><strong>Supplier name and address</strong></div>
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

        <table class="mb16">
          <thead>
            <tr>
              <th>Delivery note number</th>
              <th>Date</th>
              <th>Order number</th>
              <th>Incoterms</th>
              <th>Page</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="nowrap">${escapeHtml(data.deliveryNoteNumber)}</td>
              <td class="nowrap">${formatDate(deliveryDate)}</td>
              <td class="nowrap">${escapeHtml(data.orderReference ?? "")}</td>
              <td class="nowrap">${escapeHtml(data.incoterms ?? "")}</td>
              <td class="nowrap">Page x / y</td>
            </tr>
          </tbody>
        </table>

        ${
          data.afterSalesHandling
            ? `<div class="mb12"><strong>After Sales Handling</strong></div>`
            : ""
        }

        ${data.groups.map((group, index) => renderGroup(group, index === 0)).join("")}

        ${
          data.legalNotice
            ? `
              <div class="small" style="margin-top: 12px;">
                <strong>Legal notices</strong><br>
                ${escapeHtml(data.legalNotice)}
              </div>
            `
            : ""
        }
      </body>
    </html>
  `;
}
