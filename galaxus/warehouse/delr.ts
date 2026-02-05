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
};

export async function uploadDelrForShipment(
  shipmentId: string,
  options: { force?: boolean } = {}
): Promise<UploadResult> {
  assertSftpConfig();

  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      items: true,
      order: { include: { lines: true } },
    },
  });

  if (!shipment || !shipment.order) {
    return { shipmentId, status: "error", message: "Shipment not found" };
  }

  if (shipment.delrSentAt && !options.force) {
    return { shipmentId, status: "skipped", filename: shipment.delrFileName ?? undefined, message: "already sent" };
  }

  try {
    validateShipment(shipment);
    const carrier = resolveCarrier(shipment.carrierFinal);
    const dispatch = buildDispatchNotification(
      shipment.order,
      shipment.order.lines,
      { ...shipment, carrierFinal: carrier },
      shipment.items,
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

    await prisma.shipment.update({
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
    });

    return { shipmentId, status: "uploaded", filename: dispatch.filename };
  } catch (error: any) {
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        delrStatus: "ERROR",
        delrError: error?.message ?? "DELR upload failed",
      },
    });

    return { shipmentId, status: "error", message: error?.message ?? "DELR upload failed" };
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
