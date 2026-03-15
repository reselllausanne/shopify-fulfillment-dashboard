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
const BMECAT_NS = "http://www.bmecat.org/bmecat/2005";
const XSD_NS = "http://www.w3.org/2001/XMLSchema";
const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";

function formatDate(value: Date): string {
  return value.toISOString().split("T")[0];
}

function formatDateTime(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function formatDispatchDateTime(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/, "");
}

function addOrderResponseLineItem(parent: any, line: EdiOrderLine) {
  const item = parent.ele("ORDERRESPONSE_ITEM");
  const product = item.ele("PRODUCT_ID");
  if (line.supplierPid) product.ele("SUPPLIER_PID", { xmlns: BMECAT_NS }).txt(line.supplierPid);
  if (!line.supplierPid && line.providerKey) {
    product.ele("SUPPLIER_PID", { xmlns: BMECAT_NS }).txt(line.providerKey);
  }
  if (line.gtin) product.ele("INTERNATIONAL_PID", { xmlns: BMECAT_NS }).txt(line.gtin);
  if (line.buyerPid) product.ele("BUYER_PID", { xmlns: BMECAT_NS }).txt(line.buyerPid);
  item.ele("QUANTITY").txt(line.quantity.toString());
  if (line.arrivalDateStart || line.arrivalDateEnd) {
    const deliveryDate = item.ele("DELIVERY_DATE");
    if (line.arrivalDateStart) {
      deliveryDate.ele("DELIVERY_START_DATE").txt(formatDate(line.arrivalDateStart));
    }
    if (line.arrivalDateEnd) {
      deliveryDate.ele("DELIVERY_END_DATE").txt(formatDate(line.arrivalDateEnd));
    }
  }
}

function normalizeCountry(country: string): string {
  return country === "Switzerland" ? "Schweiz" : country;
}

function addParty(
  parent: any,
  party: EdiParty,
  role: string,
  options: { omitEmail?: boolean; includeRoleNode?: boolean } = {}
) {
  const node = parent.ele("PARTY", { "PARTY_ROLE": role });
  if (options.includeRoleNode) {
    node.ele("PARTY_ROLE").txt(role);
  }
  node.ele("PARTY_ID", { "type": "supplier" }).txt(party.id);
  const address = node.ele("ADDRESS");
  address.ele("NAME").txt(party.name);
  address.ele("STREET").txt(party.street);
  if (party.street2) address.ele("STREET2").txt(party.street2);
  address.ele("ZIP").txt(party.postalCode);
  address.ele("CITY").txt(party.city);
  address.ele("COUNTRY").txt(normalizeCountry(party.country));
  if (party.vatId) address.ele("VAT_ID").txt(party.vatId);
  if (!options.omitEmail && party.email) address.ele("EMAIL").txt(party.email);
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
      "xmlns:xsd": XSD_NS,
      xmlns: OPENTRANS_NS,
      "xmlns:xsi": XSI_NS,
      version: "2.1",
    });

  const header = root.ele("ORDERRESPONSE_HEADER");
  const info = header.ele("ORDERRESPONSE_INFO");
  info.ele("ORDER_ID").txt(doc.orderId);
  info.ele("ORDERRESPONSE_DATE").txt(formatDispatchDateTime(doc.responseDate));
  if (doc.supplierOrderId) {
    info.ele("SUPPLIER_ORDER_ID").txt(doc.supplierOrderId);
  }

  const items = root.ele("ORDERRESPONSE_ITEM_LIST");
  for (const line of doc.lines) {
    addOrderResponseLineItem(items, line);
  }

  return root.end({ prettyPrint: true });
}

