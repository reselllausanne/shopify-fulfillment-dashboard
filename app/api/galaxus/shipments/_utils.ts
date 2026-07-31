import { prisma } from "@/app/lib/prisma";

type ShipmentPlacement = {
  id: string;
  supplierOrderRef: string | null;
  status: string | null;
};


let shipmentPlacementColumnsCache: boolean | null = null;

async function shipmentPlacementColumnsExist() {
  if (shipmentPlacementColumnsCache != null) return shipmentPlacementColumnsCache;
  const rows = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Shipment'
      AND column_name IN ('supplierOrderRef', 'status')
  `;
  const set = new Set(rows.map((row) => row.column_name));
  shipmentPlacementColumnsCache = set.has("supplierOrderRef") && set.has("status");
  return shipmentPlacementColumnsCache;
}

export async function getShipmentPlacementByOrder(orderId: string): Promise<Map<string, ShipmentPlacement>> {
  if (!(await shipmentPlacementColumnsExist())) {
    return new Map();
  }
  const rows = await prisma.$queryRaw<ShipmentPlacement[]>`
    SELECT "id", "supplierOrderRef", "status"
    FROM "Shipment"
    WHERE "orderId" = ${orderId}
  `;
  return new Map(rows.map((row) => [row.id, row]));
}

