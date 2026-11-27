import { prisma } from "@/app/lib/prisma";
import {
  INVOICE_BLOCKED_EVENT,
  SHIPMENT_SUPERSEDED_EVENT,
  buildSupersedeUpdate,
  isSupersededShipment,
} from "@/galaxus/warehouse/supersededShipment";

/**
 * Reopen a direct-delivery order after a wrong item shipped: keep the shipment row (audit),
 * neutralize every "shipped" signal. Sends NOTHING to Galaxus / Swiss Post.
 * Does NOT touch INVO files (already-sent invoices stay valid; see INVOICE_BLOCKED).
 */
export async function supersedeWrongItemShipment(options: {
  shipmentId: string;
  reason: string;
  ticket?: string | null;
  blockInvoice?: boolean;
  dryRun?: boolean;
}) {
  const p = prisma as any;
  const shipment = await p.shipment.findUnique({
    where: { id: options.shipmentId },
    include: { items: true },
  });
  if (!shipment) throw new Error("Shipment not found");
  if (isSupersededShipment(shipment)) return { changed: false as const, reason: "already superseded" };
  const { snapshot, data } = buildSupersedeUpdate(shipment, options);
  const ediFiles = await p.galaxusEdiFile.findMany({
    where: { shipmentId: shipment.id, direction: "OUT", docType: "DELR" },
    select: { id: true, status: true, filename: true },
  });
  const plan = { shipmentId: shipment.id, update: data, snapshot, ediFiles };
  if (options.dryRun) return { changed: false as const, dryRun: true as const, plan };

  const lineKeys = new Map<string, { orderId: string; supplierPid: string; gtin: string }>();
  for (const it of shipment.items ?? []) {
    const orderId = String(it.orderId ?? shipment.orderId ?? "");
    const supplierPid = String(it.supplierPid ?? "").trim();
    const gtin = String(it.gtin14 ?? "").trim();
    if (orderId && supplierPid && gtin) lineKeys.set(`${orderId}|${supplierPid}|${gtin}`, { orderId, supplierPid, gtin });
  }
  await p.$transaction(async (tx: any) => {
    await tx.shipment.update({ where: { id: shipment.id }, data });
    await tx.galaxusEdiFile.updateMany({
      where: { shipmentId: shipment.id, direction: "OUT", docType: "DELR" },
      data: { status: "voided" },
    });
    for (const k of lineKeys.values()) {
      await tx.galaxusOrderLine.updateMany({
        where: { ...k, warehouseMarkedShippedAt: { not: null } },
        data: { warehouseMarkedShippedAt: null },
      });
    }
    await tx.orderStatusEvent.create({
      data: {
        orderId: shipment.orderId,
        source: "OPS",
        type: SHIPMENT_SUPERSEDED_EVENT,
        payloadJson: { shipmentId: shipment.id, ticket: options.ticket ?? null, reason: options.reason, previous: snapshot, ediFiles },
      },
    });
    if (options.blockInvoice) {
      await tx.orderStatusEvent.create({
        data: {
          orderId: shipment.orderId,
          source: "OPS",
          type: INVOICE_BLOCKED_EVENT,
          payloadJson: { reason: "reship after wrong item: original INVO already sent", ticket: options.ticket ?? null },
        },
      });
    }
  });
  return { changed: true as const, plan };
}

/** True when ops blocked line-based INVO for this order (reship / wrong delivery). */
export async function orderHasInvoiceBlock(orderDbId: string): Promise<boolean> {
  const hit = await (prisma as any).orderStatusEvent.findFirst({
    where: { orderId: orderDbId, type: INVOICE_BLOCKED_EVENT },
    select: { id: true },
  });
  return Boolean(hit);
}
