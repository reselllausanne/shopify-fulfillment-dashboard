import "server-only";

import { prisma } from "@/app/lib/prisma";
import { requestSwissPostLabel } from "@/lib/swissPost";
import { getStorageAdapter } from "@/galaxus/storage/storage";
import { DocumentType } from "@prisma/client";
import { uploadDelrForShipment } from "@/galaxus/warehouse/delr";
import { sendOutgoingEdi } from "@/galaxus/edi/service";

function getLabelFileExtension(format?: string) {
  const cleaned = String(format || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["pdf", "jpg", "jpeg", "png", "gif", "svg"].includes(cleaned)) {
    return cleaned;
  }
  return "pdf";
}

function extractLabelPayload(response: any) {
  if (!response) return null;
  const item = Array.isArray(response.item) ? response.item[0] : response.item;
  if (!item) return null;
  const labelEntry = Array.isArray(item.label) ? item.label[0] : item.label;
  if (!labelEntry) return null;
  const base64 =
    typeof labelEntry === "string"
      ? labelEntry
      : labelEntry?.content ?? labelEntry?.data ?? labelEntry?.value;
  if (!base64) return null;
  const format =
    labelEntry?.format ||
    labelEntry?.type ||
    labelEntry?.fileType ||
    labelEntry?.imageFileType ||
    "pdf";
  return {
    base64,
    extension: getLabelFileExtension(format),
  };
}

export function extractSwissPostTracking(response: any): string | null {
  if (!response) return null;
  const item = Array.isArray(response.item) ? response.item[0] : response.item;
  if (!item) return null;
  const direct =
    item?.identCode ||
    item?.identcode ||
    item?.barcode ||
    (Array.isArray(item?.barcodes) ? item.barcodes[0] : null);
  if (direct) return String(direct).trim();
  const labelEntry = Array.isArray(item?.label) ? item.label[0] : item.label;
  const nested =
    labelEntry?.identCode ||
    labelEntry?.identcode ||
    labelEntry?.barcode ||
    (Array.isArray(labelEntry?.barcodes) ? labelEntry.barcodes[0] : null);
  if (nested) return String(nested).trim();
  return null;
}

function normalizeCountryCode(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  const lower = raw.toLowerCase();
  if (["schweiz", "suisse", "svizzera", "switzerland", "swiss"].includes(lower)) return "CH";
  if (["deutschland", "germany"].includes(lower)) return "DE";
  if (["france"].includes(lower)) return "FR";
  if (["italy", "italia"].includes(lower)) return "IT";
  if (["austria", "österreich", "osterreich"].includes(lower)) return "AT";
  return null;
}

function normalizePostalCode(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return raw.replace(/^CH[\s-]*/i, "").trim();
}

