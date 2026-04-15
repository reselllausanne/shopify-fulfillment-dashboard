import "server-only";

import { prisma } from "@/app/lib/prisma";
import { XMLParser } from "fast-xml-parser";
import { buildDispatchNotification } from "@/galaxus/edi/documents";
import { upsertEdiFile } from "@/galaxus/edi/ediFiles";
import {
  assertSftpConfig,
  GALAXUS_SFTP_HOST,
  GALAXUS_SFTP_OUT_DIR,
  GALAXUS_SFTP_PASSWORD,
  GALAXUS_SFTP_PORT,
  GALAXUS_SFTP_USER,
  GALAXUS_SUPPLIER_ID,
} from "@/galaxus/edi/config";
import { uploadTempThenRename, withSftp } from "@/galaxus/edi/sftpClient";
import { GALAXUS_SHIPMENT_CARRIER_ALLOWLIST } from "@/galaxus/config";
import { getStxLinkStatusForShipment } from "@/galaxus/stx/purchaseUnits";


type UploadResult = {
  shipmentId: string;
  status: "uploaded" | "skipped" | "error";
  filename?: string;
  message?: string;
  httpStatus?: number;
  ediFileId?: string;
};

const ordrParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
});

function isUnknownCancelledAtArg(error: any): boolean {
  const message = String(error?.message ?? "");
  return message.includes("Unknown argument `cancelledAt`");
}

function extractText(value: any): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    if (value["#text"]) return String(value["#text"]);
    if (value.text) return String(value.text);
  }
  return null;
}

function normalizePostalCode(value: any): string | null {
  const raw = extractText(value);
  if (!raw) return null;
  return raw.replace(/^CH[\s-]*/i, "").trim();
}

function findDeliveryParty(root: any) {
  const partiesNode =
    root?.ORDER_HEADER?.ORDER_INFO?.PARTIES?.PARTY ?? root?.PARTIES?.PARTY ?? null;
  const parties = Array.isArray(partiesNode) ? partiesNode : partiesNode ? [partiesNode] : [];
  for (const party of parties) {
    const roleAttr = extractText(party?.["@_PARTY_ROLE"]) ?? "";
    const roleNode = extractText(party?.PARTY_ROLE) ?? "";
    const role = String(roleAttr || roleNode).toLowerCase().trim();
    if (role !== "delivery") continue;
    const address = party?.ADDRESS ?? {};
    const delivery = {
      name: extractText(address.NAME) ?? null,
      name2: extractText(address.NAME2) ?? null,
      department: extractText(address.DEPARTMENT) ?? null,
      street: extractText(address.STREET) ?? null,
      street2: extractText(address.STREET2) ?? null,
      postalCode: normalizePostalCode(address.ZIP),
      city: extractText(address.CITY) ?? null,
      country: extractText(address.COUNTRY) ?? null,
      countryCode: extractText(address.COUNTRY_CODED) ?? extractText(address.COUNTRY_CODE) ?? null,
    };
    if (!delivery.street || !delivery.postalCode || !delivery.city) return null;
    return delivery;
  }
  return null;
}

async function refreshOrderRecipientFromOrdp(order: any) {
  const edi = await (prisma as any).galaxusEdiFile.findFirst({
    where: {
      direction: "IN",
      docType: "ORDP",
      OR: [{ orderRef: order.galaxusOrderId }, { filename: { contains: order.galaxusOrderId } }],
    },
    orderBy: { createdAt: "desc" },
    select: { payloadJson: true },
  });
  const rawXml = edi?.payloadJson?.rawXml ?? null;
  if (!rawXml || typeof rawXml !== "string") return order;
  let data: any;
  try {
    data = ordrParser.parse(rawXml);
  } catch {
    return order;
  }
  const root = data?.ORDER ?? data;
  const delivery = findDeliveryParty(root);
  if (!delivery) return order;

  const recipientAddress2 =
    delivery.street2 ?? delivery.department ?? delivery.name2 ?? null;
  const currentStreet = String(order?.recipientAddress1 ?? "").trim();
  const currentZip = String(order?.recipientPostalCode ?? "").trim();
  const currentCity = String(order?.recipientCity ?? "").trim();
  if (
    currentStreet === delivery.street &&
    currentZip === delivery.postalCode &&
    currentCity === delivery.city &&
    String(order?.recipientAddress2 ?? "").trim() === String(recipientAddress2 ?? "").trim()
  ) {
    return order;
  }

  return prisma.galaxusOrder.update({
    where: { id: order.id },
    data: {
      recipientName: delivery.name ?? "Digitec Galaxus AG",
      recipientAddress1: delivery.street,
      recipientAddress2,
      recipientPostalCode: delivery.postalCode,
      recipientCity: delivery.city,
      recipientCountry: delivery.country ?? "Schweiz",
      recipientCountryCode: delivery.countryCode ?? "CH",
    },
  });
}

