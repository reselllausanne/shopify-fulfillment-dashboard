import "server-only";

import { DocumentType } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { getStxLinkStatusForOrder } from "@/galaxus/stx/purchaseUnits";
import { createShipmentsForOrder } from "@/galaxus/warehouse/shipments";
import { getStorageAdapter, getStorageAdapterForUrl } from "@/galaxus/storage/storage";
import {
  applySuccessfulSwissPostLabelToShipment,
  extractLabelPayload,
  extractSwissPostTracking,
  requestSwissPostLabelForOrderWithTrackingHint,
} from "@/galaxus/directDelivery/swissPostLabelFlow";
import { isGalaxusGldSupplierLine } from "@/galaxus/warehouse/lineInventorySource";

export type DirectSwissPostLabelData = {
  base64: string;
  mimeType: string;
  extension: string;
};

export type BrowserPrintConfig = {
  enabled: boolean;
  widthMm: number;
  heightMm: number;
  marginMm: number;
};

export type RunDirectSwissPostLabelResult = {
  ok: boolean;
  status?: "CREATED" | "ALREADY_FULFILLED" | "REPRINT";
  error?: string;
  removedDraftShipments?: number;
  createShipmentsStatus?: string;
  url?: string;
  version?: number;
  delr?: unknown;
  ordr?: unknown;
  trackingNumber?: string | null;
  shipmentId?: string;
  labelData?: DirectSwissPostLabelData | null;
  browserPrintConfig?: BrowserPrintConfig;
  swissPost?: unknown;
};

type ShipmentRow = {
  id: string;
  delrSentAt: Date | null;
  delrStatus: string | null;
  trackingNumber: string | null;
};

function extensionToMimeType(extension: string) {
  const ext = String(extension || "").trim().toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

export function resolveBrowserPrintConfig(): BrowserPrintConfig {
  const bool = (raw: string | undefined, fallback: boolean) => {
    const value = String(raw || "").trim().toLowerCase();
    if (!value) return fallback;
    if (["1", "true", "yes", "on"].includes(value)) return true;
    if (["0", "false", "no", "off"].includes(value)) return false;
    return fallback;
  };
  const num = (raw: string | undefined, fallback: number, min: number, max: number) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  };
  return {
    enabled: bool(process.env.SCAN_BROWSER_PRINT_ENABLED, true),
    widthMm: num(process.env.SCAN_BROWSER_PRINT_WIDTH_MM, 62, 20, 300),
    heightMm: num(process.env.SCAN_BROWSER_PRINT_HEIGHT_MM, 86, 20, 400),
    marginMm: num(process.env.SCAN_BROWSER_PRINT_MARGIN_MM, 0, 0, 25),
  };
}

function toLabelData(base64: string, extension: string): DirectSwissPostLabelData {
  return {
    base64,
    extension,
    mimeType: extensionToMimeType(extension),
  };
}

function isFinalizedShipment(s: ShipmentRow): boolean {
  const status = String(s.delrStatus ?? "").toUpperCase();
  return Boolean(s.delrSentAt) || status === "UPLOADED" || status === "SENT";
}

async function loadExistingShippingLabelData(orderDbId: string, shipmentId?: string | null) {
  const doc = await prisma.document.findFirst({
    where: {
      orderId: orderDbId,
      type: DocumentType.LABEL,
      storageUrl: { contains: "shipping-labels" },
      ...(shipmentId ? { shipmentId } : {}),
    },
    orderBy: { version: "desc" },
  });
  if (!doc?.storageUrl) return null;
  const storage = getStorageAdapterForUrl(doc.storageUrl);
  const file = await storage.getPdf(doc.storageUrl);
  const extMatch = doc.storageUrl.match(/\.([a-z0-9]+)(?:\?|$)/i);
  const extension = extMatch?.[1]?.toLowerCase() || "pdf";
  return {
    documentId: doc.id,
    url: `/api/galaxus/documents/${doc.id}`,
    version: doc.version,
    labelData: toLabelData(file.content.toString("base64"), extension),
  };
}

