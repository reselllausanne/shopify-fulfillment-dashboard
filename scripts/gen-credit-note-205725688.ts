/**
 * One-shot credit note PDF for Galaxus orders already invoiced then cancelled:
 * 205725688 (sales order 205725688).
 *
 *   npx tsx scripts/gen-credit-note-205725688.ts
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { renderPdfFromHtml } from "@/galaxus/documents/renderers/playwrightRenderer";
import { baseStyles } from "@/galaxus/documents/templates/styles";
import {
  GALAXUS_SUPPLIER_ADDRESS_LINES,
  GALAXUS_SUPPLIER_EMAIL,
  GALAXUS_SUPPLIER_NAME,
  GALAXUS_SUPPLIER_PHONE,
  GALAXUS_SUPPLIER_VAT_ID,
  GALAXUS_SUPPLIER_WEBSITE,
} from "@/galaxus/config";

const CREDIT_NO = `GCN-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-205725688`;
const CREDIT_DATE = new Date();

type Line = {
  galaxusOrderId: string;
  originalInvoice: string;
  originalInvoiceDate: string;
  description: string;
  sku: string;
  gtin: string;
  buyerPid: string;
  quantity: number;
  unitNetPrice: number;
  lineNetAmount: number;
  vatRate: number;
};

const LINES: Line[] = [
  {
    galaxusOrderId: "205725688",
    originalInvoice: "GINVO-20261016-090153",
    originalInvoiceDate: "2026-10-16",
    description: "Kiprun Chaussures Running Kipstorm Lab Rose Homme (43)",
    sku: "NER_3608393453846",
    gtin: "3608393453846",
    buyerPid: "71415342",
    quantity: 1,
    unitNetPrice: 330.5,
    lineNetAmount: 330.5,
    vatRate: 8.1,
  },
];

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n: number) {
  return new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtDate(d: Date) {
  return d.toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

async function main() {
  const goods = LINES.reduce((s, l) => s + l.lineNetAmount, 0);
  const freight = 6.0;
  const net = goods + freight;
  const vat = 27.26; // as on original invoice (8.1%: 26.77 goods + 0.49 freight)
  const gross = net + vat; // 363.76
  const supplierLines = GALAXUS_SUPPLIER_ADDRESS_LINES.join("<br>");

  const rows = LINES.map(
    (l) => `
    <tr>
      <td class="nowrap">${esc(l.buyerPid)}</td>
      <td>
        <strong>${esc(l.description)}</strong>
        <div class="small muted">SKU: ${esc(l.sku)}</div>
        <div class="small muted">GTIN: ${esc(l.gtin)}</div>
        <div class="small muted">Order / PO: 205725688</div>
        <div class="small muted">Ref. invoice: ${esc(l.originalInvoice)} (${esc(
          l.originalInvoiceDate
        )})</div>
      </td>
      <td class="right nowrap">-${l.quantity}</td>
      <td class="right nowrap">${l.vatRate.toFixed(1)}%</td>
      <td class="right nowrap">-${money((l.lineNetAmount * l.vatRate) / 100)}</td>
      <td class="right nowrap">-${money(l.unitNetPrice)}</td>
      <td class="right nowrap">-${money(l.lineNetAmount)}</td>
    </tr>`
  ).join("");

  const html = `<!doctype html>
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
        <div><strong>Digitec Galaxus AG</strong></div>
        <div class="small">Accounting<br>Pfingstweidstrasse 60b<br>8005 Zürich<br>Switzerland</div>
        <div class="small">VAT/UID: CHE-109.049.266 MWST</div>
      </div>
    </div>
    <div class="col">
      <div class="muted small mb8"><strong>Supplier (Invoicing party)</strong></div>
      <div class="box">
        <div><strong>${esc(GALAXUS_SUPPLIER_NAME)}</strong></div>
        <div class="small">${supplierLines}</div>
        <div class="small">
          ${GALAXUS_SUPPLIER_PHONE ? `Phone: ${esc(GALAXUS_SUPPLIER_PHONE)}<br>` : ""}
          ${GALAXUS_SUPPLIER_EMAIL ? `Email: ${esc(GALAXUS_SUPPLIER_EMAIL)}<br>` : ""}
          ${GALAXUS_SUPPLIER_WEBSITE ? `${esc(GALAXUS_SUPPLIER_WEBSITE)}<br>` : ""}
          ${GALAXUS_SUPPLIER_VAT_ID ? `<strong>VAT/UID:</strong> ${esc(GALAXUS_SUPPLIER_VAT_ID)}` : ""}
        </div>
      </div>
    </div>
  </div>

  <div class="row mb12">
    <div class="col">
      <div class="title">Credit note / Avoir</div>
      <div class="small muted" style="margin-top:6px">
        Full credit of invoice GINVO-20261016-090153 — parcel lost in transit (tracking 996015781700008050).
      </div>
    </div>
    <div class="col right">
      <div><strong>Credit note no.:</strong> ${esc(CREDIT_NO)}</div>
      <div><strong>Credit note date:</strong> ${fmtDate(CREDIT_DATE)}</div>
      <div><strong>Currency:</strong> CHF</div>
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
        <th class="w-unit right">Net Price/Quantity (CHF)</th>
        <th class="w-line right">Net Price sum (CHF)</th>
      </tr>
    </thead>
    <tbody>${rows}
      <tr><td></td><td><strong>Freight / Fracht / Frais de port</strong></td><td class="right nowrap">-1</td><td class="right nowrap">8.1%</td><td class="right nowrap">-0.49</td><td class="right nowrap">-6.00</td><td class="right nowrap">-6.00</td></tr></tbody>
  </table>

  <table class="totals">
    <tr>
      <td class="label right"><strong>Subtotal credit (CHF, goods + freight):</strong></td>
      <td class="right nowrap">-${money(net)}</td>
    </tr>
    <tr>
      <td class="label right"><strong>Total VAT (CHF):</strong></td>
      <td class="right nowrap">-${money(vat)}</td>
    </tr>
    <tr>
      <td class="label right strong"><strong>Total Gross credit (CHF):</strong></td>
      <td class="right nowrap strong"><strong>-${money(gross)}</strong></td>
    </tr>
  </table>

  <div class="footer" style="margin-top:24px">
    <div class="mb8">
      Please deduct <strong>CHF ${money(gross)}</strong> from the next payout / settle against the referenced invoices.
    </div>
    <div class="small muted">
      Reason: parcel lost in transit, shipped 14.10.2026 via Swiss Post (tracking 996015781700008050), delivery note GDN-20261014-082323-205725688-P1. Separate from the customer refund.
      Original EDI invoice: ${LINES.map((l) => l.originalInvoice).join(", ")}.
    </div>
  </div>
</body>
</html>`;

  const outDir = path.join(process.env.HOME ?? ".", "Downloads");
  mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, CREDIT_NO);
  writeFileSync(`${base}.html`, html, "utf8");
  const pdf = await renderPdfFromHtml({ html, format: "A4" });
  writeFileSync(`${base}.pdf`, pdf);
  console.log(
    JSON.stringify(
      {
        creditNo: CREDIT_NO,
        grossCreditChf: -gross,
        lines: LINES.length,
        html: `${base}.html`,
        pdf: `${base}.pdf`,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