async function resolveDispatchOrdersForShipment(shipment: any) {
  const prismaAny = prisma as any;
  const rawItems = (await prismaAny.shipmentItem.findMany({
    where: { shipmentId: shipment.id },
    include: { order: { include: { lines: true } } },
  })) as any[];

  const orderMap = new Map<string, any>();
  orderMap.set(String(shipment.order.id), shipment.order);

  for (const it of rawItems) {
    const oid = it.orderId ? String(it.orderId) : String(shipment.orderId);
    if (!oid) continue;
    if (!orderMap.has(oid)) {
      let ord = it.order;
      if (!ord?.lines?.length) {
        ord = await prismaAny.galaxusOrder.findUnique({ where: { id: oid }, include: { lines: true } });
      }
      if (ord) orderMap.set(oid, await refreshOrderRecipientFromOrdp(ord));
    }
  }

  const ordersForMeta = Array.from(orderMap.values());
  const dispatchItems = rawItems.map((it) => {
    const oid = it.orderId ? String(it.orderId) : String(shipment.orderId);
    const src = orderMap.get(oid);
    const ref = String(src?.galaxusOrderId ?? shipment.order.galaxusOrderId);
    return {
      supplierPid: it.supplierPid,
      gtin14: it.gtin14,
      buyerPid: it.buyerPid ?? null,
      quantity: it.quantity,
      orderReferenceId: ref,
      galaxusOrderId: ref,
    };
  });

  return { ordersForMeta, dispatchItems, rawItems };
}

async function loadStockxMatchesForOrders(orders: any[]) {
  const ids = Array.from(new Set(orders.map((o) => o.id).filter(Boolean)));
  const refs = Array.from(new Set(orders.map((o) => o.galaxusOrderId).filter(Boolean)));
  if (ids.length === 0 && refs.length === 0) return [];
  return (await (prisma as any).galaxusStockxMatch
    .findMany({
      where: {
        OR: [{ galaxusOrderId: { in: ids } }, { galaxusOrderRef: { in: refs } }],
      },
      select: { id: true, stockxOrderNumber: true },
    })
    .catch(() => [])) as any[];
}

