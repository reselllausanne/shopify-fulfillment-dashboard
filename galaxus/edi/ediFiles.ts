import { prisma } from "@/app/lib/prisma";
import type { EdiDocType } from "./filenames";

export async function upsertEdiFile(options: {
  filename: string;
  direction: "IN" | "OUT";
  docType: EdiDocType;
  status: string;
  message?: string;
  orderId?: string;
  orderRef?: string;
  shipmentId?: string;
  payloadJson?: unknown;
}) {
  if (options.shipmentId) {
    const existingByShipment = await (prisma as any).galaxusEdiFile.findFirst({
      where: {
        shipmentId: options.shipmentId,
        direction: options.direction,
        docType: options.docType,
      },
      select: { id: true },
    });
    if (existingByShipment?.id) {
      await (prisma as any).galaxusEdiFile.update({
        where: { id: existingByShipment.id },
        data: {
          filename: options.filename,
          status: options.status,
          orderId: options.orderId,
          orderRef: options.orderRef,
          shipmentId: options.shipmentId,
          errorMessage: options.message ?? null,
          payloadJson: options.payloadJson ?? undefined,
          processedAt: options.status === "processed" ? new Date() : null,
        },
      });
      return;
    }
  }

  await (prisma as any).galaxusEdiFile.upsert({
    where: { filename: options.filename },
    create: {
      filename: options.filename,
      direction: options.direction,
      docType: options.docType,
      status: options.status,
      orderId: options.orderId,
      orderRef: options.orderRef,
      shipmentId: options.shipmentId,
      errorMessage: options.message ?? null,
      payloadJson: options.payloadJson ?? undefined,
      processedAt: options.status === "processed" ? new Date() : null,
    },
    update: {
      status: options.status,
      orderId: options.orderId,
      orderRef: options.orderRef,
      shipmentId: options.shipmentId,
      errorMessage: options.message ?? null,
      payloadJson: options.payloadJson ?? undefined,
      processedAt: options.status === "processed" ? new Date() : null,
    },
  });
}
