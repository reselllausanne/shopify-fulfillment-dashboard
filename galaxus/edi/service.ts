import { prisma } from "@/app/lib/prisma";
import { ingestGalaxusOrders } from "@/galaxus/orders/ingest";
import { DocumentService, buildInvoiceNumber } from "@/galaxus/documents/DocumentService";
import { DocumentType } from "@prisma/client";
import { getStorageAdapter } from "@/galaxus/storage/storage";
import { XMLParser } from "fast-xml-parser";
import {
  buildCancelResponse,
  buildInvoice,
  buildOrderResponse,
  buildOutOfStockNotice,
  buildExpinvFilenameForOrder,
} from "./documents";
import { EdiDocType } from "./filenames";
import { assertSftpConfig, GALAXUS_SFTP_HOST, GALAXUS_SFTP_IN_DIR, GALAXUS_SFTP_OUT_DIR, GALAXUS_SFTP_PASSWORD, GALAXUS_SFTP_PORT, GALAXUS_SFTP_USER, GALAXUS_SUPPLIER_ID } from "./config";
import { downloadRemoteFile, listRemoteFiles, uploadTempThenRename, withSftp } from "./sftpClient";
import { upsertEdiFile } from "./ediFiles";
import { GALAXUS_SUPPLIER_AUTO_SEND_ORDR } from "@/galaxus/config";
import { placeSupplierOrderForGalaxusOrder } from "@/galaxus/supplier/orders";
import { uploadDelrForOrder } from "@/galaxus/warehouse/delr";

type IncomingResult = {
  file: string;
  status: "processed" | "skipped" | "error";
  message?: string;
};

type OutgoingResult = {
  docType: EdiDocType;
  filename: string;
  status: "uploaded" | "skipped" | "error";
  message?: string;
  shipmentId?: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
});

export async function pollIncomingEdi(): Promise<IncomingResult[]> {
  assertSftpConfig();
  const results: IncomingResult[] = [];

  await withSftp(
    {
      host: GALAXUS_SFTP_HOST,
      port: GALAXUS_SFTP_PORT,
      username: GALAXUS_SFTP_USER,
      password: GALAXUS_SFTP_PASSWORD,
    },
    async (client) => {
      const files = await listRemoteFiles(client, GALAXUS_SFTP_IN_DIR);
      for (const file of files) {
        const existing = await prisma.galaxusEdiFile.findUnique({
          where: { filename: file.name },
          select: { id: true, status: true },
        });
        if (existing?.status === "processed") {
          results.push({ file: file.name, status: "skipped", message: "already processed" });
          continue;
        }

        try {
          const xml = await downloadRemoteFile(client, file.path);
          const docType = detectDocType(file.name);
          if (!docType) {
            await upsertEdiFile({
              filename: file.name,
              direction: "IN",
              docType: "ORDP",
              status: "error",
              message: "Unknown doc type",
              payloadJson: { filename: file.name },
            });
            results.push({ file: file.name, status: "error", message: "Unknown doc type" });
            continue;
          }

          const orderIdFromName = extractOrderId(file.name);
          if (docType === "ORDP") {
            const orderInput = parseOrderFromXml(xml, orderIdFromName);
            const [ingestResult] = await ingestGalaxusOrders([orderInput]);
            if (ingestResult) {
              const supplierResult = await placeSupplierOrderForGalaxusOrder(ingestResult.orderId);
              if (supplierResult.status === "created" && GALAXUS_SUPPLIER_AUTO_SEND_ORDR) {
                await sendOutgoingEdi({
                  orderId: ingestResult.orderId,
                  types: ["ORDR"],
                  ordrMode: supplierResult.ordrMode,
                });
              }
            }
          } else if (docType === "CANP") {
            await recordCancelRequest(orderIdFromName, xml);
          } else {
            await upsertEdiFile({
              filename: file.name,
              direction: "IN",
              docType,
              status: "skipped",
              message: "Unsupported inbound doc",
              payloadJson: { filename: file.name },
            });
          }

          await upsertEdiFile({
            filename: file.name,
            direction: "IN",
            docType,
            status: "processed",
            orderRef: orderIdFromName,
            payloadJson: { filename: file.name },
          });

          await client.delete(file.path);
          results.push({ file: file.name, status: "processed" });
        } catch (error: any) {
          await upsertEdiFile({
            filename: file.name,
            direction: "IN",
            docType: "ORDP",
            status: "error",
            message: error?.message,
            payloadJson: { filename: file.name },
          });
          results.push({ file: file.name, status: "error", message: error?.message });
        }
      }
    }
  );

  return results;
}