export async function uploadDelrForShipment(
  shipmentId: string,
  options: { force?: boolean } = {}
): Promise<UploadResult> {
  assertSftpConfig();

  const prismaAny = prisma as any;
  const shipment = (await prismaAny.shipment.findUnique({
    where: { id: shipmentId },
    include: { order: { include: { lines: true } } },
  })) as any;

  if (!shipment || !shipment.order) {
    return { shipmentId, status: "error", message: "Shipment not found" };
  }

  shipment.order = await refreshOrderRecipientFromOrdp(shipment.order);

  const { ordersForMeta, dispatchItems, rawItems } = await resolveDispatchOrdersForShipment(shipment);

  if (!shipment.order.ordrSentAt && !options.force) {
    return { shipmentId, status: "error", message: "ORDR not sent yet" };
  }

  const providerKey = String(shipment.providerKey ?? "").toUpperCase();
  const isManual = String(shipment.status ?? "").toUpperCase() === "MANUAL";
  const isStxShipment = providerKey === "STX";

  const stxStatus = isStxShipment ? await getStxLinkStatusForShipment(shipment.id).catch(() => null) : null;
  const stxMatches = await loadStockxMatchesForOrders(ordersForMeta);
  const hasStockxMatch =
    (stxMatches ?? []).some((row: any) => String(row?.stockxOrderNumber ?? "").trim().length > 0);
  const isDirect = String(shipment.order?.deliveryType ?? "").toLowerCase() === "direct_delivery";
  const allowDelrByMatch = Boolean(shipment.order?.ordrSentAt) && hasStockxMatch;
  if (isDirect && !options.force && !allowDelrByMatch) {
    return {
      shipmentId,
      status: "error",
      httpStatus: 409,
      message: "StockX order not linked yet",
    };
  }
  if (!isDirect && isStxShipment && stxStatus?.hasStxItems && !options.force && !isManual && !allowDelrByMatch) {
    if (!stxStatus.allLinked) {
      return {
        shipmentId,
        status: "error",
        httpStatus: 409,
        message: "StockX units are not fully linked yet",
      };
    }
    if (!stxStatus.allEtaPresent) {
      return {
        shipmentId,
        status: "error",
        httpStatus: 409,
        message: "StockX linked units are missing ETA bounds",
      };
    }
  }

  if (!isDirect && !isStxShipment && !allowDelrByMatch) {
    const placedOnSupplier = await hasPlacedSupplierOrder(shipment);
    if (!placedOnSupplier && !options.force && !isManual) {
      return {
        shipmentId,
        status: "error",
        httpStatus: 409,
        message: "Supplier order not placed yet",
      };
    }
  }

  const existingDelr = await findExistingDelr(shipment);
  const shipped = resolveShipmentShipped(shipment);
  if (!shipped) {
    return {
      shipmentId,
      status: "error",
      httpStatus: 409,
      message: "Shipment not marked as shipped",
    };
  }

  const trackingNumber = String(shipment?.trackingNumber ?? "").trim();
  if (!trackingNumber) {
    return {
      shipmentId,
      status: "error",
      httpStatus: 409,
      message: "Missing tracking number",
    };
  }

  if (!shipment.packageId && !isDirect) {
    return {
      shipmentId,
      status: "error",
      httpStatus: 400,
      message: "Missing SSCC package id",
    };
  }

  const items = dispatchItems.map((it) => ({
    supplierPid: it.supplierPid,
    gtin14: it.gtin14,
    quantity: it.quantity,
  }));

  if (shipment.delrSentAt) {
    return {
      shipmentId,
      status: "skipped",
      httpStatus: 409,
      filename: shipment.delrFileName ?? undefined,
      message: "already sent",
    };
  }

  try {
    validateShipment({
      dispatchNotificationId: shipment.dispatchNotificationId ?? null,
      packageId: shipment.packageId ?? null,
      items,
      requirePackageId: !isDirect,
    });
    const carrier = resolveCarrier(shipment.carrierFinal ?? null);
    if (!carrier) {
      return {
        shipmentId,
        status: "error",
        httpStatus: 409,
        message: "Missing shipment carrier",
      };
    }
    const arrivalByGtin = await buildArrivalByGtinForShipment({
      shipment,
      items: dispatchItems,
      isStxShipment,
    });
    const dispatch = buildDispatchNotification(
      shipment.order,
      ordersForMeta,
      { ...shipment, carrierFinal: carrier },
      dispatchItems.map(({ supplierPid, gtin14, buyerPid, quantity, orderReferenceId }) => ({
        supplierPid,
        gtin14,
        buyerPid,
        quantity,
        orderReferenceId,
      })),
      { supplierId: GALAXUS_SUPPLIER_ID, arrivalByGtin }
    );

    await withSftp(
      {
        host: GALAXUS_SFTP_HOST,
        port: GALAXUS_SFTP_PORT,
        username: GALAXUS_SFTP_USER,
        password: GALAXUS_SFTP_PASSWORD,
      },
      async (client) => {
        if (existingDelr?.filename) {
          const dir = GALAXUS_SFTP_OUT_DIR.replace(/\/$/, "");
          const path = `${dir}/${existingDelr.filename}`;
          await client.delete(path).catch(() => undefined);
        }
        await uploadTempThenRename(client, GALAXUS_SFTP_OUT_DIR, dispatch.filename, dispatch.content);
      }
    );

    const now = new Date();
    const galaxusShippedAt = shipment.galaxusShippedAt ?? now;
    await prismaAny.shipment.update({
      where: { id: shipment.id },
      data: {
        status: "FULFILLED",
        delrFileName: dispatch.filename,
        delrSentAt: now,
        delrStatus: "UPLOADED",
        delrError: null,
        galaxusShippedAt,
      },
    });
    const shippedAt = now;
    const uniqueItemKeys = new Set<string>();
    for (const item of rawItems ?? []) {
      const orderId = item?.orderId ? String(item.orderId) : shipment.orderId ? String(shipment.orderId) : "";
      const supplierPid = String(item?.supplierPid ?? "").trim();
      const gtin = String(item?.gtin14 ?? "").trim();
      if (!orderId || !supplierPid || !gtin) continue;
      const key = `${orderId}|${supplierPid}|${gtin}`;
      if (uniqueItemKeys.has(key)) continue;
      uniqueItemKeys.add(key);
      await prismaAny.galaxusOrderLine.updateMany({
        where: {
          orderId,
          supplierPid,
          gtin,
          warehouseMarkedShippedAt: null,
        },
        data: { warehouseMarkedShippedAt: shippedAt },
      });
    }
    if (shipment.orderId) {
      await prismaAny.orderStatusEvent.create({
        data: {
          orderId: shipment.orderId,
          source: "DELR",
          type: "FULFILLED",
          payloadJson: {
            shipmentId: shipment.id,
            dispatchFilename: dispatch.filename,
            sentAt: now.toISOString(),
          },
        },
      }).catch(() => undefined);
    }

    await upsertEdiFile({
      filename: dispatch.filename,
      direction: "OUT",
      docType: "DELR",
      orderId: shipment.orderId ?? undefined,
      orderRef: shipment.order?.galaxusOrderId ?? undefined,
      status: "uploaded",
      shipmentId: shipment.id,
      payloadJson: { shipmentId: shipment.id },
    });

    // Auto-invoicing removed — invoices are sent manually from the dedicated invoice page.

    return {
      shipmentId,
      status: "uploaded",
      filename: dispatch.filename,
    };
  } catch (error: any) {
    await prismaAny.shipment.update({
      where: { id: shipment.id },
      data: {
        delrStatus: "ERROR",
        delrError: error?.message ?? "DELR upload failed",
      },
    });

    return {
      shipmentId,
      status: "error",
      message: error?.message ?? "DELR upload failed",
    };
  }
}

