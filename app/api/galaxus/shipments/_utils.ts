import { prisma } from "@/app/lib/prisma";

type ShipmentPlacement = {
  id: string;
  supplierOrderRef: string | null;
  status: string | null;
};

export async function ensureShipmentPlacementColumns() {
  await prisma.$executeRaw`ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "supplierOrderRef" TEXT`;
  await prisma.$executeRaw`ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "status" TEXT`;
}

async function shipmentPlacementColumnsExist() {
  const rows = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Shipment'
      AND column_name IN ('supplierOrderRef', 'status')
  `;
  const set = new Set(rows.map((row) => row.column_name));
  return set.has("supplierOrderRef") && set.has("status");
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

export async function getShipmentPlacementById(shipmentId: string): Promise<ShipmentPlacement | null> {
  if (!(await shipmentPlacementColumnsExist())) {
    return null;
  }
  const rows = await prisma.$queryRaw<ShipmentPlacement[]>`
    SELECT "id", "supplierOrderRef", "status"
    FROM "Shipment"
    WHERE "id" = ${shipmentId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function updateShipmentPlacement(
  shipmentId: string,
  supplierOrderRef: string | null,
  status: string | null
) {
  await prisma.$executeRaw`
    UPDATE "Shipment"
    SET "supplierOrderRef" = ${supplierOrderRef},
        "status" = ${status}
    WHERE "id" = ${shipmentId}
  `;
}