function addDispatchLineItem(parent: any, line: EdiOrderLine, orderId: string) {
  const item = parent.ele("DISPATCHNOTIFICATION_ITEM");

  const product = item.ele("PRODUCT_ID");
  if (line.supplierPid) product.ele("SUPPLIER_PID", { xmlns: BMECAT_NS }).txt(line.supplierPid);
  if (!line.supplierPid && line.providerKey) {
    product.ele("SUPPLIER_PID", { xmlns: BMECAT_NS }).txt(line.providerKey);
  }
  if (line.gtin) product.ele("INTERNATIONAL_PID", { xmlns: BMECAT_NS }).txt(line.gtin);
  if (line.buyerPid) product.ele("BUYER_PID", { xmlns: BMECAT_NS }).txt(line.buyerPid);

  item.ele("QUANTITY").txt(line.quantity.toString());
  if (line.orderUnit) item.ele("ORDER_UNIT").txt(line.orderUnit);

  const orderRef = item.ele("ORDER_REFERENCE");
  orderRef.ele("ORDER_ID").txt(line.orderReferenceId ?? orderId);

  if (line.dispatchPackages && line.dispatchPackages.length > 0) {
    const logistics = item.ele("LOGISTIC_DETAILS");
    const packageInfo = logistics.ele("PACKAGE_INFO");
    for (const pack of line.dispatchPackages) {
      const pkg = packageInfo.ele("PACKAGE");
      pkg.ele("PACKAGE_ID").txt(pack.packageId);
      pkg.ele("PACKAGE_ORDER_UNIT_QUANTITY").txt(pack.quantity.toString());
    }
  }
}

function addDispatchDeliveryParty(parent: any, party: EdiParty) {
  const node = parent.ele("PARTY");
  node.ele("PARTY_ROLE").txt("delivery");
  const address = node.ele("ADDRESS");
  address.ele("NAME", { xmlns: BMECAT_NS }).txt(party.name);
  if (party.street2) address.ele("NAME2", { xmlns: BMECAT_NS }).txt(party.street2);
  address.ele("STREET", { xmlns: BMECAT_NS }).txt(party.street);
  address.ele("ZIP", { xmlns: BMECAT_NS }).txt(party.postalCode);
  address.ele("CITY", { xmlns: BMECAT_NS }).txt(party.city);
  address.ele("COUNTRY", { xmlns: BMECAT_NS }).txt(normalizeCountry(party.country));
  address.ele("COUNTRY_CODED", { xmlns: BMECAT_NS }).txt("CH");
}

function addInvoiceParty(parent: any, role: "buyer" | "invoice_issuer" | "delivery", party: EdiParty) {
  const node = parent.ele("PARTY");
  node.ele("PARTY_ROLE").txt(role);
  const address = node.ele("ADDRESS");
  address.ele("NAME", { xmlns: BMECAT_NS }).txt(party.name);
  if (party.street2) address.ele("NAME2", { xmlns: BMECAT_NS }).txt(party.street2);
  address.ele("STREET", { xmlns: BMECAT_NS }).txt(party.street);
  address.ele("ZIP", { xmlns: BMECAT_NS }).txt(party.postalCode);
  address.ele("CITY", { xmlns: BMECAT_NS }).txt(party.city);
  address.ele("COUNTRY", { xmlns: BMECAT_NS }).txt(normalizeCountry(party.country));
  if (party.vatId && role === "invoice_issuer") {
    address.ele("VAT_ID", { xmlns: BMECAT_NS }).txt(party.vatId);
  }
}