export async function buildDelrXmlForShipment(
  shipmentId: string,
  options: { force?: boolean } = {}
): Promise<{ shipmentId: string; filename: string; content: string }> {
  assertSftpConfig();
  const prismaAny = prisma as any;
  const shipment = (await prismaAny.shipment.findUnique({
    where: { id: shipmentId },
    include: { order: { include: { lines: true } } },
  })) as any;

  if (!shipment || !shipment.order) {
    throw new Error("Shipment not found");
  }

  shipment.order = await refreshOrderRecipientFromOrdp(shipment.order);

  if (!shipment.order.ordrSentAt && !options.force) {
    throw new Error("ORDR not sent yet");
  }

  const { ordersForMeta, dispatchItems: dispatchItemsForStx } = await resolveDispatchOrdersForShipment(shipment);

  const stxStatus = await getStxLinkStatusForShipment(shipment.id).catch(() => null);
  const stxMatches = await loadStockxMatchesForOrders(ordersForMeta);
  const hasStockxMatch =
    (stxMatches ?? []).some((row: any) => String(row?.stockxOrderNumber ?? "").trim().length > 0);
  if (stxStatus?.hasStxItems && !options.force && !hasStockxMatch) {
    if (!stxStatus.allLinked) throw new Error("StockX units are not fully linked yet");
    if (!stxStatus.allEtaPresent) throw new Error("StockX linked units are missing ETA bounds");
  }
  if (!stxStatus?.hasStxItems && !hasStockxMatch) {
    const placedOnSupplier = await hasPlacedSupplierOrder(shipment);
    if (!placedOnSupplier && !options.force) {
      throw new Error("Supplier order not placed yet");
    }
  }

  const shipped = resolveShipmentShipped(shipment);
  if (!shipped && !options.force) {
    throw new Error("Shipment not marked as shipped");
  }

  const trackingNumber = String(shipment?.trackingNumber ?? "").trim();
  if (!trackingNumber && !options.force) {
    throw new Error("Missing tracking number");
  }

  if (!shipment.packageId) {
    throw new Error("Missing SSCC package id");
  }

  const dispatchItems = dispatchItemsForStx;

  const items = dispatchItems.map((it) => ({
    supplierPid: it.supplierPid,
    gtin14: it.gtin14,
    quantity: it.quantity,
  }));

  const isDirect = String(shipment.order?.deliveryType ?? "").toLowerCase() === "direct_delivery";
  validateShipment({
    dispatchNotificationId: shipment.dispatchNotificationId ?? null,
    packageId: shipment.packageId ?? null,
    items,
    requirePackageId: !isDirect,
  });

  const carrier = resolveCarrier(shipment.carrierFinal ?? null);
  if (!carrier && !options.force) {
    throw new Error("Missing shipment carrier");
  }
  const arrivalByGtin = await buildArrivalByGtinForShipment({
    shipment,
    items: dispatchItems,
    isStxShipment: (stxStatus?.hasStxItems ?? false) || hasStockxMatch,
  });

  const dispatch = buildDispatchNotification(
    shipment.order,
    ordersForMeta,
    { ...shipment, carrierFinal: carrier, shippedAt: shipment.shippedAt ?? (options.force ? new Date() : null) },
    dispatchItems.map(({ supplierPid, gtin14, buyerPid, quantity, orderReferenceId }) => ({
      supplierPid,
      gtin14,
      buyerPid,
      quantity,
      orderReferenceId,
    })),
    { supplierId: GALAXUS_SUPPLIER_ID, arrivalByGtin }
  );

  return { shipmentId: shipment.id, filename: dispatch.filename, content: dispatch.content };
}

