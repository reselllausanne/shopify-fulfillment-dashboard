import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";

export type DirectDeliveryFulfillmentState = "to_process" | "fulfilled";

function directDeliveryFulfilledSql() {
  return Prisma.sql`
    (
      SELECT COUNT(*)::int FROM "Shipment" s
      WHERE s."orderId" = o.id AND s."delrSentAt" IS NOT NULL
    ) >= (
      SELECT COUNT(*)::int FROM "GalaxusOrderLine" l WHERE l."orderId" = o.id
    )
    AND (
      SELECT COUNT(*)::int FROM "GalaxusOrderLine" l WHERE l."orderId" = o.id
    ) > 0
  `;
}

function viewFilterSql(view: "active" | "history" | "all") {
  if (view === "history") {
    return Prisma.sql`(o."archivedAt" IS NOT NULL OR o."cancelledAt" IS NOT NULL)`;
  }
  if (view === "active") {
    return Prisma.sql`(o."archivedAt" IS NULL AND o."cancelledAt" IS NULL)`;
  }
  return Prisma.sql`TRUE`;
}

function searchFilterSql(q: string) {
  const term = q.trim();
  if (!term) return Prisma.sql`TRUE`;
  const pattern = `%${term}%`;
  return Prisma.sql`(
    o."galaxusOrderId" ILIKE ${pattern}
    OR o."orderNumber" ILIKE ${pattern}
    OR EXISTS (
      SELECT 1 FROM "GalaxusOrderLine" l
      WHERE l."orderId" = o.id
        AND (
          l."gtin" ILIKE ${pattern}
          OR l."supplierSku" ILIKE ${pattern}
          OR l."productName" ILIKE ${pattern}
          OR l."description" ILIKE ${pattern}
          OR l."supplierPid" ILIKE ${pattern}
        )
    )
  )`;
}

function supplierScopeFilterSql(supplierScope?: string) {
  if (supplierScope !== "stx") return Prisma.sql`TRUE`;
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "GalaxusOrderLine" l
    WHERE l."orderId" = o.id
      AND (
        l."supplierPid" ILIKE 'stx_%'
        OR l."supplierVariantId" ILIKE 'stx_%'
        OR l."providerKey" ILIKE 'stx_%'
        OR UPPER(l."providerKey") = 'STX'
      )
  )`;
}

/** Paginated direct-delivery order ids filtered by fulfillment tab (matches list API logic). */
export async function fetchDirectDeliveryOrderIdsForList(opts: {
  fulfillmentState: DirectDeliveryFulfillmentState;
  view: "active" | "history" | "all";
  q?: string;
  limit: number;
  offset: number;
  sort: "orderdate" | "createdat";
  supplierScope?: string;
}): Promise<{ ids: string[]; nextOffset: number | null }> {
  const limit = Math.max(1, Math.min(opts.limit, 500));
  const offset = Math.max(0, opts.offset);
  const fulfilled = directDeliveryFulfilledSql();
  const stateCond =
    opts.fulfillmentState === "fulfilled" ? fulfilled : Prisma.sql`NOT (${fulfilled})`;
  const orderBy =
    opts.sort === "orderdate"
      ? Prisma.sql`o."orderDate" DESC`
      : Prisma.sql`o."createdAt" DESC`;

  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT o.id
    FROM "GalaxusOrder" o
    WHERE o."deliveryType" = 'direct_delivery'
      AND ${stateCond}
      AND ${viewFilterSql(opts.view)}
      AND ${searchFilterSql(opts.q ?? "")}
      AND ${supplierScopeFilterSql(opts.supplierScope)}
    ORDER BY ${orderBy}
    LIMIT ${limit + 1}
    OFFSET ${offset}
  `);

  const hasMore = rows.length > limit;
  const ids = rows.slice(0, limit).map((row) => row.id);
  return {
    ids,
    nextOffset: hasMore ? offset + limit : null,
  };
}
