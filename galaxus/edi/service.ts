import { prisma } from "@/app/lib/prisma";
import { createHash, randomUUID } from "crypto";
import { ingestGalaxusOrders } from "@/galaxus/orders/ingest";
import { XMLParser } from "fast-xml-parser";
import {
  buildCancelResponse,
  buildInvoice,
  buildOrderResponse,
  buildOutOfStockNotice,
} from "./documents";
import { EdiDocType } from "./filenames";
import { assertSftpConfig, GALAXUS_SFTP_HOST, GALAXUS_SFTP_IN_DIR, GALAXUS_SFTP_OUT_DIR, GALAXUS_SFTP_PASSWORD, GALAXUS_SFTP_PORT, GALAXUS_SFTP_USER, GALAXUS_SUPPLIER_ID } from "./config";
import { downloadRemoteFile, listRemoteFiles, uploadTempThenRename, withSftp } from "./sftpClient";
import { upsertEdiFile } from "./ediFiles";
import { getSupplierGateForOrder, placeSupplierOrderForGalaxusOrder, resolveSupplierVariant } from "../supplier/orders";
import { uploadDelrForOrder } from "@/galaxus/warehouse/delr";

type IncomingResult = {
  file: string;
  status: "processed" | "skipped" | "error";
  message?: string;
  orderId?: string;
  galaxusOrderId?: string;
};

type OutgoingResult = {
  docType: EdiDocType;
  filename: string;
  status: "uploaded" | "skipped" | "error";
  message?: string;
  shipmentId?: string;
};

type OrderResponseStatus = "ACCEPTED" | "REJECTED" | "OUT_OF_STOCK";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
});