/**
 * Roll back a FULFILLED/UPLOADED shipment whose DELR was deleted from the SFTP
 * before Galaxus could ingest it.  Resets all DELR & fulfillment flags so the
 * shipment can be deleted and re-created with the correct items.
 */
export async function resetDelrForShipment(
  shipmentId: string
): Promise<UploadResult & { linesReset?: number }> {
  const prismaAny = prisma as any;

  const shipment = await prismaAny.shipment.findUnique({
    where: { id: shipmentId },
    include: { items: true },
  });

  if (!shipment) {
    return { shipmentId, status: "error", httpStatus: 404, message: "Shipment not found" };
  }

  const delrStatus = String(shipment.delrStatus ?? "").toUpperCase();
  const status = String(shipment.status ?? "").toUpperCase();

  // Only allow reset when the shipment was FULFILLED/UPLOADED (but not yet confirmed ingested).
  // If it was never sent at all there's nothing to reset.
  if (!shipment.delrSentAt && delrStatus !== "UPLOADED" && status !== "FULFILLED") {
    return {
      shipmentId,
      status: "error",
      httpStatus: 409,
      message: "Shipment is not in a FULFILLED/UPLOADED state — nothing to reset",
    };
  }

  // 1. Clear shipment DELR & fulfillment fields.
  await prismaAny.shipment.update({
    where: { id: shipment.id },
    data: {
      status: "MANUAL",
      delrSentAt: null,
      delrFileName: null,
      delrStatus: "PENDING",
      delrError: null,
      galaxusShippedAt: null,
    },
  });

  // 2. Un-mark order lines that were stamped by this DELR upload.
  //    We clear warehouseMarkedShippedAt for every (order, supplierPid, gtin) combo
  //    covered by this shipment's items.
  const uniqueItemKeys = new Set<string>();
  let linesReset = 0;
  for (const item of (shipment.items ?? []) as any[]) {
    const orderId = item?.orderId ? String(item.orderId) : shipment.orderId ? String(shipment.orderId) : "";
    const supplierPid = String(item?.supplierPid ?? "").trim();
    const gtin = String(item?.gtin14 ?? "").trim();
    if (!orderId || !supplierPid || !gtin) continue;
    const key = `${orderId}|${supplierPid}|${gtin}`;
    if (uniqueItemKeys.has(key)) continue;
    uniqueItemKeys.add(key);
    const updated = await prismaAny.galaxusOrderLine.updateMany({
      where: { orderId, supplierPid, gtin, warehouseMarkedShippedAt: { not: null } },
      data: { warehouseMarkedShippedAt: null },
    });
    linesReset += updated?.count ?? 0;
  }

  // 3. Soft-remove the outgoing EDI file record if present.
  if (shipment.delrFileName) {
    await prismaAny.galaxusEdiFile
      .updateMany({
        where: { shipmentId: shipment.id, direction: "OUT", docType: "DELR" },
        data: { status: "voided" },
      })
      .catch(() => undefined);
  }

  console.info("[galaxus][reset-delr] done", { shipmentId, linesReset });

  return {
    shipmentId,
    status: "uploaded", // re-using "uploaded" as generic "ok" from the UploadResult type
    message: `Reset OK — ${linesReset} order line(s) un-marked. Shipment is now MANUAL/PENDING and can be deleted.`,
    linesReset,
  };
}

