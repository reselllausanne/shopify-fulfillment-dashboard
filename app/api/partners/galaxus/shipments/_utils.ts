import { prisma } from "@/app/lib/prisma";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";

export async function loadPartnerShipment(shipmentId: string, providerKey: string) {
  const shipment = await (prisma as any).shipment.findUnique({
    where: { id: shipmentId },
    include: { order: true, items: true },
  });
  if (!shipment) return null;
  const shipmentProviderKey = normalizeProviderKey(shipment.providerKey ?? null);
  if (!shipmentProviderKey || shipmentProviderKey !== providerKey) return null;
  return shipment;
}