/** Last-resort: keep Post barcode PDF even if normal apply path blew up. */
async function salvageSwissPostLabelToShipment(params: {
  orderId: string;
  galaxusOrderId: string;
  shipmentId: string;
  swissData: any;
}): Promise<{ url: string; version: number; trackingNumber: string } | null> {
  const tracking = extractSwissPostTracking(params.swissData);
  const labelPayload = extractLabelPayload(params.swissData);
  if (!tracking || !labelPayload?.base64) return null;

  const buffer = Buffer.from(labelPayload.base64, "base64");
  const storage = getStorageAdapter();
  const existingDocs = await prisma.document.findMany({
    where: {
      shipmentId: params.shipmentId,
      type: DocumentType.LABEL,
      storageUrl: { contains: "shipping-labels" },
    },
    orderBy: { version: "desc" },
    take: 1,
  });
  const nextVersion = existingDocs[0]?.version ? existingDocs[0].version + 1 : 1;
  const key = `galaxus/${params.galaxusOrderId}/shipping-labels/${params.shipmentId}/v${nextVersion}.${labelPayload.extension}`;
  const stored = await storage.uploadPdf(key, buffer);
  const document = await prisma.document.create({
    data: {
      orderId: params.orderId,
      shipmentId: params.shipmentId,
      type: DocumentType.LABEL,
      version: nextVersion,
      storageUrl: stored.storageUrl,
      checksum: null,
    },
  });
  await (prisma as any).shipment.update({
    where: { id: params.shipmentId },
    data: {
      trackingNumber: tracking,
      carrierFinal: "swisspost",
      carrierRaw: "swisspost",
      shippedAt: new Date(),
    },
  });
  return {
    url: `/api/galaxus/documents/${document.id}`,
    version: nextVersion,
    trackingNumber: tracking,
  };
}

/**
 * Direct delivery Swiss Post label.
 *
 * NEVER mint a Post barcode until a shipment row exists.
 * Prefer existing open/finalized shipments over creating new ones / burning barcodes.
 */