export async function uploadDelrForOrder(
  orderId: string,
  options: { force?: boolean } = {}
): Promise<UploadResult[]> {
  const shipments = await prisma.shipment.findMany({
    where: { orderId },
    orderBy: { createdAt: "asc" },
  });

  const results: UploadResult[] = [];
  for (const shipment of shipments) {
    results.push(await uploadDelrForShipment(shipment.id, options));
  }
  return results;
}

function validateShipment(shipment: {
  dispatchNotificationId: string | null;
  packageId: string | null;
  items: { supplierPid: string; gtin14: string; quantity: number }[];
  requirePackageId?: boolean;
}) {
  if (!shipment.dispatchNotificationId) {
    throw new Error("Missing dispatch notification id");
  }
  const requirePackageId = shipment.requirePackageId ?? true;
  if (requirePackageId && !shipment.packageId) {
    throw new Error("Missing SSCC package id");
  }
  if (!shipment.items.length) {
    throw new Error("Shipment has no items");
  }
  for (const item of shipment.items) {
    if (!item.supplierPid) throw new Error("Missing supplier PID in shipment item");
    if (!item.gtin14) throw new Error("Missing GTIN14 in shipment item");
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new Error("Invalid shipment item quantity");
    }
  }
}

function resolveCarrier(value: string | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const allowlist = GALAXUS_SHIPMENT_CARRIER_ALLOWLIST.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (allowlist.length === 0) {
    return raw;
  }
  const normalize = (input: string) => input.toLowerCase().replace(/\s+/g, "");
  const found = allowlist.find((item) => normalize(item) === normalize(raw));
  return found ?? null;
}

function resolveShipmentShipped(shipment: any): boolean {
  const status = String(shipment?.status ?? "").toUpperCase();
  if (status === "MANUAL") return true;
  if (shipment.shippedAt) return true;
  if (shipment.trackingNumber && String(shipment.trackingNumber).trim().length > 0) return true;
  return false;
}

async function findExistingDelr(shipment: any) {
  return (prisma as any).galaxusEdiFile.findFirst({
    where: { shipmentId: shipment.id, direction: "OUT", docType: "DELR" },
  });
}

async function hasPlacedSupplierOrder(shipment: any): Promise<boolean> {
  const ref = String(shipment?.supplierOrderRef ?? "").trim();
  if (ref.length > 0) return true;

  const status = String(shipment?.status ?? "").toUpperCase();
  if (status === "PLACED" || status === "ASSIGNED") return true;

  const order = await (prisma as any).supplierOrder.findUnique({
    where: { shipmentId: shipment.id },
    select: { supplierOrderRef: true, status: true },
  });
  if (!order) return false;
  const orderRef = String(order?.supplierOrderRef ?? "").trim();
  const orderStatus = String(order?.status ?? "").toUpperCase();
  if (orderRef.startsWith("pending-")) return false;
  if (orderStatus === "ERROR" || orderStatus === "CREATING") return false;
  return orderRef.length > 0 || orderStatus === "CREATED";
}

function midpointDate(min: Date, max: Date) {
  return new Date(Math.floor((min.getTime() + max.getTime()) / 2));
}

function addBusinessDays(base: Date, days: number) {
  const result = new Date(base);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) {
      added += 1;
    }
  }
  return result;
}

function addDays(base: Date, days: number) {
  const result = new Date(base);
  result.setDate(result.getDate() + days);
  return result;
}

