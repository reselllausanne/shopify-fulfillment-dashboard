import type { GalaxusOrderLine } from "@prisma/client";

type PackedItem = {
  line: GalaxusOrderLine;
  quantity: number;
};

export type PackedShipment = {
  items: PackedItem[];
  totalQuantity: number;
};

type PackOptions = {
  maxPairsPerParcel?: number;
  allowSplit?: boolean;
};

export function packOrderLines(
  lines: GalaxusOrderLine[],
  options: PackOptions = {}
): PackedShipment[] {
  const maxPairs = Math.max(1, options.maxPairsPerParcel ?? 12);
  const allowSplit = options.allowSplit ?? true;
  const shipments: PackedShipment[] = [];

  for (const line of lines) {
    let remaining = Math.max(1, line.quantity);

    if (!allowSplit && remaining > maxPairs) {
      throw new Error(`Line ${line.lineNumber} exceeds max pairs per parcel`);
    }

    if (remaining <= maxPairs) {
      const target = findShipmentWithCapacity(shipments, maxPairs, remaining, false);
      if (target) {
        target.items.push({ line, quantity: remaining });
        target.totalQuantity += remaining;
        continue;
      }
    }

    while (remaining > 0) {
      const target =
        findShipmentWithCapacity(shipments, maxPairs, remaining, allowSplit) ??
        createEmptyShipment(shipments);
      const capacity = maxPairs - target.totalQuantity;
      const quantity = allowSplit ? Math.min(remaining, capacity) : Math.min(remaining, maxPairs);

      target.items.push({ line, quantity });
      target.totalQuantity += quantity;
      remaining -= quantity;
    }
  }

  return shipments;
}

function findShipmentWithCapacity(
  shipments: PackedShipment[],
  maxPairs: number,
  remaining: number,
  allowSplit: boolean
): PackedShipment | null {
  for (const shipment of shipments) {
    const capacity = maxPairs - shipment.totalQuantity;
    if (capacity <= 0) continue;
    if (!allowSplit && remaining > capacity) continue;
    return shipment;
  }
  return null;
}

function createEmptyShipment(shipments: PackedShipment[]) {
  const created: PackedShipment = { items: [], totalQuantity: 0 };
  shipments.push(created);
  return created;
}
