import "server-only";

import { prisma } from "@/app/lib/prisma";

export type ResetDelrResult = {
  shipmentId: string;
  ok: boolean;
  message: string;
  linesReset: number;
  httpStatus?: number;
};

/**
 * Roll back a FULFILLED/UPLOADED shipment whose DELR was removed from the
 * SFTP before Galaxus could ingest it.
 *
 * Resets all DELR & fulfilment flags so the shipment can be deleted and
 * re-created with the correct items.
 */
export async function resetDelrForShipment(shipmentId: string): Promise<ResetDelrResult> {
  const prismaAny = prisma as any;

  const shipment = await prismaAny.shipment.findUnique({
    where: { id: shipmentId },
    include: { items: true },
  });

  if (!shipment) {
    return { shipmentId, ok: false, message: "Shipment not found", linesReset: 0, httpStatus: 404 };
  }

  const delrStatus = String(shipment.delrStatus ?? "").toUpperCase();
  const status = String(shipment.status ?? "").toUpperCase();

  if (!shipment.delrSentAt && delrStatus !== "UPLOADED" && status !== "FULFILLED") {
    return {
      shipmentId,
      ok: false,
      message: "Shipment is not in a FULFILLED/UPLOADED state — nothing to reset",
      linesReset: 0,
      httpStatus: 409,
    };
  }

  // 1. Reset shipment DELR & fulfilment fields back to pending MANUAL state.
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

  // 2. Un-mark order lines that were stamped as shipped by this DELR upload.
  const uniqueItemKeys = new Set<string>();
  let linesReset = 0;
  for (const item of (shipment.items ?? []) as any[]) {
    const orderId = item?.orderId
      ? String(item.orderId)
      : shipment.orderId
        ? String(shipment.orderId)
        : "";
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

  // 3. Void the outgoing EDI file record so it won't be re-sent accidentally.
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
    ok: true,
    message: `Reset OK — ${linesReset} order line(s) un-marked. Shipment is now MANUAL/PENDING and can be deleted.`,
    linesReset,
  };
}
