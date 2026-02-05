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
  payloadJson?: unknown;
}) {
  await prisma.galaxusEdiFile.upsert({
    where: { filename: options.filename },
    create: {
      filename: options.filename,
      direction: options.direction,
      docType: options.docType,
      status: options.status,
      orderId: options.orderId,
      orderRef: options.orderRef,
      errorMessage: options.message ?? null,
      payloadJson: options.payloadJson ?? undefined,
      processedAt: options.status === "processed" ? new Date() : null,
    },
    update: {
      status: options.status,
      orderId: options.orderId,
      orderRef: options.orderRef,
      errorMessage: options.message ?? null,
      payloadJson: options.payloadJson ?? undefined,
      processedAt: options.status === "processed" ? new Date() : null,
    },
  });
}
