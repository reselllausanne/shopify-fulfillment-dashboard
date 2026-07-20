import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { PHYSICAL_LOCATIONS, type LocationConfig } from "@/shopify/inventory/locationConfig";

/**
 * Phase 1 — visibility. Mirror Shopify per-location inventory into
 * ShopifyVariantLocationStock so the DB/marketplace side can see physical stock
 * per location. Shopify remains the master; this never writes to Shopify.
 *
 * Method: page each location's inventoryLevels, keep rows with available > 0,
 * upsert them, and zero-out previously-stocked rows no longer present (sold out).
 * Discovers stock entered any way (admin transfer, POS page, scanner).
 */

const LOCATION_LEVELS_QUERY = /* GraphQL */ `
query LocationLevels($loc: ID!, $cur: String) {
  location(id: $loc) {
    id
    name
    inventoryLevels(first: 250, after: $cur) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          quantities(names: ["available"]) { name quantity }
          item {
            id
            sku
            variant { id sku barcode }
          }
        }
      }
    }
  }
}
`;

type LevelNode = {
  quantities: Array<{ name: string; quantity: number }> | null;
  item: {
    id: string;
    sku: string | null;
    variant: { id: string; sku: string | null; barcode: string | null } | null;
  } | null;
};

type LocationLevelsResponse = {
  location: {
    inventoryLevels: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: Array<{ node: LevelNode }>;
    };
  } | null;
};

type SeenRow = {
  shopifyVariantId: string;
  inventoryItemId: string;
  sku: string | null;
  gtin: string | null;
  available: number;
};

async function pageLocationLevels(
  location: LocationConfig,
  maxPages: number,
  delayMs: number
): Promise<{ rows: SeenRow[]; pages: number; capped: boolean }> {
  const rows: SeenRow[] = [];
  let cursor: string | null = null;
  let pages = 0;
  let capped = false;

  while (true) {
    const response: { data: LocationLevelsResponse; errors?: Array<{ message: string }> } =
      await shopifyGraphQL<LocationLevelsResponse>(LOCATION_LEVELS_QUERY, {
        loc: location.id,
        cur: cursor,
      });
    const data = response.data;
    const errors = response.errors;

    if (errors?.length) {
      throw new Error(`location levels (${location.name}) failed: ${errors.map((e) => e.message).join("; ")}`);
    }

    const conn = data?.location?.inventoryLevels;
    for (const edge of conn?.edges ?? []) {
      const node = edge.node;
      const variant = node.item?.variant;
      if (!variant?.id || !node.item?.id) continue;
      const available = node.quantities?.find((q) => q.name === "available")?.quantity ?? 0;
      if (available <= 0) continue; // keep only stocked rows
      rows.push({
        shopifyVariantId: variant.id,
        inventoryItemId: node.item.id,
        sku: variant.sku ?? node.item.sku ?? null,
        gtin: variant.barcode ?? null,
        available,
      });
    }

    pages += 1;
    const pageInfo = conn?.pageInfo;
    if (pageInfo?.hasNextPage && pages < maxPages) {
      cursor = pageInfo.endCursor;
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    } else {
      capped = Boolean(pageInfo?.hasNextPage) && pages >= maxPages;
      break;
    }
  }

  return { rows, pages, capped };
}

export type LocationSyncResult = {
  locationName: string;
  sourceType: string;
  stocked: number;
  zeroedOut: number;
  pages: number;
  capped: boolean;
};

export async function syncAllLocations(options: {
  maxPagesPerLocation?: number;
  delayMs?: number;
  locations?: LocationConfig[];
} = {}): Promise<{ ok: boolean; locations: LocationSyncResult[]; ms: number }> {
  const startedAt = Date.now();
  const maxPages = options.maxPagesPerLocation ?? 2000;
  const delayMs = options.delayMs ?? 150;
  // Physical locations only by default: dropship (online) qty already lives in
  // SupplierVariant, and paging ~18k online rows every run is wasteful.
  const targetLocations = options.locations ?? PHYSICAL_LOCATIONS;
  const results: LocationSyncResult[] = [];

  for (const location of targetLocations) {
    const { rows, pages, capped } = await pageLocationLevels(location, maxPages, delayMs);
    const now = new Date();

    // Upsert every stocked row for this location.
    for (const row of rows) {
      await prisma.$executeRaw`
        INSERT INTO "public"."ShopifyVariantLocationStock" (
          "id", "shopifyVariantId", "inventoryItemId", "sku", "gtin",
          "locationId", "locationName", "sourceType", "priority", "available",
          "lastSeenAt", "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid(), ${row.shopifyVariantId}, ${row.inventoryItemId}, ${row.sku}, ${row.gtin},
          ${location.id}, ${location.name}, ${location.sourceType}, ${location.priority}, ${row.available},
          ${now}, ${now}, ${now}
        )
        ON CONFLICT ("shopifyVariantId", "locationId") DO UPDATE SET
          "inventoryItemId" = EXCLUDED."inventoryItemId",
          "sku"             = COALESCE(EXCLUDED."sku", "ShopifyVariantLocationStock"."sku"),
          "gtin"            = COALESCE(EXCLUDED."gtin", "ShopifyVariantLocationStock"."gtin"),
          "locationName"    = EXCLUDED."locationName",
          "sourceType"      = EXCLUDED."sourceType",
          "priority"        = EXCLUDED."priority",
          "available"       = EXCLUDED."available",
          "lastSeenAt"      = EXCLUDED."lastSeenAt",
          "updatedAt"       = EXCLUDED."updatedAt"
      `;
    }

    // Zero-out rows previously stocked at this location but no longer seen
    // (sold out / transferred away). Keeps a 0 row rather than deleting so the
    // sell-out transition is observable by the convergence job later.
    const seenIds = rows.map((r) => r.shopifyVariantId);
    let zeroedOut = 0;
    if (seenIds.length > 0) {
      zeroedOut = await prisma.$executeRaw`
        UPDATE "public"."ShopifyVariantLocationStock"
        SET "available" = 0, "lastSeenAt" = ${now}, "updatedAt" = ${now}
        WHERE "locationId" = ${location.id}
          AND "available" > 0
          AND "shopifyVariantId" != ALL(${seenIds}::text[])
      `;
    } else {
      zeroedOut = await prisma.$executeRaw`
        UPDATE "public"."ShopifyVariantLocationStock"
        SET "available" = 0, "lastSeenAt" = ${now}, "updatedAt" = ${now}
        WHERE "locationId" = ${location.id} AND "available" > 0
      `;
    }

    results.push({
      locationName: location.name,
      sourceType: location.sourceType,
      stocked: rows.length,
      zeroedOut,
      pages,
      capped,
    });
  }

  return { ok: true, locations: results, ms: Date.now() - startedAt };
}
