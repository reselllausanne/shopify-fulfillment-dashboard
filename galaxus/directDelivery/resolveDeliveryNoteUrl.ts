import "server-only";

import { DocumentType } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { DocumentService } from "@/galaxus/documents/DocumentService";

/**
 * Latest DELIVERY_NOTE document URL for a shipment.
 * Generates one when Galaxus flagged physicalDeliveryNoteRequired but doc missing.
 */
export async function resolveDeliveryNoteUrlForShipment(
  shipmentId: string,
  options?: { generateIfMissing?: boolean }
): Promise<string | null> {
  const id = String(shipmentId ?? "").trim();
  if (!id) return null;

  const existing = await prisma.document.findFirst({
    where: { shipmentId: id, type: DocumentType.DELIVERY_NOTE },
    orderBy: { version: "desc" },
    select: { id: true },
  });
  if (existing?.id) return `/api/galaxus/documents/${existing.id}`;

  if (!options?.generateIfMissing) return null;

  try {
    const documents = await new DocumentService().generateForShipment({
      shipmentId: id,
      types: [DocumentType.DELIVERY_NOTE],
      forceDeliveryNoteFormat: "direct",
    });
    const created =
      documents.find((doc) => doc.type === DocumentType.DELIVERY_NOTE) ?? documents[0] ?? null;
    return created?.id ? `/api/galaxus/documents/${created.id}` : null;
  } catch (err) {
    console.error("[GALAXUS][DIRECT] Delivery note resolve/generate failed", {
      shipmentId: id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function resolveDirectDeliveryNoteMeta(options: {
  orderDbId: string;
  shipmentId?: string | null;
}): Promise<{
  physicalDeliveryNoteRequired: boolean;
  deliveryNoteUrl: string | null;
}> {
  const order = await prisma.galaxusOrder.findFirst({
    where: { id: options.orderDbId },
    select: { physicalDeliveryNoteRequired: true },
  });
  const physicalDeliveryNoteRequired = Boolean(order?.physicalDeliveryNoteRequired);
  if (!physicalDeliveryNoteRequired) {
    return { physicalDeliveryNoteRequired: false, deliveryNoteUrl: null };
  }
  const shipmentId = String(options.shipmentId ?? "").trim();
  if (!shipmentId) {
    return { physicalDeliveryNoteRequired: true, deliveryNoteUrl: null };
  }
  const deliveryNoteUrl = await resolveDeliveryNoteUrlForShipment(shipmentId, {
    generateIfMissing: true,
  });
  return { physicalDeliveryNoteRequired: true, deliveryNoteUrl };
}
