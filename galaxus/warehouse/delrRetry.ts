import "server-only";

import { prisma } from "@/app/lib/prisma";
import { uploadDelrForShipment } from "@/galaxus/warehouse/delr";

export type StuckDelrRetryResult = {
  candidates: number;
  sent: number;
  failed: number;
  results: Array<{ shipmentId: string; galaxusOrderId: string | null; status: string; message?: string }>;
};

/**
 * Direct-delivery shipments that have a Swiss Post tracking number but whose DELR
 * never reached Galaxus (background send died, SFTP hang, container restart, soft gate).
 *
 * Shipments that ever had a DELR file row (incl. voided after reset-delr) are skipped:
 * those were rolled back on purpose.
 */
export async function findStuckDirectDelrShipments(options: {
  minAgeMs?: number;
  maxAgeDays?: number;
  limit?: number;
} = {}) {
  const minAgeMs = options.minAgeMs ?? 10 * 60_000;
  const maxAgeDays = options.maxAgeDays ?? 30;
  const limit = options.limit ?? 25;
  const now = Date.now();
  return (prisma as any).shipment.findMany({
    where: {
      delrSentAt: null,
      delrStatus: { in: ["PENDING", "ERROR"] },
      trackingNumber: { not: null },
      shippedAt: { not: null, lte: new Date(now - minAgeMs) },
      createdAt: { gte: new Date(now - maxAgeDays * 24 * 60 * 60_000) },
      order: { deliveryType: "direct_delivery" },
      ediFiles: { none: { direction: "OUT", docType: "DELR" } },
    },
    select: {
      id: true,
      trackingNumber: true,
      order: { select: { galaxusOrderId: true } },
    },
    orderBy: { shippedAt: "asc" },
    take: limit,
  }) as Promise<Array<{ id: string; trackingNumber: string | null; order: { galaxusOrderId: string } | null }>>;
}

export async function retryStuckDirectDelrs(options: {
  minAgeMs?: number;
  maxAgeDays?: number;
  limit?: number;
} = {}): Promise<StuckDelrRetryResult> {
  const shipments = await findStuckDirectDelrShipments(options);
  const out: StuckDelrRetryResult = { candidates: shipments.length, sent: 0, failed: 0, results: [] };

  for (const shipment of shipments) {
    const galaxusOrderId = shipment.order?.galaxusOrderId ?? null;
    let status = "error";
    let message: string | undefined;
    try {
      const res = await uploadDelrForShipment(shipment.id);
      status = res.status;
      message = res.message;
    } catch (error: any) {
      message = error?.message ?? String(error);
    }

    if (status === "uploaded" || status === "skipped") {
      out.sent += 1;
    } else {
      out.failed += 1;
      await (prisma as any).shipment
        .updateMany({
          where: { id: shipment.id, delrSentAt: null },
          data: { delrStatus: "ERROR", delrError: message ?? "DELR retry failed" },
        })
        .catch(() => undefined);
    }
    out.results.push({ shipmentId: shipment.id, galaxusOrderId, status, message });
  }

  return out;
}
