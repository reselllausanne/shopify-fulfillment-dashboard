import type { InvoiceData, OrderLine } from "../types";
import { baseStyles } from "./styles";
import { escapeHtml, formatDate, formatMoney, formatNumber, formatVatRate } from "./format";

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
      <td class="right nowrap">${formatVatRate(line.vatRate)}%</td>
      <td class="right nowrap">${formatNumber((line.lineNetAmount * line.vatRate) / 100)}</td>
      <td class="right nowrap">${formatNumber(line.unitNetPrice)}</td>
      <td class="right nowrap">${formatNumber(line.lineNetAmount)}</td>
    </tr>
  `;
}

export function renderInvoiceHtml(data: InvoiceData): string {
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
            <div class="muted small mb8"><strong>Invoice address</strong></div>
            <div class="box">
              <div><strong>${escapeHtml(data.buyer.name)}</strong></div>
              <div class="small">${buyerAddressLines.map(escapeHtml).join("<br>")}</div>
              ${data.buyer.vatId ? `<div class="small">VAT/UID: ${escapeHtml(data.buyer.vatId)}</div>` : ""}
            </div>
          </div>
          <div class="col">
            <div class="muted small mb8"><strong>Supplier (Invoicing party)</strong></div>
            <div class="box">
              <div><strong>${escapeHtml(data.supplier.name)}</strong></div>
              <div class="small">${supplierAddressLines.map(escapeHtml).join("<br>")}</div>
              <div class="small">
                ${data.supplier.phone ? `Phone: ${escapeHtml(data.supplier.phone)}<br>` : ""}
                ${data.supplier.email ? `Email: ${escapeHtml(data.supplier.email)}<br>` : ""}
                ${data.supplier.website ? `${escapeHtml(data.supplier.website)}<br>` : ""}
                ${data.supplier.vatId ? `<strong>VAT/UID:</strong> ${escapeHtml(data.supplier.vatId)}` : ""}
              </div>
            </div>
          </div>
        </div>

        <div class="row mb12">
          <div class="col">
            <div class="title">Invoice</div>
          </div>
          <div class="col right">
            <div><strong>Invoice no.:</strong> ${escapeHtml(data.invoiceNumber)}</div>
            <div><strong>Invoice date:</strong> ${formatDate(data.orderDate)}</div>
            <div><strong>Delivery date:</strong> ${formatDate(data.deliveryDate)}</div>
            <div><strong>Order no. (PO):</strong> ${escapeHtml(data.orderNumber ?? "")}</div>
          </div>
        </div>

        <div class="hr"></div>

        <table class="mb16">
          <thead>
            <tr>
              <th class="w-art">Article no.</th>
              <th class="w-desc">Description</th>
              <th class="w-qty right">Quantity</th>
              <th class="w-vat right">VAT rate %</th>
              <th class="w-vatamt right">VAT Amount sum</th>
              <th class="w-unit right">Net Price/Quantity (${escapeHtml(data.currency)})</th>
              <th class="w-line right">Net Price sum (${escapeHtml(data.currency)})</th>
            </tr>
          </thead>
          <tbody>
            ${data.lines.map((line) => renderLine(line)).join("")}
          </tbody>
        </table>

        <table class="totals">
          <tr>
            <td class="label right"><strong>Subtotal (${escapeHtml(data.currency)}):</strong></td>
            <td class="right nowrap">${formatMoney(data.totals.net, data.currency)}</td>
          </tr>
          <tr>
            <td class="label right"><strong>Total VAT (${escapeHtml(data.currency)}):</strong></td>
            <td class="right nowrap">${formatMoney(data.totals.vat, data.currency)}</td>
          </tr>
          <tr>
            <td class="label right strong"><strong>Total Gross (${escapeHtml(data.currency)}):</strong></td>
            <td class="right nowrap strong"><strong>${formatMoney(data.totals.gross, data.currency)}</strong></td>
          </tr>
        </table>

        <table class="totals" style="margin-top: 10px;">
          <tr>
            <td class="label right"><strong>VAT Summary</strong></td>
            <td></td>
          </tr>
          ${data.vatSummary
            .map(
              (line) => `
                <tr>
                  <td class="label right">${formatVatRate(line.vatRate)}% net:</td>
                  <td class="right nowrap">${formatMoney(line.netAmount, data.currency)}</td>
                </tr>
                <tr>
                  <td class="label right">${formatVatRate(line.vatRate)}% VAT:</td>
                  <td class="right nowrap">${formatMoney(line.vatAmount, data.currency)}</td>
                </tr>
              `
            )
            .join("")}
        </table>

        <div class="footer">
          <div class="mb8">
            <strong>Payment reference:</strong> ${escapeHtml(data.invoiceNumber)}
            ${data.orderNumber ? ` | <strong>PO:</strong> ${escapeHtml(data.orderNumber)}` : ""}
          </div>
        </div>
      </body>
    </html>
  `;
}