function normalizeSwissPostText(value: unknown): string {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeStreetForSwissPost(baseStreet: unknown, extraStreet?: unknown): string {
  const base = normalizeSwissPostText(baseStreet);
  const extra = normalizeSwissPostText(extraStreet);
  let street = base;

  if (!street && extra) {
    street = extra;
  }

  // Some marketplaces append department/notes after a comma. Swiss Post street pattern rejects this.
  if (street.includes(",")) {
    street = street.split(",")[0]?.trim() ?? street;
  }

  if (!/\d/.test(street) && extra && /\d/.test(extra)) {
    street = `${street} ${extra}`.trim();
  }

  street = street
    .replace(/[^\p{L}\p{N}\s.\-/'’]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return street;
}

function buildSwissPostRecipient(
  values: {
    name?: unknown;
    address1?: unknown;
    address2?: unknown;
    postalCode?: unknown;
    city?: unknown;
    countryCodeOrName?: unknown;
    email?: unknown;
  }
) {
  const country = normalizeCountryCode(values.countryCodeOrName) ?? "CH";
  const zip = normalizePostalCode(values.postalCode) ?? "";
  const name1 = normalizeSwissPostText(values.name) || "";
  const baseStreet = normalizeSwissPostText(values.address1);
  const extraStreet = normalizeSwissPostText(values.address2);
  const street = sanitizeStreetForSwissPost(baseStreet, extraStreet);
  const name2 = extraStreet && extraStreet !== street ? extraStreet : null;

  return {
    name1,
    firstName: null,
    name2,
    street,
    zip,
    city: normalizeSwissPostText(values.city) || "",
    country,
    phone: null,
    email: normalizeSwissPostText(values.email) || null,
  };
}

function buildRecipient(order: any) {
  const hasRecipient =
    Boolean(order.recipientName) ||
    Boolean(order.recipientAddress1) ||
    Boolean(order.recipientPostalCode) ||
    Boolean(order.recipientCity) ||
    Boolean(order.recipientCountry);
  if (hasRecipient) {
    return buildSwissPostRecipient({
      name: order.recipientName,
      address1: order.recipientAddress1,
      address2: order.recipientAddress2,
      postalCode: order.recipientPostalCode,
      city: order.recipientCity,
      countryCodeOrName: order.recipientCountryCode ?? order.recipientCountry,
      email: order.recipientEmail ?? order.customerEmail ?? null,
    });
  }
  return buildSwissPostRecipient({
    name: order.customerName,
    address1: order.customerAddress1,
    address2: order.customerAddress2,
    postalCode: order.customerPostalCode,
    city: order.customerCity,
    countryCodeOrName: order.customerCountryCode ?? order.customerCountry,
    email: order.customerEmail ?? null,
  });
}

function buildSwissPostPayload(order: any, trackingNumber: string) {
  const language = process.env.SWISS_POST_LANGUAGE || "DE";
  const frankingLicense = process.env.SWISS_POST_FRANKING_LICENSE || "";
  const ppFranking = process.env.SWISS_POST_PP_FRANKING === "1";
  const imageResolution = Number(process.env.SWISS_POST_IMAGE_RESOLUTION || 300);
  const notificationServiceCode = Number(process.env.SWISS_POST_NOTIFICATION_SERVICE || 0);
  const allowedNotifications = [1, 2, 4, 32, 64, 128, 256];
  const notificationService =
    allowedNotifications.includes(notificationServiceCode) && notificationServiceCode > 0
      ? String(notificationServiceCode)
      : null;
  const basePrzlValues = (process.env.SWISS_POST_PRZL || "ECO")
    .split(",")
    .map((value: string) => value.trim())
    .filter(Boolean);
  const przlValues = basePrzlValues.length ? basePrzlValues : ["ECO"];

  const sender = {
    name1: process.env.SWISS_POST_CUSTOMER_NAME1 || "",
    name2: process.env.SWISS_POST_CUSTOMER_NAME2 || "",
    street: process.env.SWISS_POST_CUSTOMER_STREET || "",
    zip: process.env.SWISS_POST_CUSTOMER_ZIP || "",
    city: process.env.SWISS_POST_CUSTOMER_CITY || "",
    country: process.env.SWISS_POST_CUSTOMER_COUNTRY || "CH",
    domicilePostOffice: process.env.SWISS_POST_CUSTOMER_DOMICILE_PO || "",
    pobox: process.env.SWISS_POST_CUSTOMER_POBOX || "",
    logo: process.env.SWISS_POST_CUSTOMER_LOGO || "",
    logoFormat: process.env.SWISS_POST_CUSTOMER_LOGO_FORMAT || "PNG",
    logoRotation: Number(process.env.SWISS_POST_CUSTOMER_LOGO_ROTATION || 0),
    logoAspectRatio: process.env.SWISS_POST_CUSTOMER_LOGO_ASPECT || "EXPAND",
    logoHorizontalAlign: process.env.SWISS_POST_CUSTOMER_LOGO_HALIGN || "WITH_CONTENT",
    logoVerticalAlign: process.env.SWISS_POST_CUSTOMER_LOGO_VALIGN || "TOP",
  };

  const recipient = buildRecipient(order);
  return {
    language,
    frankingLicense,
    ppFranking,
    labelDefinition: {
      labelLayout: process.env.SWISS_POST_LABEL_LAYOUT || "A7",
      printAddresses: process.env.SWISS_POST_LABEL_PRINT_ADDRESSES || "ONLY_RECIPIENT",
      imageFileType: (process.env.SWISS_POST_IMAGE_FILE_TYPE || "JPG").toUpperCase(),
      imageResolution,
      printPreview: process.env.SWISS_POST_LABEL_PRINT_PREVIEW === "1",
    },
    customer: sender,
    item: {
      itemID: `${order?.galaxusOrderId || trackingNumber}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      recipient,
      attributes: { przl: przlValues },
      notification:
        notificationService && recipient.email
          ? [
              {
                communication: {
                  email: recipient.email || "",
                  mobile: null,
                },
                service: notificationService,
                freeText1: null,
                freeText2: null,
                language,
                type: "EMAIL",
              },
            ]
          : [],
    },
  };
}

export async function requestSwissPostLabelForOrderWithTrackingHint(order: any, trackingHint: string) {
  const payload = buildSwissPostPayload(order, trackingHint);
  return requestSwissPostLabel(payload);
}

/** Call Swiss Post before creating a Shipment so failed labels leave no parcel row. */
export async function requestSwissPostLabelForGalaxusOrder(order: any) {
  const hint =
    String(order?.galaxusOrderId ?? "").trim() || `GALAXUS-ORDER-${order?.id ?? "unknown"}`;
  return requestSwissPostLabelForOrderWithTrackingHint(order, hint);
}

/**
 * Persist label, tracking, optional ORDR, DELR (+ INVO via delr). Assumes swissData is a successful API body.
 */
export async function applySuccessfulSwissPostLabelToShipment(
  shipmentId: string,
  swissData: any
): Promise<{
  documentId: string;
  url: string;
  version: number;
  delr: any;
  ordr: any;
  trackingNumber: string;
}> {
  const prismaAny = prisma as any;
  const shipment = await prismaAny.shipment.findUnique({
    where: { id: shipmentId },
    include: { order: true },
  });
  if (!shipment?.order) {
    throw new Error("Shipment not found");
  }

  const swissPostLabelId = extractSwissPostTracking(swissData);
  if (!swissPostLabelId) {
    throw new Error("Swiss Post identCode missing from label response");
  }
  const labelPayload = extractLabelPayload(swissData);
  if (!labelPayload?.base64) {
    throw new Error("Swiss Post label missing content");
  }

  const buffer = Buffer.from(labelPayload.base64, "base64");
  const storage = getStorageAdapter();
  const existingDocs = await prisma.document.findMany({
    where: { shipmentId, type: DocumentType.LABEL, storageUrl: { contains: "shipping-labels" } },
    orderBy: { version: "desc" },
    take: 1,
  });
  const nextVersion = existingDocs[0]?.version ? existingDocs[0].version + 1 : 1;
  const key = `galaxus/${shipment.order.galaxusOrderId}/shipping-labels/${shipment.id}/v${nextVersion}.${labelPayload.extension}`;
  const stored = await storage.uploadPdf(key, buffer);
  const document = await prisma.document.create({
    data: {
      orderId: shipment.orderId,
      shipmentId,
      type: DocumentType.LABEL,
      version: nextVersion,
      storageUrl: stored.storageUrl,
      checksum: null,
    },
  });

  const carrierFinal = "swisspost";
  await prismaAny.shipment.update({
    where: { id: shipmentId },
    data: {
      trackingNumber: swissPostLabelId,
      carrierFinal,
      carrierRaw: carrierFinal,
      shippedAt: shipment.shippedAt ?? new Date(),
    },
  });

  const freshOrder = await prisma.galaxusOrder.findUnique({
    where: { id: shipment.orderId },
    select: { id: true, galaxusOrderId: true, ordrSentAt: true },
  });
  let ordr = null as any;
  if (freshOrder && !freshOrder.ordrSentAt) {
    ordr = await sendOutgoingEdi({ orderId: freshOrder.id, types: ["ORDR"], force: true }).catch((error: any) => ({
      ok: false,
      error: error?.message ?? "ORDR send failed",
    }));
  }

  const delrResult = await uploadDelrForShipment(shipmentId).catch((error: any) => ({
    shipmentId,
    status: "error",
    message: error?.message ?? "DELR upload failed",
  }));
  const delrPayload =
    delrResult && typeof delrResult === "object"
      ? { ...delrResult, shipmentId: swissPostLabelId }
      : delrResult;

  return {
    documentId: document.id,
    url: `/api/galaxus/documents/${document.id}`,
    version: nextVersion,
    delr: delrPayload,
    ordr,
    trackingNumber: swissPostLabelId,
  };
}

/** Remove non-finalized parcels so a new label attempt does not skip createShipments. */
export async function deleteDraftShipmentsForOrder(orderId: string): Promise<number> {
  const prismaAny = prisma as any;
  const drafts = await prisma.shipment.findMany({
    where: {
      orderId,
      delrSentAt: null,
    },
    select: { id: true },
  });
  const ids = drafts.map((d) => d.id);
  if (ids.length === 0) return 0;

  await prismaAny.supplierOrder.deleteMany({ where: { shipmentId: { in: ids } } });
  await prisma.document.deleteMany({ where: { shipmentId: { in: ids } } });
  await prisma.shipmentItem.deleteMany({ where: { shipmentId: { in: ids } } });
  const res = await prisma.shipment.deleteMany({ where: { id: { in: ids } } });
  return res.count;
}