async function buildArrivalByGtinForShipment(params: {
  shipment: any;
  items: Array<{
    supplierPid: string;
    gtin14: string;
    quantity: number;
    galaxusOrderId?: string | null;
  }>;
  isStxShipment: boolean;
}) {
  const { shipment, items, isStxShipment } = params;
  const arrivalByGtin: Record<string, { start: Date; end: Date }> = {};
  const gtins = Array.from(
    new Set(items.map((item) => String(item?.gtin14 ?? "").trim()).filter((gtin) => gtin.length > 0))
  );

  if (isStxShipment && gtins.length > 0) {
    const orderIds = Array.from(
      new Set(
        items
          .map((i) => String(i.galaxusOrderId ?? shipment.order.galaxusOrderId ?? "").trim())
          .filter(Boolean)
      )
    );
    let rows: Array<{ gtin: string; etaMin: Date; etaMax: Date; awb: string | null }> = [];
    try {
      rows = await (prisma as any).stxPurchaseUnit.findMany({
        where: {
          galaxusOrderId: { in: orderIds },
          gtin: { in: gtins },
          cancelledAt: null,
          etaMin: { not: null },
          etaMax: { not: null },
        },
        select: { gtin: true, etaMin: true, etaMax: true, awb: true },
      });
    } catch (error: any) {
      if (!isUnknownCancelledAtArg(error)) throw error;
      rows = await (prisma as any).stxPurchaseUnit.findMany({
        where: {
          galaxusOrderId: { in: orderIds },
          gtin: { in: gtins },
          etaMin: { not: null },
          etaMax: { not: null },
        },
        select: { gtin: true, etaMin: true, etaMax: true, awb: true },
      });
    }
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
        start: addDays(range.min, 1),
        end: addDays(range.max, 1),
      };
    }
  } else if (shipment.manualEtaMin || shipment.manualEtaMax) {
    const start = shipment.manualEtaMin ?? shipment.manualEtaMax ?? null;
    const end = shipment.manualEtaMax ?? shipment.manualEtaMin ?? null;
    if (start && end) {
      const range = { start: addDays(new Date(start), 3), end: addDays(new Date(end), 3) };
      for (const gtin of gtins) {
        arrivalByGtin[gtin] = range;
      }
    }
  }

  return arrivalByGtin;
}

async function buildStxArrivalByGtin(params: {
  galaxusOrderId: string;
  buckets: Array<{ gtin: string; needed: number }>;
}) {
  const out: Record<string, { start: Date; end: Date }> = {};
  for (const bucket of params.buckets) {
    const gtin = String(bucket?.gtin ?? "").trim();
    const needed = Math.max(0, Number(bucket?.needed ?? 0));
    if (!gtin || needed <= 0) continue;
    let rows: Array<{ etaMin: Date; etaMax: Date }> = [];
    try {
      rows = await (prisma as any).stxPurchaseUnit.findMany({
        where: {
          galaxusOrderId: params.galaxusOrderId,
          gtin,
          cancelledAt: null,
          stockxOrderId: { not: null },
          etaMin: { not: null },
          etaMax: { not: null },
        },
        orderBy: { createdAt: "asc" },
        take: needed,
        select: { etaMin: true, etaMax: true },
      });
    } catch (error: any) {
      if (!isUnknownCancelledAtArg(error)) throw error;
      rows = await (prisma as any).stxPurchaseUnit.findMany({
        where: {
          galaxusOrderId: params.galaxusOrderId,
          gtin,
          stockxOrderId: { not: null },
          etaMin: { not: null },
          etaMax: { not: null },
        },
        orderBy: { createdAt: "asc" },
        take: needed,
        select: { etaMin: true, etaMax: true },
      });
    }
    if (!rows.length) continue;
    let latestMidpoint: Date | null = null;
    for (const row of rows) {
      const etaMin = row.etaMin ? new Date(row.etaMin) : null;
      const etaMax = row.etaMax ? new Date(row.etaMax) : null;
      if (!etaMin || !etaMax) continue;
      const mid = midpointDate(etaMin, etaMax);
      if (!latestMidpoint || mid.getTime() > latestMidpoint.getTime()) {
        latestMidpoint = mid;
      }
    }
    if (!latestMidpoint) continue;
    const estimatedDeliveryForDelr = addBusinessDays(latestMidpoint, 1);
    out[gtin] = {
      start: estimatedDeliveryForDelr,
      end: estimatedDeliveryForDelr,
    };
  }
  return out;
}
