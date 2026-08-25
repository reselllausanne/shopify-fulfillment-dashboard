import "server-only";

import { prisma } from "@/app/lib/prisma";
import { requestSwissPostLabel } from "@/lib/swissPost";
import { buildSwissPostRecipientFromGalaxusOrder } from "@/lib/swissPostRecipient";
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

export function extractLabelPayload(response: any) {
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

function buildRecipient(order: any) {
  const recipient = buildSwissPostRecipientFromGalaxusOrder(order);
  return {
    personallyAddressed: recipient.personallyAddressed,
    name1: recipient.name1,
    firstName: recipient.firstName,
    name2: recipient.name2,
    name3: recipient.name3,
    street: recipient.street,
    zip: recipient.zip,
    city: recipient.city,
    country: recipient.country,
    phone: recipient.phone,
    email: recipient.email,
  };
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

export type PostLabelApplyResult = {
  documentId: string;
  url: string;
  version: number;
  delr: any;
  ordr: any;
  trackingNumber: string;
};

export type ExistingFulfilledPostLabelResponse = {
  documentId: string | null;
  url: string | null;
  version: number | null;
  delr: any;
  ordr: any;
  trackingNumber: string;
  alreadyFulfilled: true;
};

/**
 * Idempotent fast path: DELR already uploaded — return latest shipping label without re-calling Swiss Post.
 */
export async function resolveExistingFulfilledPostLabelResponse(
  shipmentId: string,
  options: {
    documentUrlBase?: "/api/galaxus/documents" | "/api/partners/galaxus/documents";
  } = {}
): Promise<ExistingFulfilledPostLabelResponse | null> {
  const prismaAny = prisma as any;
  const shipment = await prismaAny.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true,
      trackingNumber: true,
      delrSentAt: true,
      delrStatus: true,
      delrFileName: true,
    },
  });
  if (!shipment?.delrSentAt) return null;
  const delrStatus = String(shipment.delrStatus ?? "").toUpperCase();
  if (delrStatus !== "UPLOADED" && delrStatus !== "SENT") return null;

  const existingDoc = await prisma.document.findFirst({
    where: {
      shipmentId,
      type: DocumentType.LABEL,
      storageUrl: { contains: "shipping-labels" },
    },
    orderBy: { version: "desc" },
    select: { id: true, version: true },
  });

  const documentUrlBase = options.documentUrlBase ?? "/api/galaxus/documents";
  const trackingNumber = String(shipment.trackingNumber ?? "").trim();
  return {
    documentId: existingDoc?.id ?? null,
    url: existingDoc ? `${documentUrlBase}/${existingDoc.id}` : null,
    version: existingDoc?.version ?? null,
    delr: {
      shipmentId,
      status: "skipped",
      message: "already sent",
      filename: shipment.delrFileName ?? undefined,
    },
    ordr: null,
    trackingNumber,
    alreadyFulfilled: true as const,
  };
}

/**
 * Persist label, tracking, optional ORDR, DELR (+ INVO via delr). Assumes swissData is a successful API body.
 *
 * Default: return as soon as the Swiss Post label is stored. ORDR/DELR run in background so the
 * warehouse UI is not blocked on Galaxus SFTP (that path was taking minutes when SFTP hung).
 * Pass `waitForEdi: true` only when the caller must know DELR outcome before responding.
 */
export async function applySuccessfulSwissPostLabelToShipment(
  shipmentId: string,
  swissData: any,
  options: {
    documentUrlBase?: "/api/galaxus/documents" | "/api/partners/galaxus/documents";
    delrActor?: { type: "partner"; partnerId: string; partnerKey: string } | { type: "staff" };
    waitForEdi?: boolean;
  } = {}
): Promise<PostLabelApplyResult> {
  const startedAt = Date.now();
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
      delrStatus: shipment.delrSentAt ? shipment.delrStatus : "PENDING",
      delrError: null,
    },
  });

  const documentUrlBase = options.documentUrlBase ?? "/api/galaxus/documents";
  const baseResult: PostLabelApplyResult = {
    documentId: document.id,
    url: `${documentUrlBase}/${document.id}`,
    version: nextVersion,
    delr: {
      shipmentId: swissPostLabelId,
      status: "pending",
      message: "DELR queued after Swiss Post label",
    },
    ordr: { status: "pending" },
    trackingNumber: swissPostLabelId,
  };

  console.log("[POST-LABEL] label persisted", {
    shipmentId,
    trackingNumber: swissPostLabelId,
    ms: Date.now() - startedAt,
    waitForEdi: Boolean(options.waitForEdi),
  });

  if (options.waitForEdi) {
    const edi = await finalizeShipmentEdiAfterLabel(shipmentId, swissPostLabelId, options);
    return {
      ...baseResult,
      delr: edi.delr,
      ordr: edi.ordr,
    };
  }

  void finalizeShipmentEdiAfterLabel(shipmentId, swissPostLabelId, options).catch((error: any) => {
    console.error("[POST-LABEL] background ORDR/DELR failed", {
      shipmentId,
      trackingNumber: swissPostLabelId,
      message: error?.message ?? String(error),
    });
  });

  return baseResult;
}

async function finalizeShipmentEdiAfterLabel(
  shipmentId: string,
  swissPostLabelId: string,
  options: {
    delrActor?: { type: "partner"; partnerId: string; partnerKey: string } | { type: "staff" };
  } = {}
): Promise<{ delr: any; ordr: any }> {
  const startedAt = Date.now();
  const prismaAny = prisma as any;
  const shipment = await prismaAny.shipment.findUnique({
    where: { id: shipmentId },
    select: { orderId: true },
  });
  if (!shipment?.orderId) {
    throw new Error("Shipment not found for EDI finalize");
  }

  const freshOrder = await prisma.galaxusOrder.findUnique({
    where: { id: shipment.orderId },
    select: { id: true, galaxusOrderId: true, ordrSentAt: true },
  });
  let ordr = null as any;
  if (freshOrder && !freshOrder.ordrSentAt) {
    const ordrStartedAt = Date.now();
    ordr = await sendOutgoingEdi({
      orderId: freshOrder.id,
      types: ["ORDR"],
      ordrMode: "WITHOUT_POSITIONS",
      force: true,
    }).catch((error: any) => ({
      ok: false,
      error: error?.message ?? "ORDR send failed",
    }));
    console.log("[POST-LABEL] ORDR done", {
      shipmentId,
      ms: Date.now() - ordrStartedAt,
      ok: !ordr?.error,
    });
  }

  const delrStartedAt = Date.now();
  const delrResult = await uploadDelrForShipment(shipmentId, { actor: options.delrActor }).catch(
    async (error: any) => {
      const message = error?.message ?? "DELR upload failed";
      await prismaAny.shipment
        .update({
          where: { id: shipmentId },
          data: {
            delrStatus: "ERROR",
            delrError: message,
          },
        })
        .catch(() => undefined);
      return {
        shipmentId,
        status: "error",
        message,
      };
    }
  );
  console.log("[POST-LABEL] DELR done", {
    shipmentId,
    ms: Date.now() - delrStartedAt,
    totalMs: Date.now() - startedAt,
    status: (delrResult as any)?.status ?? null,
  });

  const delrPayload =
    delrResult && typeof delrResult === "object"
      ? { ...delrResult, shipmentId: swissPostLabelId }
      : delrResult;

  return { delr: delrPayload, ordr };
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