export async function sendOutgoingEdi(options: {
  orderId: string;
  types: EdiDocType[];
  ordrMode?: "WITH_ARRIVAL_DATES" | "WITHOUT_POSITIONS";
  forceDelr?: boolean;
}): Promise<OutgoingResult[]> {
  assertSftpConfig();
  const order = await prisma.galaxusOrder.findUnique({
    where: { id: options.orderId },
    include: { lines: true, shipments: true },
  });

  if (!order) {
    throw new Error(`Order not found: ${options.orderId}`);
  }

  const shipment = order.shipments[0] ?? null;
  const results: OutgoingResult[] = [];

  await withSftp(
    {
      host: GALAXUS_SFTP_HOST,
      port: GALAXUS_SFTP_PORT,
      username: GALAXUS_SFTP_USER,
      password: GALAXUS_SFTP_PASSWORD,
    },
    async (client) => {
      for (const type of options.types) {
        try {
          if (type === "DELR") {
            const delrResults = await uploadDelrForOrder(order.id, { force: options.forceDelr });
            results.push(
              ...delrResults.map((res) => ({
                docType: "DELR" as const,
                filename: res.filename ?? "",
                status: res.status,
                message: res.message,
                shipmentId: res.shipmentId,
              }))
            );
            continue;
          }

          const alreadySent = await prisma.galaxusEdiFile.findFirst({
            where: {
              direction: "OUT",
              docType: type,
              orderId: order.id,
            },
          });
          if (alreadySent) {
            results.push({ docType: type, filename: alreadySent.filename, status: "skipped", message: "already sent" });
            continue;
          }

          if (type === "EXPINV") {
            let doc = await prisma.document.findFirst({
              where: { orderId: order.id, type: DocumentType.INVOICE },
              orderBy: { createdAt: "desc" },
            });
            if (!doc) {
              const service = new DocumentService();
              const docs = await service.generateForOrder({
                orderId: order.id,
                types: [DocumentType.INVOICE],
              });
              doc = docs[0];
            }
            const storage = getStorageAdapter();
            const pdf = await storage.getPdf(doc.storageUrl);
            const invoiceNo = buildInvoiceNumber(order);
            const filename = buildExpinvFilenameForOrder(order, invoiceNo);
            await uploadTempThenRename(client, GALAXUS_SFTP_OUT_DIR, filename, pdf.content);
            await upsertEdiFile({
              filename,
              direction: "OUT",
              docType: type,
              orderId: order.id,
              orderRef: order.galaxusOrderId,
              status: "uploaded",
            });
            results.push({ docType: type, filename, status: "uploaded" });
            continue;
          }

          const edi = buildOutgoingXml(type, order, order.lines, shipment, options.ordrMode);
          await uploadTempThenRename(client, GALAXUS_SFTP_OUT_DIR, edi.filename, edi.content);
          await upsertEdiFile({
            filename: edi.filename,
            direction: "OUT",
            docType: type,
            orderId: order.id,
            orderRef: order.galaxusOrderId,
            status: "uploaded",
          });
          results.push({ docType: type, filename: edi.filename, status: "uploaded" });
          if (type === "ORDR") {
            const ordrMode = options.ordrMode ?? null;
            await prisma.galaxusOrder.update({
              where: { id: order.id },
              data: ordrMode ? { ordrSentAt: new Date(), ordrMode } : { ordrSentAt: new Date() },
            });
          }
        } catch (error: any) {
          results.push({ docType: type, filename: "", status: "error", message: error?.message });
        }
      }
    }
  );

  return results;
}