export function buildDispatchXml(doc: EdiDispatchDocument): string {
  const root = create({ version: "1.0", encoding: "UTF-8" })
    .ele("DISPATCHNOTIFICATION", {
      "xmlns:xsd": XSD_NS,
      "xmlns:xsi": XSI_NS,
      xmlns: OPENTRANS_NS,
      version: "2.1",
    });

  const header = root.ele("DISPATCHNOTIFICATION_HEADER");
  const control = header.ele("CONTROL_INFO");
  control.ele("GENERATION_DATE").txt(formatDispatchDateTime(doc.generationDate));
  const info = header.ele("DISPATCHNOTIFICATION_INFO");
  info.ele("DISPATCHNOTIFICATION_ID").txt(doc.dispatchNotificationId);
  info.ele("DISPATCHNOTIFICATION_DATE").txt(formatDispatchDateTime(doc.dispatchDate));

  const parties = info.ele("PARTIES");
  if (
    !doc.deliveryParty ||
    !doc.deliveryParty.name?.trim() ||
    !doc.deliveryParty.street?.trim() ||
    !doc.deliveryParty.postalCode?.trim() ||
    !doc.deliveryParty.city?.trim() ||
    !doc.deliveryParty.country?.trim()
  ) {
    throw new Error("Missing delivery party address for DELR");
  }
  const deliveryParty = {
    id: doc.deliveryParty?.id?.trim() ? doc.deliveryParty.id : "delivery",
    name: doc.deliveryParty.name,
    street: doc.deliveryParty.street,
    street2: doc.deliveryParty.street2?.trim() ? doc.deliveryParty.street2 : undefined,
    postalCode: doc.deliveryParty.postalCode,
    city: doc.deliveryParty.city,
    country: doc.deliveryParty.country,
    vatId: doc.deliveryParty.vatId?.trim() ? doc.deliveryParty.vatId : undefined,
    email: doc.deliveryParty.email?.trim() ? doc.deliveryParty.email : undefined,
    phone: doc.deliveryParty.phone?.trim() ? doc.deliveryParty.phone : undefined,
  };
  addDispatchDeliveryParty(parties, deliveryParty);

  if (doc.shipmentId) info.ele("SHIPMENT_ID").txt(doc.shipmentId);
  if (doc.shipmentCarrier) info.ele("SHIPMENT_CARRIER").txt(doc.shipmentCarrier);

  const items = root.ele("DISPATCHNOTIFICATION_ITEM_LIST");
  for (const line of doc.lines) {
    addDispatchLineItem(items, line, doc.orderId);
  }

  return root.end({ prettyPrint: true });
}

