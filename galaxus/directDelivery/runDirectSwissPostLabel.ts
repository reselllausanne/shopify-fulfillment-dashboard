import "server-only";

import { DocumentType } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { getStxLinkStatusForOrder } from "@/galaxus/stx/purchaseUnits";
import { createShipmentsForOrder } from "@/galaxus/warehouse/shipments";
import { getStorageAdapterForUrl } from "@/galaxus/storage/storage";
import {
  applySuccessfulSwissPostLabelToShipment,
  deleteDraftShipmentsForOrder,
  extractLabelPayload,
  requestSwissPostLabelForGalaxusOrder,
} from "@/galaxus/directDelivery/swissPostLabelFlow";

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

async function loadExistingShippingLabelData(orderDbId: string) {
  const doc = await prisma.document.findFirst({
    where: {
      orderId: orderDbId,
      type: DocumentType.LABEL,
      storageUrl: { contains: "shipping-labels" },
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

export async function runDirectSwissPostLabelForOrder(
  orderIdOrRef: string,
  options?: { includeLabelData?: boolean; allowReprint?: boolean; requireLinked?: boolean }
): Promise<RunDirectSwissPostLabelResult> {
  const includeLabelData = Boolean(options?.includeLabelData);
  const allowReprint = Boolean(options?.allowReprint ?? true);
  const requireLinked = Boolean(options?.requireLinked ?? true);
  const browserPrintConfig = resolveBrowserPrintConfig();

  const order = await prisma.galaxusOrder.findFirst({
    where: { OR: [{ id: orderIdOrRef }, { galaxusOrderId: orderIdOrRef }] },
    include: { lines: true, shipments: { select: { id: true, delrSentAt: true, delrStatus: true, trackingNumber: true } } },
  });
  if (!order) {
    return { ok: false, error: "Order not found" };
  }
  if (String(order.deliveryType ?? "").toLowerCase() !== "direct_delivery") {
    return { ok: false, error: "Order is not direct_delivery" };
  }

  if (requireLinked) {
    const linkStatus = await getStxLinkStatusForOrder(order.id).catch(() => null);
    if (linkStatus && !linkStatus.allLinked) {
      return { ok: false, error: "Order not fully linked yet" };
    }
  }

  const alreadyFulfilled = (order.shipments ?? []).some(
    (s) => Boolean(s.delrSentAt) || String(s.delrStatus ?? "").toUpperCase() === "UPLOADED"
  );
  if (alreadyFulfilled) {
    if (allowReprint && includeLabelData) {
      const existing = await loadExistingShippingLabelData(order.id);
      if (existing) {
        const shipment = (order.shipments ?? []).find((s) => String(s.trackingNumber ?? "").trim());
        return {
          ok: true,
          status: "REPRINT",
          url: existing.url,
          version: existing.version,
          trackingNumber: shipment?.trackingNumber ?? null,
          shipmentId: shipment?.id,
          labelData: existing.labelData,
          browserPrintConfig,
        };
      }
    }
    return { ok: false, error: "Order already has a finalized shipment (DELR sent)" };
  }

  const removedDrafts = await deleteDraftShipmentsForOrder(order.id);
  const swissRes = await requestSwissPostLabelForGalaxusOrder(order);
  if (!swissRes.ok) {
    return {
      ok: false,
      error: "Swiss Post label generation failed",
      swissPost: swissRes.data,
    };
  }

  const created = await createShipmentsForOrder({
    orderId: order.id,
    allowSplit: true,
    maxPairsPerParcel: 1,
    deliveryType: "direct_delivery",
  });

  if (created.status === "skipped") {
    return {
      ok: false,
      error: created.message ?? "Shipments already exist (unexpected after draft cleanup)",
      swissPost: swissRes.data,
    };
  }
  if (created.status === "error" || !created.shipments?.length) {
    return {
      ok: false,
      error: created.message ?? "Create shipments failed after Swiss Post label succeeded",
      swissPost: swissRes.data,
    };
  }

  const first = created.shipments[0];
  try {
    const result = await applySuccessfulSwissPostLabelToShipment(first.id, swissRes.data);
    const labelPayload = extractLabelPayload(swissRes.data);
    return {
      ok: true,
      status: "CREATED",
      removedDraftShipments: removedDrafts,
      createShipmentsStatus: created.status,
      url: result.url,
      version: result.version,
      delr: result.delr,
      ordr: result.ordr,
      trackingNumber: result.trackingNumber,
      shipmentId: first.id,
      labelData:
        includeLabelData && labelPayload?.base64
          ? toLabelData(labelPayload.base64, labelPayload.extension)
          : null,
      browserPrintConfig,
    };
  } catch (persistErr: any) {
    console.error("[GALAXUS][DIRECT-SWISS-POST-LABEL] Persist after label failed:", persistErr);
    return {
      ok: false,
      error: persistErr?.message ?? "Failed to persist label after Swiss Post success",
      shipmentId: first.id,
      swissPost: swissRes.data,
    };
  }
}
