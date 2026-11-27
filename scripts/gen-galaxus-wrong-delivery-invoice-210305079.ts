/**
 * Separate invoice for the Salomon XT-6 delivered by mistake on Galaxus order 210305079
 * (ticket 26530931). Generates GINVO XML + PDF locally. Does NOT send / upload / touch the DB.
 *
 *   npx tsx scripts/gen-galaxus-wrong-delivery-invoice-210305079.ts [outDir]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/app/lib/prisma";
import { buildCustomInvoice } from "@/galaxus/edi/documents";
import { calculateTotals } from "@/galaxus/edi/mapper";
import { GALAXUS_SUPPLIER_ID } from "@/galaxus/edi/config";
import { renderInvoiceHtml } from "@/galaxus/documents/templates/invoice";
import { renderPdfFromHtml } from "@/galaxus/documents/renderers/playwrightRenderer";
import {
  GALAXUS_BUYER_ADDRESS1,
  GALAXUS_BUYER_ADDRESS2,
  GALAXUS_BUYER_CITY,
  GALAXUS_BUYER_COUNTRY,
  GALAXUS_BUYER_NAME,
  GALAXUS_BUYER_POSTAL_CODE,
  GALAXUS_SUPPLIER_ADDRESS_LINES,
  GALAXUS_SUPPLIER_EMAIL,
  GALAXUS_SUPPLIER_NAME,
  GALAXUS_SUPPLIER_PHONE,
  GALAXUS_SUPPLIER_VAT_ID,
  GALAXUS_SUPPLIER_WEBSITE,
} from "@/galaxus/config";

const ORDER_REF = "210305079";
const NET = 150;
const VAT_RATE = 8.1;

async function main() {
  const outDir = process.argv[2] || "tmp/galaxus-wrong-delivery-210305079";
  mkdirSync(outDir, { recursive: true });
  const order: any = await prisma.galaxusOrder.findFirst({
    where: { galaxusOrderId: ORDER_REF },
    include: { lines: true, shipments: true },
  });
  if (!order) throw new Error("order not found");

  const line = {
    orderReferenceId: ORDER_REF,
    description: "Salomon XT-6 Vanilla Ice Black Silver Cloud (39 1/3) - wrong delivery ticket 26530931",
    quantity: 1,
    unitNetPrice: NET,
    lineNetAmount: NET,
    vatRate: VAT_RATE,
    supplierPid: "NER_198720517202",
    gtin: "198720517202",
  };
  // No orderLineId: must not match / consume the jersey line coverage.
  const edi = buildCustomInvoice(order, [line], { supplierId: GALAXUS_SUPPLIER_ID });
  const invoiceNo = /<INVOICE_ID>([^<]+)<\/INVOICE_ID>/.exec(edi.content)?.[1] ?? "GINVO-?";

  const lines = [
    {
      lineNumber: 1,
      articleNumber: line.supplierPid,
      description: line.description,
      size: null,
      gtin: line.gtin,
      providerKey: line.supplierPid,
      sku: line.supplierPid,
      quantity: 1,
      vatRate: VAT_RATE,
      unitNetPrice: NET,
      lineNetAmount: NET,
    },
  ];
  const { vatSummary, totals } = calculateTotals(lines as any);
  const html = renderInvoiceHtml({
    invoiceNumber: invoiceNo,
    orderNumber: ORDER_REF,
    orderDate: order.orderDate,
    invoiceDate: new Date(),
    deliveryDate: null,
    currency: order.currencyCode,
    buyer: {
      name: GALAXUS_BUYER_NAME,
      line1: GALAXUS_BUYER_ADDRESS1,
      line2: GALAXUS_BUYER_ADDRESS2,
      postalCode: GALAXUS_BUYER_POSTAL_CODE,
      city: GALAXUS_BUYER_CITY,
      country: GALAXUS_BUYER_COUNTRY,
    } as any,
    supplier: {
      name: GALAXUS_SUPPLIER_NAME,
      addressLines: GALAXUS_SUPPLIER_ADDRESS_LINES,
      phone: GALAXUS_SUPPLIER_PHONE || null,
      email: GALAXUS_SUPPLIER_EMAIL || null,
      website: GALAXUS_SUPPLIER_WEBSITE || null,
      vatId: GALAXUS_SUPPLIER_VAT_ID || null,
    },
    lines: lines as any,
    vatSummary,
    totals,
  });
  const pdf = await renderPdfFromHtml({ html, format: "A4", showPageNumbers: false });
  const pdfPath = path.join(outDir, `${invoiceNo}.pdf`);
  const xmlPath = path.join(outDir, edi.filename);
  writeFileSync(pdfPath, pdf);
  writeFileSync(xmlPath, edi.content);
  console.log(JSON.stringify({ invoiceNo, pdfPath, xmlPath, totals, vatSummary }, null, 2));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