export async function sendPendingOutgoingEdi(limit = 5): Promise<OutgoingResult[]> {
  const orders = await prisma.galaxusOrder.findMany({
    include: {
      lines: true,
      shipments: true,
      statusEvents: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const results: OutgoingResult[] = [];
  for (const order of orders) {
    const hasCancel = order.statusEvents.some((event) => event.type === "CANCEL_REQUEST");
    const hasOutOfStock = order.statusEvents.some((event) => event.type === "OUT_OF_STOCK");
    const types: EdiDocType[] = ["ORDR"];
    if (order.shipments.length > 0) {
      types.push("DELR", "INVO", "EXPINV");
    }
    if (hasCancel) types.push("CANR");
    if (hasOutOfStock) types.push("EOLN");

    const ordrMode =
      order.ordrMode === "WITH_ARRIVAL_DATES" || order.ordrMode === "WITHOUT_POSITIONS"
        ? (order.ordrMode as "WITH_ARRIVAL_DATES" | "WITHOUT_POSITIONS")
        : undefined;
    const res = await sendOutgoingEdi({ orderId: order.id, types, ordrMode });
    results.push(...res);
  }

  return results;
}

function buildOutgoingXml(
  docType: EdiDocType,
  order: any,
  lines: any[],
  shipment: any,
  ordrMode?: "WITH_ARRIVAL_DATES" | "WITHOUT_POSITIONS"
) {
  if (docType === "ORDR") {
    return buildOrderResponse(order, lines, {
      supplierId: GALAXUS_SUPPLIER_ID,
      status: "ACCEPTED",
    });
  }
  if (docType === "CANR") {
    return buildCancelResponse(order, lines, {
      supplierId: GALAXUS_SUPPLIER_ID,
    });
  }
  if (docType === "EOLN") {
    return buildOutOfStockNotice(order, lines, {
      supplierId: GALAXUS_SUPPLIER_ID,
    });
  }
  if (docType === "INVO") {
    return buildInvoice(order, lines, {
      supplierId: GALAXUS_SUPPLIER_ID,
    });
  }
  throw new Error(`Unsupported doc type: ${docType}`);
}

function detectDocType(filename: string): EdiDocType | null {
  if (filename.startsWith("GORDP_")) return "ORDP";
  if (filename.startsWith("GCANP_")) return "CANP";
  return null;
}

function extractOrderId(filename: string): string {
  const parts = filename.split("_");
  return parts[2]?.replace(/\.xml$/i, "") ?? filename;
}

function parseOrderFromXml(xml: string, fallbackOrderId: string) {
  const data = parser.parse(xml) as any;
  const root = data.ORDER ?? data;
  const orderId = findValueByPath(root, ["ORDER_HEADER", "ORDER_INFO", "ORDER_ID"]) ?? fallbackOrderId;
  const orderNumber = findValueByPath(root, ["ORDER_HEADER", "ORDER_INFO", "ORDER_NUMBER"]) ?? null;
  const supplierOrderId = findValueByPath(root, ["ORDER_HEADER", "ORDER_INFO", "SUPPLIER_ORDER_ID"]) ?? null;
  const orderDateValue =
    findValueByPath(root, ["ORDER_HEADER", "ORDER_INFO", "ORDER_DATE"]) ?? new Date().toISOString();
  const generationDateValue =
    findValueByPath(root, ["ORDER_HEADER", "CONTROL_INFO", "GENERATION_DATE"]) ?? null;
  const orderDate = new Date(orderDateValue);
  const generationDate = generationDateValue ? new Date(generationDateValue) : null;
  const language = findValueByPath(root, ["ORDER_HEADER", "ORDER_INFO", "LANGUAGE"]) ?? null;
  const currency = findValueByPath(root, ["ORDER_HEADER", "ORDER_INFO", "CURRENCY"]) ?? "CHF";

  const buyer = findParty(root, "buyer");
  const delivery = findParty(root, "delivery");
  const supplier = findParty(root, "supplier");
  const marketplace = findParty(root, "marketplace");
  const buyerIdRef = findValueByPath(root, ["ORDER_HEADER", "ORDER_INFO", "ORDER_PARTIES_REFERENCE", "BUYER_IDREF"]);
  const supplierIdRef = findValueByPath(root, ["ORDER_HEADER", "ORDER_INFO", "ORDER_PARTIES_REFERENCE", "SUPPLIER_IDREF"]);
  const customerType = findUdxValue(root, "UDX.DG.CUSTOMER_TYPE");
  const deliveryType = findUdxValue(root, "UDX.DG.DELIVERY_TYPE");
  const isCollectiveOrder = parseBoolean(findUdxValue(root, "UDX.DG.IS_COLLECTIVE_ORDER"));
  const physicalDeliveryNoteRequired = parseBoolean(findUdxValue(root, "UDX.DG.PHYSICAL_DELIVERY_NOTE_REQUIRED"));
  const saturdayDeliveryAllowed = parseBoolean(findUdxValue(root, "UDX.DG.SATURDAY_DELIVERY_ALLOWED"));
  const endCustomerOrderReference = findUdxValue(root, "UDX.DG.END_CUSTOMER_ORDER_REFERENCE");
  const customerOrderReference = findValueByPath(root, ["ORDER_HEADER", "ORDER_INFO", "CUSTOMER_ORDER_REFERENCE", "ORDER_ID"]);

  const lines = extractLines(root);
  if (lines.length === 0) {
    throw new Error("No order lines found in ORDP.");
  }

  return {
    galaxusOrderId: orderId,
    orderNumber: orderNumber ?? undefined,
    supplierOrderId: supplierOrderId ?? undefined,
    orderDate: orderDate.toISOString(),
    generationDate: generationDate ? generationDate.toISOString() : undefined,
    language: language ?? undefined,
    deliveryDate: findValue(data, "DELIVERY_DATE") ?? undefined,
    currencyCode: currency,
    customerName: buyer?.name ?? "Digitec Galaxus AG",
    customerAddress1: buyer?.street ?? "Pfingstweidstrasse 60b",
    customerAddress2: buyer?.street2 ?? undefined,
    customerPostalCode: buyer?.postalCode ?? "8005",
    customerCity: buyer?.city ?? "Zürich",
    customerCountry: buyer?.country ?? "Schweiz",
    customerCountryCode: buyer?.countryCode ?? undefined,
    customerEmail: buyer?.email ?? undefined,
    customerVatId: buyer?.vatId ?? undefined,
    recipientName: delivery?.name ?? buyer?.name ?? undefined,
    recipientAddress1: delivery?.street ?? buyer?.street ?? undefined,
    recipientAddress2: delivery?.street2 ?? buyer?.street2 ?? undefined,
    recipientPostalCode: delivery?.postalCode ?? buyer?.postalCode ?? undefined,
    recipientCity: delivery?.city ?? buyer?.city ?? undefined,
    recipientCountry: delivery?.country ?? buyer?.country ?? undefined,
    recipientCountryCode: delivery?.countryCode ?? undefined,
    recipientEmail: delivery?.email ?? undefined,
    recipientPhone: delivery?.phone ?? buyer?.phone ?? undefined,
    referencePerson: findValue(data, "REFERENCE_PERSON") ?? undefined,
    yourReference: findValue(data, "YOUR_REFERENCE") ?? undefined,
    afterSalesHandling: Boolean(findValue(data, "AFTER_SALES_HANDLING") ?? false),
    customerType: customerType ?? undefined,
    deliveryType: deliveryType ?? undefined,
    isCollectiveOrder: isCollectiveOrder ?? undefined,
    physicalDeliveryNoteRequired: physicalDeliveryNoteRequired ?? undefined,
    saturdayDeliveryAllowed: saturdayDeliveryAllowed ?? undefined,
    endCustomerOrderReference: endCustomerOrderReference ?? customerOrderReference ?? undefined,
    buyerIdRef: buyerIdRef ?? undefined,
    supplierIdRef: supplierIdRef ?? undefined,
    buyerPartyId: buyer?.partyIds?.buyer_specific ?? undefined,
    buyerPartyGln: buyer?.partyIds?.gln ?? undefined,
    supplierPartyId: supplier?.partyIds?.supplier_specific ?? undefined,
    deliveryPartyId: delivery?.partyIds?.delivery_specific ?? undefined,
    marketplacePartyId: marketplace?.partyIds?.marketplace_specific ?? undefined,
    lines,
  };
}

async function recordCancelRequest(orderRef: string, xml: string) {
  const order = await prisma.galaxusOrder.findFirst({
    where: { galaxusOrderId: orderRef },
  });
  if (!order) return;
  await prisma.orderStatusEvent.create({
    data: {
      orderId: order.id,
      source: "galaxus",
      type: "CANCEL_REQUEST",
      payloadJson: { orderRef, raw: xml },
    },
  });
}

function extractLines(data: any) {
  const items = findAllByPath(data, ["ORDER_ITEM_LIST", "ORDER_ITEM"]);
  return items.map((item: any, index: number) => {
    const supplierPid = getNestedValue(item, ["PRODUCT_ID", "SUPPLIER_PID"]);
    const buyerPid = getNestedValue(item, ["PRODUCT_ID", "BUYER_PID"]);
    const internationalPid = getNestedValue(item, ["PRODUCT_ID", "INTERNATIONAL_PID"]);
    const unitPrice = getNestedValue(item, ["PRODUCT_PRICE_FIX", "PRICE_AMOUNT"]) ?? getNestedValue(item, ["PRICE_AMOUNT"]);
    const taxAmount = getNestedValue(item, ["PRODUCT_PRICE_FIX", "TAX_DETAILS_FIX", "TAX_AMOUNT"]) ?? getNestedValue(item, ["TAX_AMOUNT"]);
    const priceLineAmount = getNestedValue(item, ["PRICE_LINE_AMOUNT"]);
    const orderUnit = getNestedValue(item, ["ORDER_UNIT"]);
    const deliveryStartRaw = getNestedValue(item, ["DELIVERY_DATE", "DELIVERY_START_DATE"]);
    const deliveryEndRaw = getNestedValue(item, ["DELIVERY_DATE", "DELIVERY_END_DATE"]);
    const deliveryStart = deliveryStartRaw && deliveryStartRaw.trim() ? deliveryStartRaw : undefined;
    const deliveryEnd = deliveryEndRaw && deliveryEndRaw.trim() ? deliveryEndRaw : undefined;

    const qtyRaw = getNestedValue(item, ["QUANTITY"]);
    const qtyConfirmed = qtyRaw ? Number(qtyRaw) : undefined;

    return {
      lineNumber: Number(getNestedValue(item, ["LINE_ITEM_ID"]) ?? index + 1),
      supplierPid: supplierPid ?? undefined,
      buyerPid: buyerPid ?? undefined,
      orderUnit: orderUnit ?? undefined,
      supplierSku: buyerPid ?? undefined,
      supplierVariantId: undefined,
      productName: getNestedValue(item, ["DESCRIPTION_SHORT"]) ?? "Item",
      description: getNestedValue(item, ["DESCRIPTION_LONG"]) ?? undefined,
      size: getNestedValue(item, ["SIZE"]) ?? undefined,
      gtin: internationalPid ?? undefined,
      providerKey: supplierPid ?? undefined,
      quantity: Number(getNestedValue(item, ["QUANTITY"]) ?? 1),
      vatRate: getNestedValue(item, ["TAX_RATE"]) ?? "0",
      taxAmountPerUnit: taxAmount ?? undefined,
      unitNetPrice: unitPrice ?? "0",
      lineNetAmount: priceLineAmount ?? getNestedValue(item, ["LINE_TOTAL_AMOUNT"]) ?? "0",
      priceLineAmount: priceLineAmount ?? undefined,
      qtyConfirmed: Number.isNaN(qtyConfirmed) ? undefined : qtyConfirmed,
      arrivalDateStart: deliveryStart,
      arrivalDateEnd: deliveryEnd,
      currencyCode: getNestedValue(item, ["CURRENCY"]) ?? "CHF",
    };
  });
}

function findParty(data: any, role: string) {
  const parties = findAllByPath(data, ["PARTIES", "PARTY"]);
  for (const party of parties) {
    const roleAttr = party?.["@_PARTY_ROLE"] || party?.PARTY_ROLE;
    if (roleAttr && String(roleAttr).toLowerCase() === role) {
      const address = party.ADDRESS ?? {};
      const ids = extractPartyIds(party.PARTY_ID);
      const contact = address.CONTACT_DETAILS ?? {};
      const name =
        address.NAME ??
        [contact.FIRST_NAME, contact.CONTACT_NAME].filter(Boolean).join(" ") ??
        null;
      return {
        name,
        street: address.STREET ?? null,
        street2: address.STREET2 ?? null,
        postalCode: address.ZIP ?? null,
        city: address.CITY ?? null,
        country: address.COUNTRY ?? null,
        countryCode: address.COUNTRY_CODED ?? null,
        vatId: address.VAT_ID ?? null,
        email: address.EMAIL ?? null,
        phone: address.PHONE ?? null,
        partyIds: ids,
      };
    }
  }
  return null;
}

function extractPartyIds(raw: any) {
  const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const result: Record<string, string> = {};
  for (const entry of entries) {
    const type = entry?.["@_type"] ?? entry?.type;
    const value = entry?.["#text"] ?? entry?.text ?? entry;
    if (type && typeof value === "string") {
      result[String(type)] = value;
    }
  }
  return result;
}

function findAllByPath(data: any, path: string[]): any[] {
  const node = getNestedNode(data, path);
  if (!node) return [];
  return Array.isArray(node) ? node : [node];
}

function getNestedValue(data: any, path: string[]): string | null {
  const node = getNestedNode(data, path);
  if (node === undefined || node === null) return null;
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (node?.["#text"]) return String(node["#text"]);
  return null;
}

function getNestedNode(data: any, path: string[]) {
  let current = data;
  for (const key of path) {
    if (!current || typeof current !== "object") return null;
    const next = current[key];
    if (Array.isArray(next)) {
      current = next[0];
    } else {
      current = next;
    }
  }
  return current ?? null;
}

function findValueByPath(data: any, path: string[]): string | null {
  return getNestedValue(data, path);
}

function findUdxValue(data: any, key: string): string | null {
  const node = getNestedNode(data, ["ORDER_HEADER", "ORDER_INFO", "HEADER_UDX"]);
  if (!node || typeof node !== "object") return null;
  return (node[key] ?? node[key.toUpperCase()] ?? null) as string | null;
}

function parseBoolean(value: string | null): boolean | null {
  if (value === null || value === undefined) return null;
  const normalized = value.toString().trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return null;
}

function findAll(data: any, key: string, acc: any[] = []): any[] {
  if (!data || typeof data !== "object") return acc;
  if (data[key]) {
    const value = data[key];
    if (Array.isArray(value)) {
      acc.push(...value);
    } else {
      acc.push(value);
    }
  }
  for (const value of Object.values(data)) {
    if (typeof value === "object") findAll(value, key, acc);
  }
  return acc;
}

function findValue(data: any, key: string): string | null {
  if (!data || typeof data !== "object") return null;
  if (data[key]) {
    const value = data[key];
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  for (const value of Object.values(data)) {
    if (typeof value === "object") {
      const found = findValue(value, key);
      if (found !== null) return found;
    }
  }
  return null;
}

