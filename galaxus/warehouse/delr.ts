import "server-only";

import { prisma } from "@/app/lib/prisma";
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

type UploadResult = {
  shipmentId: string;
  status: "uploaded" | "skipped" | "error";
  filename?: string;
  message?: string;
  httpStatus?: number;
  debug?: {
    boxId: string;
    sscc: string | null;
    supplierOrderId: string | null;
    supplierOrderStatus: string | null;
    trackingCount: number;
    delrSentAt: string | null;
    ediFileId: string | null;
  };
};

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

  if (!shipment.order.ordrSentAt && !options.force) {
    return { shipmentId, status: "error", message: "ORDR not sent yet" };
  }

  const debug = await buildShipmentDebug(shipment);
  const existingDelr = await findExistingDelr(shipment);
  if (existingDelr) {
    return {
      shipmentId,
      status: "skipped",
      httpStatus: 409,
      message: "DELR already sent",
      filename: existingDelr.filename ?? undefined,
      debug: {
        ...debug,
        ediFileId: existingDelr.id ?? null,
      },
    };
  }

  const shipped = await resolveShipmentShipped(shipment);
  if (!shipped) {
    return {
      shipmentId,
      status: "error",
      httpStatus: 409,
      message: "Shipment not marked as shipped",
      debug,
    };
  }

  if (!shipment.packageId) {
    return {
      shipmentId,
      status: "error",
      httpStatus: 400,
      message: "Missing SSCC package id",
      debug,
    };
  }

  const items = (await prismaAny.shipmentItem.findMany({
    where: { shipmentId: shipment.id },
  })) as Array<{ supplierPid: string; gtin14: string; quantity: number }>;

  if (shipment.delrSentAt && !options.force) {
    return {
      shipmentId,
      status: "skipped",
      httpStatus: 409,
      filename: shipment.delrFileName ?? undefined,
      message: "already sent",
      debug,
    };
  }

  try {
    validateShipment({
      dispatchNotificationId: shipment.dispatchNotificationId ?? null,
      packageId: shipment.packageId ?? null,
      items,
    });
    const carrier = resolveCarrier(shipment.carrierFinal ?? null);
    const dispatch = buildDispatchNotification(
      shipment.order,
      shipment.order.lines,
      { ...shipment, carrierFinal: carrier },
      items,
      { supplierId: GALAXUS_SUPPLIER_ID }
    );

    await withSftp(
      {
        host: GALAXUS_SFTP_HOST,
        port: GALAXUS_SFTP_PORT,
        username: GALAXUS_SFTP_USER,
        password: GALAXUS_SFTP_PASSWORD,
      },
      async (client) => {
        await uploadTempThenRename(client, GALAXUS_SFTP_OUT_DIR, dispatch.filename, dispatch.content);
      }
    );

    await prismaAny.shipment.update({
      where: { id: shipment.id },
      data: {
        delrFileName: dispatch.filename,
        delrSentAt: new Date(),
        delrStatus: "UPLOADED",
        delrError: null,
      },
    });

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

    const sentAt = new Date();
    return {
      shipmentId,
      status: "uploaded",
      filename: dispatch.filename,
      debug: {
        ...debug,
        delrSentAt: sentAt.toISOString(),
      },
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
      debug,
    };
  }
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
}) {
  if (!shipment.dispatchNotificationId) {
    throw new Error("Missing dispatch notification id");
  }
  if (!shipment.packageId) {
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
  if (!value) return null;
  const allowlist = GALAXUS_SHIPMENT_CARRIER_ALLOWLIST.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (allowlist.length === 0) return null;
  return allowlist.includes(value) ? value : null;
}

async function resolveShipmentShipped(shipment: any): Promise<boolean> {
  if (shipment.shippedAt) return true;
  if (shipment.trackingNumber && String(shipment.trackingNumber).trim().length > 0) return true;

  const trackingCount = await resolveTrackingCount(shipment);
  return trackingCount > 0;
}

async function resolveSupplierOrderForShipment(shipment: any) {
  if (!shipment?.orderId) return null;
  const supplierOrderRef = shipment.supplierOrderRef ?? null;
  if (supplierOrderRef) {
    return prisma.supplierOrder.findUnique({ where: { supplierOrderRef } });
  }
  return prisma.supplierOrder.findFirst({ where: { shipmentId: shipment.id } });
}

async function resolveTrackingCount(shipment: any): Promise<number> {
  const supplierOrder = await resolveSupplierOrderForShipment(shipment);
  const payload = supplierOrder?.payloadJson ?? {};
  const trackingNumbers =
    (Array.isArray(payload.trackingNumbers) ? payload.trackingNumbers : null) ??
    (Array.isArray(payload.response?.trackingNumbers) ? payload.response.trackingNumbers : null) ??
    [];
  return trackingNumbers.length;
}

async function buildShipmentDebug(shipment: any) {
  const supplierOrder = await resolveSupplierOrderForShipment(shipment);
  const trackingCount = await resolveTrackingCount(shipment);
  return {
    boxId: shipment.id,
    sscc: shipment.packageId ?? null,
    supplierOrderId: supplierOrder?.supplierOrderRef ?? shipment.supplierOrderRef ?? null,
    supplierOrderStatus: supplierOrder?.status ?? null,
    trackingCount,
    delrSentAt: shipment.delrSentAt ? new Date(shipment.delrSentAt).toISOString() : null,
    ediFileId: null,
  };
}

async function findExistingDelr(shipment: any) {
  if (shipment.delrSentAt || shipment.delrFileName) {
    const byFilename = shipment.delrFileName
      ? await (prisma as any).galaxusEdiFile.findFirst({
          where: { filename: shipment.delrFileName },
        })
      : null;
    if (byFilename) return byFilename;
  }
  return (prisma as any).galaxusEdiFile.findFirst({
    where: { shipmentId: shipment.id, direction: "OUT", docType: "DELR" },
  });
}
