import { create } from "xmlbuilder2";
import type {
  EdiDispatchDocument,
  EdiInvoiceDocument,
  EdiOrderLine,
  EdiOrderResponseDocument,
  EdiParty,
  EdiVatSummaryLine,
} from "./types";

const OPENTRANS_NS = "http://www.opentrans.org/XMLSchema/2.1";
const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";

function formatDate(value: Date): string {
  return value.toISOString().split("T")[0];
}

function formatDateTime(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function addParty(parent: any, party: EdiParty, role: string) {
  const node = parent.ele("PARTY", { "PARTY_ROLE": role });
  node.ele("PARTY_ID", { "type": "supplier" }).txt(party.id);
  const address = node.ele("ADDRESS");
  address.ele("NAME").txt(party.name);
  address.ele("STREET").txt(party.street);
  if (party.street2) address.ele("STREET2").txt(party.street2);
  address.ele("ZIP").txt(party.postalCode);
  address.ele("CITY").txt(party.city);
  address.ele("COUNTRY").txt(party.country);
  if (party.vatId) address.ele("VAT_ID").txt(party.vatId);
  if (party.email) address.ele("EMAIL").txt(party.email);
  if (party.phone) address.ele("PHONE").txt(party.phone);
}

function addLineItem(parent: any, line: EdiOrderLine) {
  const item = parent.ele("LINE_ITEM");
  item.ele("LINE_ITEM_ID").txt(line.lineNumber.toString());

  const product = item.ele("PRODUCT_ID");
  if (line.supplierPid) product.ele("SUPPLIER_PID").txt(line.supplierPid);
  if (!line.supplierPid && line.providerKey) product.ele("SUPPLIER_PID").txt(line.providerKey);
  if (line.gtin) product.ele("INTERNATIONAL_PID").txt(line.gtin);
  if (line.buyerPid) product.ele("BUYER_PID").txt(line.buyerPid);

  item.ele("DESCRIPTION_SHORT").txt(line.description);
  item.ele("QUANTITY").txt(line.quantity.toString());
  if (line.orderUnit) {
    item.ele("ORDER_UNIT").txt(line.orderUnit);
  }

  const price = item.ele("PRICE");
  price.ele("PRICE_AMOUNT").txt(line.unitNetPrice.toFixed(2));
  price.ele("PRICE_QUANTITY").txt("1");

  const tax = item.ele("TAX");
  tax.ele("TAX_TYPE").txt("VAT");
  tax.ele("TAX_RATE").txt(line.vatRate.toFixed(2));

  item.ele("LINE_TOTAL_AMOUNT").txt(line.lineNetAmount.toFixed(2));
}

function addVatSummary(parent: any, summary: EdiVatSummaryLine[]) {
  if (!summary.length) return;
  const summaryNode = parent.ele("VAT_SUMMARY");
  for (const line of summary) {
    const vat = summaryNode.ele("VAT");
    vat.ele("VAT_RATE").txt(line.vatRate.toFixed(2));
    vat.ele("VAT_NET_AMOUNT").txt(line.netAmount.toFixed(2));
    vat.ele("VAT_AMOUNT").txt(line.vatAmount.toFixed(2));
    vat.ele("VAT_GROSS_AMOUNT").txt(line.grossAmount.toFixed(2));
  }
}

export function buildOrderResponseXml(doc: EdiOrderResponseDocument): string {
  const root = create({ version: "1.0", encoding: "UTF-8" })
    .ele("ORDERRESPONSE", {
      xmlns: OPENTRANS_NS,
      "xmlns:xsi": XSI_NS,
    });

  const header = root.ele("ORDERRESPONSE_HEADER");
  const info = header.ele("ORDERRESPONSE_INFO");
  info.ele("ORDERRESPONSE_ID").txt(doc.docId);
  info.ele("ORDERRESPONSE_DATE").txt(formatDateTime(doc.responseDate));
  info.ele("ORDER_ID").txt(doc.orderId);
  if (doc.orderNumber) info.ele("ORDER_NUMBER").txt(doc.orderNumber);
  info.ele("ORDER_DATE").txt(formatDate(doc.orderDate));
  info.ele("CURRENCY").txt(doc.currency);
  if (doc.deliveryDate) {
    info.ele("DELIVERY_DATE").txt(formatDate(doc.deliveryDate));
  }

  const parties = info.ele("PARTIES");
  addParty(parties, doc.buyer, "buyer");
  addParty(parties, doc.supplier, "supplier");

  const items = root.ele("ORDERRESPONSE_ITEM_LIST");
  for (const line of doc.lines) {
    const item = items.ele("ORDERRESPONSE_ITEM");
    addLineItem(item, line);
    const status = item.ele("ORDERRESPONSE_ITEM_STATUS");
    status.ele("RESPONSE_STATUS").txt(doc.status);
    if (doc.statusReason) status.ele("RESPONSE_REASON").txt(doc.statusReason);
  }

  return root.end({ prettyPrint: true });
}

export function buildDispatchXml(doc: EdiDispatchDocument): string {
  const root = create({ version: "1.0", encoding: "UTF-8" })
    .ele("DISPATCHNOTIFICATION", {
      xmlns: OPENTRANS_NS,
      "xmlns:xsi": XSI_NS,
    });

  const header = root.ele("DISPATCHNOTIFICATION_HEADER");
  const info = header.ele("DISPATCHNOTIFICATION_INFO");
  info.ele("DISPATCHNOTIFICATION_ID").txt(doc.docId);
  info.ele("DISPATCHNOTIFICATION_DATE").txt(formatDateTime(doc.dispatchDate));
  info.ele("ORDER_ID").txt(doc.orderId);
  if (doc.orderNumber) info.ele("ORDER_NUMBER").txt(doc.orderNumber);
  info.ele("ORDER_DATE").txt(formatDate(doc.orderDate));
  info.ele("CURRENCY").txt(doc.currency);

  const parties = info.ele("PARTIES");
  addParty(parties, doc.buyer, "buyer");
  addParty(parties, doc.supplier, "supplier");

  if (doc.shipmentId || doc.trackingNumber || doc.carrier) {
    const shipment = info.ele("SHIPMENT");
    if (doc.shipmentId) shipment.ele("SHIPMENT_ID").txt(doc.shipmentId);
    if (doc.carrier) shipment.ele("CARRIER").txt(doc.carrier);
    if (doc.trackingNumber) shipment.ele("TRACKING_NUMBER").txt(doc.trackingNumber);
  }

  const items = root.ele("DISPATCHNOTIFICATION_ITEM_LIST");
  for (const line of doc.lines) {
    addLineItem(items, line);
  }

  return root.end({ prettyPrint: true });
}

export function buildInvoiceXml(doc: EdiInvoiceDocument): string {
  const root = create({ version: "1.0", encoding: "UTF-8" })
    .ele("INVOICE", {
      xmlns: OPENTRANS_NS,
      "xmlns:xsi": XSI_NS,
    });

  const header = root.ele("INVOICE_HEADER");
  const info = header.ele("INVOICE_INFO");
  info.ele("INVOICE_ID").txt(doc.docId);
  info.ele("INVOICE_DATE").txt(formatDateTime(doc.invoiceDate));
  info.ele("ORDER_ID").txt(doc.orderId);
  if (doc.orderNumber) info.ele("ORDER_NUMBER").txt(doc.orderNumber);
  info.ele("ORDER_DATE").txt(formatDate(doc.orderDate));
  info.ele("CURRENCY").txt(doc.currency);

  const parties = info.ele("PARTIES");
  addParty(parties, doc.buyer, "buyer");
  addParty(parties, doc.supplier, "supplier");

  const items = root.ele("INVOICE_ITEM_LIST");
  for (const line of doc.lines) {
    addLineItem(items, line);
  }

  const summary = root.ele("INVOICE_SUMMARY");
  summary.ele("TOTAL_ITEM_NUM").txt(doc.lines.length.toString());
  summary.ele("TOTAL_AMOUNT_NET").txt(doc.totals.net.toFixed(2));
  summary.ele("TOTAL_AMOUNT_VAT").txt(doc.totals.vat.toFixed(2));
  summary.ele("TOTAL_AMOUNT_GROSS").txt(doc.totals.gross.toFixed(2));
  addVatSummary(summary, doc.vatSummary);

  return root.end({ prettyPrint: true });
}