export async function runDirectSwissPostLabelForOrder(
  orderIdOrRef: string,
  options?: { includeLabelData?: boolean; allowReprint?: boolean; requireLinked?: boolean }
): Promise<RunDirectSwissPostLabelResult> {
  const includeLabelData = Boolean(options?.includeLabelData ?? true);
  const allowReprint = Boolean(options?.allowReprint ?? true);
  const requireLinked = Boolean(options?.requireLinked ?? true);
  const browserPrintConfig = resolveBrowserPrintConfig();

  const order = await prisma.galaxusOrder.findFirst({
    where: { OR: [{ id: orderIdOrRef }, { galaxusOrderId: orderIdOrRef }] },
    include: {
      lines: true,
      shipments: {
        select: { id: true, delrSentAt: true, delrStatus: true, trackingNumber: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!order) {
    return { ok: false, error: "Order not found" };
  }
  if (String(order.deliveryType ?? "").toLowerCase() !== "direct_delivery") {
    return { ok: false, error: "Order is not direct_delivery" };
  }

  const gldLines = (order.lines ?? []).filter((line: any) => isGalaxusGldSupplierLine(line));
  if (gldLines.length > 0) {
    return {
      ok: false,
      error: "Order has GLD/Golden lines — not eligible for Swiss direct delivery",
    };
  }

  if (requireLinked) {
    const linkStatus = await getStxLinkStatusForOrder(order.id).catch(() => null);
    if (linkStatus && !linkStatus.allLinked) {
      return { ok: false, error: "Order not fully linked yet" };
    }
  }

  const shipments = (order.shipments ?? []) as ShipmentRow[];
  const finalized = shipments.filter(isFinalizedShipment);
  const open = shipments.filter((s) => !isFinalizedShipment(s));

  // 1) Finalized DELR → reprint only (no new Post barcode).
  if (finalized.length > 0) {
    const shipment = finalized.find((s) => String(s.trackingNumber ?? "").trim()) ?? finalized[0];
    if (allowReprint) {
      const existing = await loadExistingShippingLabelData(order.id, shipment.id);
      if (existing) {
        return {
          ok: true,
          status: "REPRINT",
          url: existing.url,
          version: existing.version,
          trackingNumber: shipment.trackingNumber ?? null,
          shipmentId: shipment.id,
          labelData: includeLabelData ? existing.labelData : null,
          browserPrintConfig,
          delr: {
            shipmentId: shipment.id,
            status: "skipped",
            message: "already sent",
          },
        };
      }
    }
    return {
      ok: false,
      error: "Order already has a finalized shipment (DELR sent)",
      shipmentId: shipment.id,
      trackingNumber: shipment.trackingNumber ?? null,
      browserPrintConfig,
    };
  }

  // 2) Open shipment already has tracking → retry DELR if needed, reprint label (no remint).
  const openWithTracking = open.find((s) => String(s.trackingNumber ?? "").trim());
  const openWithoutTracking = open.filter((s) => !String(s.trackingNumber ?? "").trim());
  if (openWithTracking && openWithoutTracking.length === 0) {
    const { uploadDelrForShipment } = await import("@/galaxus/warehouse/delr");
    const delr = await uploadDelrForShipment(openWithTracking.id).catch((error: any) => ({
      status: "error",
      message: error?.message ?? "DELR retry failed",
    }));
    const existing = await loadExistingShippingLabelData(order.id, openWithTracking.id);
    if (existing) {
      return {
        ok: true,
        status: "REPRINT",
        url: existing.url,
        version: existing.version,
        trackingNumber: openWithTracking.trackingNumber,
        shipmentId: openWithTracking.id,
        labelData: includeLabelData ? existing.labelData : null,
        browserPrintConfig,
        delr,
      };
    }
  }

  // 3) Ensure we have a shipment row BEFORE calling Swiss Post.
  // One parcel for the whole direct order (qty can be >1). Split-by-1 burned
  // half-labeled NER carts; ask-how-many / cancel-request comes later.
  let targetShipmentId = openWithTracking?.id ?? open[0]?.id ?? null;
  let createShipmentsStatus: string | undefined;

  if (!targetShipmentId) {
    const created = await createShipmentsForOrder({
      orderId: order.id,
      allowSplit: false,
      maxPairsPerParcel: 24,
      deliveryType: "direct_delivery",
    });
    createShipmentsStatus = created.status;
    if (created.status === "error" || !created.shipments?.length) {
      return {
        ok: false,
        error: created.message ?? "Create shipments failed",
        createShipmentsStatus: created.status,
        browserPrintConfig,
      };
    }
    // create may return skipped+existing or created — either way use first row.
    targetShipmentId = created.shipments[0].id;
  }

  const hint =
    String(order.galaxusOrderId ?? "").trim() ||
    String(targetShipmentId) ||
    `GALAXUS-ORDER-${order.id}`;

  let swissRes;
  try {
    swissRes = await requestSwissPostLabelForOrderWithTrackingHint(order, hint);
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message ?? "Swiss Post API unreachable",
      shipmentId: targetShipmentId,
      createShipmentsStatus,
      browserPrintConfig,
    };
  }
  if (!swissRes.ok) {
    return {
      ok: false,
      error: "Swiss Post label generation failed",
      swissPost: swissRes.data,
      shipmentId: targetShipmentId,
      createShipmentsStatus,
      browserPrintConfig,
    };
  }

  try {
    const result = await applySuccessfulSwissPostLabelToShipment(targetShipmentId, swissRes.data);
    const labelPayload = extractLabelPayload(swissRes.data);
    return {
      ok: true,
      status: "CREATED",
      createShipmentsStatus,
      url: result.url,
      version: result.version,
      delr: result.delr,
      ordr: result.ordr,
      trackingNumber: result.trackingNumber,
      shipmentId: targetShipmentId,
      labelData:
        includeLabelData && labelPayload?.base64
          ? toLabelData(labelPayload.base64, labelPayload.extension)
          : null,
      browserPrintConfig,
    };
  } catch (persistErr: any) {
    console.error("[GALAXUS][DIRECT-SWISS-POST-LABEL] Persist after label failed:", persistErr);
    try {
      const salvaged = await salvageSwissPostLabelToShipment({
        orderId: order.id,
        galaxusOrderId: order.galaxusOrderId,
        shipmentId: targetShipmentId,
        swissData: swissRes.data,
      });
      if (salvaged) {
        const labelPayload = extractLabelPayload(swissRes.data);
        return {
          ok: true,
          status: "CREATED",
          createShipmentsStatus,
          url: salvaged.url,
          version: salvaged.version,
          trackingNumber: salvaged.trackingNumber,
          shipmentId: targetShipmentId,
          delr: {
            status: "error",
            message: "Label saved; DELR not sent — retry DELR from warehouse/direct tools",
          },
          labelData:
            includeLabelData && labelPayload?.base64
              ? toLabelData(labelPayload.base64, labelPayload.extension)
              : null,
          browserPrintConfig,
          swissPost: swissRes.data,
        };
      }
    } catch (salvageErr: any) {
      console.error("[GALAXUS][DIRECT-SWISS-POST-LABEL] Salvage failed:", salvageErr);
    }
    return {
      ok: false,
      error: persistErr?.message ?? "Failed to persist label after Swiss Post success",
      shipmentId: targetShipmentId,
      createShipmentsStatus,
      swissPost: swissRes.data,
      browserPrintConfig,
    };
  }
}
