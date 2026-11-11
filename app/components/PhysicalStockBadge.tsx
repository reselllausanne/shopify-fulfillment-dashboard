import React from "react";
import { isGalaxus48hShipLocation } from "@/galaxus/warehouse/delivery48h";
import {
  formatPhysicalStockLabel,
  type OrderLinePhysicalStock,
} from "@/shopify/inventory/orderLinePhysicalStock.types";

type Props = {
  physicalStock?: OrderLinePhysicalStock | null;
  /** When true, show “avoid StockX buy” hint (marketplace order lines). */
  avoidStockxHint?: boolean;
  className?: string;
};

export function PhysicalStockBadge({
  physicalStock,
  avoidStockxHint = false,
  className = "",
}: Props) {
  const label = formatPhysicalStockLabel(physicalStock);
  if (!label) return null;
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-green-600 text-white shrink-0 ${className}`}
      title={avoidStockxHint ? `${label} — ship from warehouse, do not buy on StockX` : label}
    >
      {label}
      {avoidStockxHint ? " · no StockX" : ""}
    </span>
  );
}

/** Bussigny 1030 on-hand. Galaxus route promises ~48h, so this unit ships now. */
export function ShipAsap48hBadge({
  physicalStock,
}: {
  physicalStock?: { locationId?: string | null; locationName?: string | null } | null;
}) {
  if (!isGalaxus48hShipLocation(physicalStock)) return null;
  return (
    <span
      className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-red-600 text-white shrink-0"
      title="In stock at Warehouse Bussigny (1030). Galaxus 48h route. Ship now."
    >
      48h ship now
    </span>
  );
}

export function PhysicalStockHintText({
  physicalStock,
  avoidStockxHint = false,
}: {
  physicalStock?: OrderLinePhysicalStock | null;
  avoidStockxHint?: boolean;
}) {
  const label = formatPhysicalStockLabel(physicalStock);
  if (!label) return null;
  return (
    <div className="text-[11px] text-green-800 font-medium">
      {label}
      {avoidStockxHint ? " · avoid StockX buy" : ""}
    </div>
  );
}

export function ShopifyPickupBadge({
  isStorePickup,
  label,
  locationName,
}: {
  isStorePickup?: boolean | null;
  label?: string | null;
  locationName?: string | null;
}) {
  if (!isStorePickup) return null;
  const text = label ?? (locationName ? `Pickup · ${locationName}` : "Store pickup");
  return (
    <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold bg-teal-700 text-white shrink-0">
      {text}
    </span>
  );
}