export function buildInvoiceXml(doc: EdiInvoiceDocument): string {
  const root = create({ version: "1.0", encoding: "UTF-8" })
    .ele("INVOICE", {
      "xmlns:xsd": XSD_NS,
      xmlns: OPENTRANS_NS,
      "xmlns:xsi": XSI_NS,
      version: "2.1",
    });

  const header = root.ele("INVOICE_HEADER");
  const control = header.ele("CONTROL_INFO");
  control.ele("GENERATION_DATE").txt(formatDispatchDateTime(doc.generationDate));
  const info = header.ele("INVOICE_INFO");
  info.ele("INVOICE_ID").txt(doc.docId);
  info.ele("INVOICE_DATE").txt(formatDispatchDateTime(doc.invoiceDate));
  if (doc.deliveryNoteId) {
    info.ele("DELIVERYNOTE_ID").txt(doc.deliveryNoteId);
  }
  if (doc.deliveryStartDate || doc.deliveryEndDate) {
    const deliveryDate = info.ele("DELIVERY_DATE");
    if (doc.deliveryStartDate) {
      deliveryDate.ele("DELIVERY_START_DATE").txt(formatDate(doc.deliveryStartDate));
    }
    if (doc.deliveryEndDate) {
      deliveryDate.ele("DELIVERY_END_DATE").txt(formatDate(doc.deliveryEndDate));
    }
  }

  const parties = info.ele("PARTIES");
  if (
    doc.deliveryParty &&
    (!doc.deliveryParty.name?.trim() ||
      !doc.deliveryParty.street?.trim() ||
      !doc.deliveryParty.postalCode?.trim() ||
      !doc.deliveryParty.city?.trim() ||
      !doc.deliveryParty.country?.trim())
  ) {
    throw new Error("Missing delivery party address for INVO");
  }
  const deliveryParty = doc.deliveryParty
    ? {
        id: doc.deliveryParty?.id?.trim() ? doc.deliveryParty.id : "delivery",
        name: doc.deliveryParty.name,
        street: doc.deliveryParty.street,
        street2: doc.deliveryParty.street2?.trim() ? doc.deliveryParty.street2 : undefined,
        postalCode: doc.deliveryParty.postalCode,
        city: doc.deliveryParty.city,
        country: doc.deliveryParty.country,
        vatId: doc.deliveryParty.vatId?.trim() ? doc.deliveryParty.vatId : undefined,
        email: doc.deliveryParty.email?.trim() ? doc.deliveryParty.email : undefined,
        phone: doc.deliveryParty.phone?.trim() ? doc.deliveryParty.phone : undefined,
      }
    : null;
  addInvoiceParty(parties, "buyer", doc.buyer);
  addInvoiceParty(parties, "invoice_issuer", doc.supplier);
  if (deliveryParty) {
    addInvoiceParty(parties, "delivery", deliveryParty);
  }
  info.ele("CURRENCY", { xmlns: BMECAT_NS }).txt(doc.currency);

  const orderHistory = header.ele("ORDER_HISTORY");
  orderHistory.ele("ORDER_ID").txt(doc.orderId);
  if (doc.supplierOrderId) {
    orderHistory.ele("SUPPLIER_ORDER_ID").txt(doc.supplierOrderId);
  }

  const items = root.ele("INVOICE_ITEM_LIST");
  for (const line of doc.lines) {
    const item = items.ele("INVOICE_ITEM");
    const product = item.ele("PRODUCT_ID");
    if (line.supplierPid) product.ele("SUPPLIER_PID", { xmlns: BMECAT_NS }).txt(line.supplierPid);
    if (!line.supplierPid && line.providerKey) {
      product.ele("SUPPLIER_PID", { xmlns: BMECAT_NS }).txt(line.providerKey);
    }
    if (line.gtin) product.ele("INTERNATIONAL_PID", { xmlns: BMECAT_NS }).txt(line.gtin);
    if (line.buyerPid) product.ele("BUYER_PID", { xmlns: BMECAT_NS }).txt(line.buyerPid);
    item.ele("QUANTITY").txt(line.quantity.toString());
    const price = item.ele("PRODUCT_PRICE_FIX");
    price.ele("PRICE_AMOUNT", { xmlns: BMECAT_NS }).txt(line.unitNetPrice.toString());
    const tax = price.ele("TAX_DETAILS_FIX");
    tax.ele("TAX", { xmlns: BMECAT_NS }).txt((line.vatRate / 100).toFixed(3));
    tax.ele("TAX_AMOUNT").txt(((line.lineNetAmount * line.vatRate) / 100).toFixed(2));
    item.ele("PRICE_LINE_AMOUNT").txt(line.lineNetAmount.toString());
    const orderRef = item.ele("ORDER_REFERENCE");
    orderRef.ele("ORDER_ID").txt(line.orderReferenceId ?? doc.orderId);
    if (doc.deliveryNoteId || doc.deliveryStartDate || doc.deliveryEndDate) {
      const deliveryRef = item.ele("DELIVERY_REFERENCE");
      if (doc.deliveryNoteId) deliveryRef.ele("DELIVERYNOTE_ID").txt(doc.deliveryNoteId);
      if (doc.deliveryStartDate || doc.deliveryEndDate) {
        const deliveryDate = deliveryRef.ele("DELIVERY_DATE");
        if (doc.deliveryStartDate) {
          deliveryDate.ele("DELIVERY_START_DATE").txt(formatDate(doc.deliveryStartDate));
        }
        if (doc.deliveryEndDate) {
          deliveryDate.ele("DELIVERY_END_DATE").txt(formatDate(doc.deliveryEndDate));
        }
      }
    }
  }

  const summary = root.ele("INVOICE_SUMMARY");
  summary.ele("NET_VALUE_GOODS").txt(doc.totals.net.toString());
  summary.ele("TOTAL_AMOUNT").txt(doc.totals.gross.toString());
  const totalTax = summary.ele("TOTAL_TAX");
  const taxDetails = totalTax.ele("TAX_DETAILS_FIX");
  const topRate = doc.vatSummary[0]?.vatRate ?? 0;
  taxDetails.ele("TAX", { xmlns: BMECAT_NS }).txt((topRate / 100).toFixed(3));
  taxDetails.ele("TAX_AMOUNT").txt(doc.totals.vat.toFixed(2));

  return root.end({ prettyPrint: true });
}