function clampXml(xml: string, max = 200_000): string {
  if (xml.length <= max) return xml;
  return xml.slice(0, max);
}

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
        const existing = await (prisma as any).galaxusEdiFile.findUnique({
          where: { filename: file.name },
          select: { id: true, status: true },
        });
        if (existing?.status === "processed") {
          results.push({ file: file.name, status: "skipped", message: "already processed" });
          continue;
        }

        let payloadJson: any = { filename: file.name };
        try {
          const xml = await downloadRemoteFile(client, file.path);
          payloadJson = { filename: file.name, rawXml: clampXml(xml), size: xml.length };
          const docType = detectDocType(file.name);
          if (!docType) {
            await upsertEdiFile({
              filename: file.name,
              direction: "IN",
              docType: "ORDP",
              status: "error",
              message: "Unknown doc type",
              payloadJson,
            });
            results.push({ file: file.name, status: "error", message: "Unknown doc type" });
            continue;
          }

          const orderIdFromName = extractOrderId(file.name);
          let ingestResult: { orderId: string; galaxusOrderId?: string } | null = null;
          if (docType === "ORDP") {
            const orderInput = parseOrderFromXml(xml, orderIdFromName);
            const missingGtins = orderInput.lines.filter(
              (line) => !line.gtin || String(line.gtin).trim().length === 0
            );
            if (missingGtins.length > 0) {
              const missingLines = missingGtins
                .map((line) => line.lineNumber ?? "?")
                .slice(0, 20)
                .join(", ");
              payloadJson = {
                ...payloadJson,
                missingGtins: missingGtins.length,
                missingLineNumbers: missingLines,
              };
              orderInput.lines = orderInput.lines.filter(
                (line) => line.gtin && String(line.gtin).trim().length > 0
              );
            }
            if (orderInput.lines.length === 0) {
              throw new Error("ORDP has no lines with GTIN.");
            }
            const [ingestRow] = await ingestGalaxusOrders([orderInput]);
            if (ingestRow) {
              ingestResult = ingestRow;
              await placeSupplierOrderForGalaxusOrder(ingestRow.orderId);
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
            payloadJson,
          });

          await client.delete(file.path);
          results.push({
            file: file.name,
            status: "processed",
            orderId: ingestResult?.orderId ?? undefined,
            galaxusOrderId: ingestResult?.galaxusOrderId ?? undefined,
          });
        } catch (error: any) {
          await upsertEdiFile({
            filename: file.name,
            direction: "IN",
            docType: "ORDP",
            status: "error",
            message: error?.message,
            payloadJson,
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
  force?: boolean;
  lineIds?: string[];
}): Promise<OutgoingResult[]> {
  assertSftpConfig();
  const force = Boolean(options.force);
  const order =
    (await prisma.galaxusOrder.findUnique({
      where: { id: options.orderId },
      include: { lines: true, shipments: true },
    })) ??
    (await prisma.galaxusOrder.findUnique({
      where: { galaxusOrderId: options.orderId },
      include: { lines: true, shipments: true },
    }));

  if (!order) {
    throw new Error(`Order not found: ${options.orderId}`);
  }

  const shipment = order.shipments[0] ?? null;
  const lineIds =
    Array.isArray(options.lineIds) && options.lineIds.length > 0
      ? new Set(options.lineIds.map((id) => String(id)))
      : null;
  const invoiceLines = lineIds ? order.lines.filter((line) => lineIds.has(String(line.id))) : order.lines;
  const results: OutgoingResult[] = [];
  const runId = randomUUID();
  const destination = `sftp://${GALAXUS_SFTP_HOST}:${GALAXUS_SFTP_PORT}${GALAXUS_SFTP_OUT_DIR}`;

  const createManifest = async (payload: {
    exportType: string;
    filename: string;
    checksum?: string | null;
    uploadStatus: string;
    responseJson?: unknown;
  }) => {
    try {
      await (prisma as any).galaxusExportManifest.create({
        data: {
          runId,
          exportType: payload.exportType,
          supplierKeys: [],
          productCount: 0,
          checksum: payload.checksum ?? null,
          storagePointer: payload.filename ? `${GALAXUS_SFTP_OUT_DIR.replace(/\/$/, "")}/${payload.filename}` : null,
          destination,
          uploadStatus: payload.uploadStatus,
          responseJson: payload.responseJson ?? undefined,
        },
      });
    } catch {
      // ignore audit failures
    }
  };

  const gate = await getSupplierGateForOrder(order.id);
  const lockAll = !gate.ok && (gate.reason ?? "").toLowerCase().includes("unsupported supplier");
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
          const gatedTypes: EdiDocType[] = ["DELR", "INVO"];
          if (
            !force &&
            type !== "ORDR" &&
            (lockAll || (gatedTypes.includes(type) && (!gate.ok || !gate.allowedTypes.has(type))))
          ) {
            results.push({
              docType: type,
              filename: "",
              status: "skipped",
              message: gate.reason ?? "Supplier order not ready",
            });
            continue;
          }
          if (type === "DELR") {
            if (!order.ordrSentAt && !force) {
              results.push({
                docType: "DELR",
                filename: "",
                status: "skipped",
                message: "ORDR not sent yet",
              });
              continue;
            }
            const delrResults = await uploadDelrForOrder(order.id, { force });
            results.push(
              ...delrResults.map((res) => ({
                docType: "DELR" as const,
                filename: res.filename ?? "",
                status: res.status,
                message: res.message,
                shipmentId: res.shipmentId,
              }))
            );
            for (const delr of delrResults) {
              if (!delr.filename) continue;
              await createManifest({
                exportType: "edi-out",
                filename: delr.filename,
                checksum: null,
                uploadStatus: delr.status,
                responseJson: { shipmentId: delr.shipmentId, status: delr.status, message: delr.message },
              });
            }
            continue;
          }

          const alreadySent = await (prisma as any).galaxusEdiFile.findFirst({
            where: {
              direction: "OUT",
              docType: type,
              orderId: order.id,
            },
          });
          if (alreadySent?.filename) {
            const dir = GALAXUS_SFTP_OUT_DIR.replace(/\/$/, "");
            const path = `${dir}/${alreadySent.filename}`;
            await client.delete(path).catch(() => undefined);
          }

          if (type === "INVO" && invoiceLines.length === 0) {
            results.push({
              docType: type,
              filename: "",
              status: "error",
              message: "No invoice lines selected",
            });
            continue;
          }
          const edi = await buildOutgoingXml(type, order, type === "INVO" ? invoiceLines : order.lines);
          await uploadTempThenRename(client, GALAXUS_SFTP_OUT_DIR, edi.filename, edi.content);
          const checksum = createHash("sha256").update(edi.content).digest("hex");
          await upsertEdiFile({
            filename: edi.filename,
            direction: "OUT",
            docType: type,
            orderId: order.id,
            orderRef: order.galaxusOrderId,
            status: "uploaded",
          });
          await createManifest({
            exportType: "edi-out",
            filename: edi.filename,
            checksum,
            uploadStatus: "uploaded",
            responseJson: { orderId: order.id, docType: type },
          });
          results.push({ docType: type, filename: edi.filename, status: "uploaded" });
          if (type === "ORDR") {
            const ordrMode = options.ordrMode ?? null;
            await prisma.galaxusOrder.update({
              where: { id: order.id },
              data: (ordrMode
                ? { ordrSentAt: new Date(), ordrMode }
                : { ordrSentAt: new Date() }) as unknown as Record<string, unknown>,
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

export async function buildOutgoingEdiXml(options: {
  orderId: string;
  type: Exclude<EdiDocType, "DELR" | "ORDP" | "CANP">;
  force?: boolean;
  lineIds?: string[];
}): Promise<{ filename: string; content: string }> {
  const order =
    (await prisma.galaxusOrder.findUnique({
      where: { id: options.orderId },
      include: { lines: true, shipments: true },
    })) ??
    (await prisma.galaxusOrder.findUnique({
      where: { galaxusOrderId: options.orderId },
      include: { lines: true, shipments: true },
    }));
  if (!order) {
    throw new Error(`Order not found: ${options.orderId}`);
  }
  const force = Boolean(options.force);
  const gate = await getSupplierGateForOrder(order.id);
  const gatedTypes: EdiDocType[] = ["ORDR", "INVO"];
  if (!force && gatedTypes.includes(options.type) && (!gate.ok || !gate.allowedTypes.has(options.type))) {
    throw new Error(gate.reason ?? "Supplier order not ready");
  }
  const lineIds =
    Array.isArray(options.lineIds) && options.lineIds.length > 0
      ? new Set(options.lineIds.map((id) => String(id)))
      : null;
  const invoiceLines = lineIds ? order.lines.filter((line) => lineIds.has(String(line.id))) : order.lines;
  if (options.type === "INVO" && invoiceLines.length === 0) {
    throw new Error("No invoice lines selected");
  }
  const edi = await buildOutgoingXml(options.type, order, options.type === "INVO" ? invoiceLines : order.lines);
  return { filename: edi.filename, content: edi.content };
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
      types.push("DELR", "INVO");
    }
    if (hasCancel) types.push("CANR");
    if (hasOutOfStock) types.push("EOLN");

    const rawOrdrMode =
      "ordrMode" in order ? (order as { ordrMode?: string | null }).ordrMode : null;
    const ordrMode =
      rawOrdrMode === "WITH_ARRIVAL_DATES" || rawOrdrMode === "WITHOUT_POSITIONS"
        ? (rawOrdrMode as "WITH_ARRIVAL_DATES" | "WITHOUT_POSITIONS")
        : undefined;
    const res = await sendOutgoingEdi({ orderId: order.id, types, ordrMode });
    results.push(...res);
  }

  return results;
}

async function attachOrderResponseStatus(lines: any[]): Promise<any[]> {
  const enriched: any[] = [];
  for (const line of lines) {
    const existingStatus = (line as { responseStatus?: OrderResponseStatus }).responseStatus;
    const existingReason = (line as { responseReason?: string | null }).responseReason;
    if (existingStatus) {
      enriched.push({ ...line, responseStatus: existingStatus, responseReason: existingReason ?? null });
      continue;
    }

    let responseStatus: OrderResponseStatus = "ACCEPTED";
    let responseReason: string | null = null;
    const hasIdentifier = Boolean(line.gtin || line.providerKey || line.supplierVariantId || line.supplierSku);
    if (!hasIdentifier) {
      responseStatus = "REJECTED";
      responseReason = "MISSING_PRODUCT_ID";
    } else {
      const variant = await resolveSupplierVariant(line);
      if (!variant) {
        responseStatus = "REJECTED";
        responseReason = "NO_OFFER";
      } else {
        const stock = Number(variant.stock ?? 0);
        const quantity = Number(line.quantity ?? 0);
        if (!Number.isFinite(stock) || stock < quantity || stock <= 0) {
          responseStatus = "OUT_OF_STOCK";
          responseReason = "NO_STOCK";
        }
      }
    }

    enriched.push({ ...line, responseStatus, responseReason });
  }

  return enriched;
}

function deriveOrderResponseStatus(lines: Array<{ responseStatus?: OrderResponseStatus }>): OrderResponseStatus {
  const statuses = lines.map((line) => line.responseStatus ?? "ACCEPTED");
  if (statuses.some((status) => status === "ACCEPTED")) return "ACCEPTED";
  if (statuses.some((status) => status === "OUT_OF_STOCK")) return "OUT_OF_STOCK";
  return "REJECTED";
}

async function buildOutgoingXml(docType: EdiDocType, order: any, lines: any[]) {
  if (docType === "ORDR") {
    const linesWithStatus = await attachOrderResponseStatus(lines);
    const status = deriveOrderResponseStatus(linesWithStatus);
    const arrivalByGtin = await buildArrivalByGtinForOrder(order);
    return buildOrderResponse(order, linesWithStatus, {
      supplierId: GALAXUS_SUPPLIER_ID,
      status,
      arrivalByGtin,
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

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function isStxLine(line: any): boolean {
  const supplierPid = String(line?.supplierPid ?? line?.providerKey ?? "").trim().toUpperCase();
  if (supplierPid.startsWith("STX_")) return true;
  if (supplierPid.startsWith("STX:")) return true;
  const variantId = String(line?.supplierVariantId ?? "").trim().toLowerCase();
  return variantId.startsWith("stx_");
}

async function buildArrivalByGtinForOrder(order: any) {
  const arrivalByGtin: Record<string, { start: Date; end: Date }> = {};
  const stxGtins = new Set<string>();
  for (const line of order.lines ?? []) {
    const gtin = String(line?.gtin ?? "").trim();
    if (!gtin) continue;
    if (isStxLine(line)) stxGtins.add(gtin);
  }

  if (stxGtins.size > 0) {
    const rows = await (prisma as any).stxPurchaseUnit.findMany({
      where: {
        galaxusOrderId: order.galaxusOrderId,
        gtin: { in: Array.from(stxGtins) },
        etaMin: { not: null },
        etaMax: { not: null },
      },
      select: { gtin: true, etaMin: true, etaMax: true, awb: true },
    });
    const byGtin = new Map<string, { min: Date; max: Date }>();
    for (const row of rows) {
      const gtin = String(row?.gtin ?? "").trim();
      if (!gtin || !row?.etaMin || !row?.etaMax) continue;
      const etaMin = new Date(row.etaMin);
      const etaMax = new Date(row.etaMax);
      if (!byGtin.has(gtin)) {
        byGtin.set(gtin, { min: etaMin, max: etaMax });
        continue;
      }
      const current = byGtin.get(gtin)!;
      if (etaMin.getTime() < current.min.getTime()) current.min = etaMin;
      if (etaMax.getTime() > current.max.getTime()) current.max = etaMax;
    }
    for (const [gtin, range] of byGtin.entries()) {
      arrivalByGtin[gtin] = {
        start: addDays(range.min, 3),
        end: addDays(range.max, 3),
      };
    }
  }

  const manualShipments = (order.shipments ?? []).filter(
    (shipment: any) => shipment.manualEtaMin || shipment.manualEtaMax
  );
  if (manualShipments.length > 0) {
    const shipmentIds = manualShipments.map((shipment: any) => shipment.id);
    const items = await (prisma as any).shipmentItem.findMany({
      where: { shipmentId: { in: shipmentIds } },
      select: { shipmentId: true, gtin14: true },
    });
    const etaByShipment = new Map<string, { start: Date; end: Date }>();
    for (const shipment of manualShipments) {
      const start = shipment.manualEtaMin ?? shipment.manualEtaMax ?? null;
      const end = shipment.manualEtaMax ?? shipment.manualEtaMin ?? null;
      if (!start || !end) continue;
      etaByShipment.set(String(shipment.id), {
        start: addDays(new Date(start), 3),
        end: addDays(new Date(end), 3),
      });
    }
    for (const item of items) {
      const gtin = String(item?.gtin14 ?? "").trim();
      if (!gtin || arrivalByGtin[gtin]) continue;
      const eta = etaByShipment.get(String(item.shipmentId));
      if (!eta) continue;
      arrivalByGtin[gtin] = eta;
    }
  }

  return arrivalByGtin;
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

export function parseOrderFromXml(xml: string, fallbackOrderId: string) {
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
    customerAddress2: buyer?.street2 ?? (buyer as any)?.department ?? undefined,
    customerPostalCode: buyer?.postalCode ?? "8005",
    customerCity: buyer?.city ?? "Zürich",
    customerCountry: buyer?.country ?? "Schweiz",
    customerCountryCode: buyer?.countryCode ?? undefined,
    customerEmail: buyer?.email ?? undefined,
    customerVatId: buyer?.vatId ?? undefined,
    recipientName: delivery?.name ?? undefined,
    recipientAddress1: delivery?.street ?? undefined,
    recipientAddress2:
      delivery?.street2 ??
      (delivery as any)?.department ??
      undefined,
    recipientPostalCode: delivery?.postalCode ?? undefined,
    recipientCity: delivery?.city ?? undefined,
    recipientCountry: delivery?.country ?? undefined,
    recipientCountryCode: delivery?.countryCode ?? undefined,
    recipientEmail: delivery?.email ?? undefined,
    recipientPhone: delivery?.phone ?? undefined,
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
  const itemListNode = getNestedNode(data, ["ORDER_ITEM_LIST"]);
  const listNodes = Array.isArray(itemListNode)
    ? itemListNode
    : itemListNode
    ? [itemListNode]
    : [];
  const items: any[] = [];
  for (const listNode of listNodes) {
    const listItems = listNode?.ORDER_ITEM;
    if (Array.isArray(listItems)) {
      items.push(...listItems);
    } else if (listItems) {
      items.push(listItems);
    }
  }

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
      supplierSku: supplierPid ?? buyerPid ?? undefined,
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
  const target = role.toLowerCase().trim();
  const extractText = (value: any): string | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (typeof value === "object") {
      if (value["#text"]) return String(value["#text"]);
      if (value.text) return String(value.text);
    }
    return null;
  };
  const normalizeRole = (value: any): string => (extractText(value) ?? "").toLowerCase().trim();
  const normalizePostalCode = (value: any): string | null => {
    const raw = extractText(value);
    if (!raw) return null;
    return raw.replace(/^CH[\s-]*/i, "").trim();
  };
  const normalizeKey = (value: string): string =>
    value
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "_")
      .replace(/-+/g, "_")
      .replace(/__+/g, "_");
  const deliveryRoleAliases = new Set<string>([
    "delivery",
    "delivery_party",
    "deliveryparty",
    "ship_to",
    "shipto",
    "ship_to_party",
    "consignee",
    "goods_recipient",
    "recipient",
    "deliver_to",
  ]);
  const roleMatches = (roleValueRaw: string, partyIds: Record<string, string>) => {
    const roleValue = normalizeKey(roleValueRaw);
    if (!roleValue) {
      // Some partner payloads omit PARTY_ROLE but still include typed PARTY_IDs.
      if (target === "delivery") {
        return Object.keys(partyIds ?? {}).some((key) => normalizeKey(key).includes("delivery"));
      }
      return false;
    }
    if (roleValue === target) return true;
    if (target === "delivery") {
      if (roleValue.includes("delivery")) return true;
      if (deliveryRoleAliases.has(roleValue)) return true;
      return false;
    }
    return roleValue.includes(target);
  };

  // OpenTrans orders typically store parties at ORDER_HEADER/ORDER_INFO/PARTIES.
  const partyGroups = [
    findAllByPath(data, ["ORDER_HEADER", "ORDER_INFO", "PARTIES", "PARTY"]),
    findAllByPath(data, ["PARTIES", "PARTY"]),
  ];

  for (const parties of partyGroups) {
    for (const party of parties) {
      const roleAttr = normalizeRole(party?.["@_PARTY_ROLE"] ?? null);
      const roleNode = normalizeRole(party?.PARTY_ROLE ?? null);
      const roleValue = roleAttr || roleNode;
      const ids = extractPartyIds(party.PARTY_ID);
      const matches = roleMatches(roleValue, ids);
      if (!matches) continue;

      const address = party.ADDRESS ?? {};
      const contact = address.CONTACT_DETAILS ?? {};
      const name = extractText(address.NAME) ?? [contact.FIRST_NAME, contact.CONTACT_NAME].filter(Boolean).join(" ") ?? null;
      const name2 = extractText(address.NAME2) ?? null;
      const department = extractText((address as any).DEPARTMENT) ?? null;
      const combinedName = name2 ? [name, name2].filter(Boolean).join(", ") : name;

      return {
        name: combinedName,
        street: extractText(address.STREET) ?? null,
        street2: extractText(address.STREET2) ?? null,
        department,
        postalCode: normalizePostalCode(address.ZIP),
        city: extractText(address.CITY) ?? null,
        country: extractText(address.COUNTRY) ?? null,
        countryCode: extractText(address.COUNTRY_CODED) ?? extractText((address as any).COUNTRY_CODE) ?? null,
        vatId: extractText(address.VAT_ID) ?? null,
        email: extractText(address.EMAIL) ?? null,
        phone: extractText(address.PHONE) ?? null,
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

