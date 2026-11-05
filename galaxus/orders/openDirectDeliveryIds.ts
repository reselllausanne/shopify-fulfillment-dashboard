import { prisma } from "@/app/lib/prisma";

/**
 * Direct-delivery orders that still have a line to ship.
 * One indexed query. The list used to pull every active order (fulfilled
 * included, ~2k) in 500-row pages, so older open orders never painted and
 * the page stayed slow.
 *
 * A line stays open when it is not warehouse-marked shipped and finalized
 * shipment items (DELR uploaded) do not cover its quantity. GTIN match is
 * digit-normalized. Shipped orders stay on the Fulfilled tab.
 */
const OPEN_DIRECT_DELIVERY_SQL = `
SELECT o.id
FROM "GalaxusOrder" o
WHERE o."deliveryType" = 'direct_delivery'
  AND o."archivedAt" IS NULL
  AND o."cancelledAt" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "GalaxusOrderLine" l
    WHERE l."orderId" = o.id
      AND COALESCE(l.quantity, 0) > 0
      AND l."warehouseMarkedShippedAt" IS NULL
      AND COALESCE(l.quantity, 0) > COALESCE((
        SELECT SUM(si.quantity)
        FROM "ShipmentItem" si
        INNER JOIN "Shipment" s ON s.id = si."shipmentId"
        WHERE si."orderId" = o.id
          AND (s."delrSentAt" IS NOT NULL OR s."delrStatus"::text = 'UPLOADED')
          AND length(regexp_replace(COALESCE(l.gtin, ''), '[^0-9]', '', 'g')) > 0
          AND right(lpad(regexp_replace(COALESCE(si.gtin14, ''), '[^0-9]', '', 'g'), 14, '0'), 14)
            = right(lpad(regexp_replace(COALESCE(l.gtin, ''), '[^0-9]', '', 'g'), 14, '0'), 14)
      ), 0)
  )
ORDER BY o."orderDate" DESC, o.id DESC
`;

export async function listOpenDirectDeliveryOrderIds(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(OPEN_DIRECT_DELIVERY_SQL);
  return rows.map((row) => String(row.id));
}
