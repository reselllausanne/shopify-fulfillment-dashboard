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

// Page size kept small: physical locations carry many qty-0 activated levels
// (main.py activates every secondary location on variant create), and a large
// `first` inflates the GraphQL query cost and trips Shopify throttling.
const LEVELS_PAGE_SIZE = 100;

const LOCATION_LEVELS_QUERY = /* GraphQL */ `
query LocationLevels($loc: ID!, $cur: String, $n: Int!) {
  location(id: $loc) {
    id
    name
    inventoryLevels(first: $n, after: $cur) {
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

function isThrottled(errors?: Array<{ message: string; extensions?: any }>): boolean {
  if (!errors?.length) return false;
  return errors.some(
    (e) =>
      e?.extensions?.code === "THROTTLED" ||
      /throttl/i.test(e?.message ?? "")
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  let throttleRetries = 0;

  while (true) {
    const response: { data: LocationLevelsResponse; errors?: Array<{ message: string; extensions?: any }> } =
      await shopifyGraphQL<LocationLevelsResponse>(LOCATION_LEVELS_QUERY, {
        loc: location.id,
        cur: cursor,
        n: LEVELS_PAGE_SIZE,
      });
    const data = response.data;
    const errors = response.errors;

    if (isThrottled(errors)) {
      // Back off and retry the SAME cursor; don't advance or error out.
      throttleRetries += 1;
      if (throttleRetries > 12) {
        throw new Error(`location levels (${location.name}) throttled repeatedly; giving up`);
      }
      await sleep(Math.min(2000 * throttleRetries, 15000));
      continue;
    }
    throttleRetries = 0;

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

async function upsertRow(location: LocationConfig, row: SeenRow, now: Date): Promise<void> {
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

async function zeroOutUnseen(location: LocationConfig, seenIds: string[], now: Date): Promise<number> {
  if (seenIds.length > 0) {
    return prisma.$executeRaw`
      UPDATE "public"."ShopifyVariantLocationStock"
      SET "available" = 0, "lastSeenAt" = ${now}, "updatedAt" = ${now}
      WHERE "locationId" = ${location.id}
        AND "available" > 0
        AND "shopifyVariantId" != ALL(${seenIds}::text[])
    `;
  }
  return prisma.$executeRaw`
    UPDATE "public"."ShopifyVariantLocationStock"
    SET "available" = 0, "lastSeenAt" = ${now}, "updatedAt" = ${now}
    WHERE "locationId" = ${location.id} AND "available" > 0
  `;
}

/**
 * Per-location paginated sync. Correct but slow when a physical location carries
 * many qty-0 activated levels. Kept for targeted single-location refreshes (the
 * future 15-min fast path over the small known-stocked set). For a full catalog
 * reconcile prefer `syncAllLocationsBulk`.
 */
export async function syncAllLocations(options: {
  maxPagesPerLocation?: number;
  delayMs?: number;
  locations?: LocationConfig[];
} = {}): Promise<{ ok: boolean; locations: LocationSyncResult[]; ms: number }> {
  const startedAt = Date.now();
  const maxPages = options.maxPagesPerLocation ?? 4000;
  const delayMs = options.delayMs ?? 700;
  const targetLocations = options.locations ?? PHYSICAL_LOCATIONS;
  const results: LocationSyncResult[] = [];

  for (const location of targetLocations) {
    const { rows, pages, capped } = await pageLocationLevels(location, maxPages, delayMs);
    const now = new Date();
    for (const row of rows) await upsertRow(location, row, now);
    const zeroedOut = await zeroOutUnseen(location, rows.map((r) => r.shopifyVariantId), now);
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

// ---------------------------------------------------------------------------
// Bulk Operation sync — the scalable full-catalog reconcile.
//
// Shopify runs the query server-side and returns a JSONL export, so there is no
// per-page throttling and the qty-0 level pollution no longer matters. We stream
// the JSONL, keep only physical-location rows with available > 0, and upsert.
// ---------------------------------------------------------------------------

const BULK_INVENTORY_QUERY = `
{
  productVariants {
    edges {
      node {
        id
        sku
        barcode
        inventoryItem {
          id
          inventoryLevels {
            edges {
              node {
                location { id }
                quantities(names: ["available"]) { name quantity }
              }
            }
          }
        }
      }
    }
  }
}
`;

const BULK_RUN_MUTATION = /* GraphQL */ `
mutation BulkRun($query: String!) {
  bulkOperationRunQuery(query: $query) {
    bulkOperation { id status }
    userErrors { field message }
  }
}
`;

const BULK_POLL_QUERY = /* GraphQL */ `
query BulkPoll {
  currentBulkOperation {
    id
    status
    errorCode
    objectCount
    url
  }
}
`;

async function startBulkOperation(): Promise<void> {
  const { data, errors } = await shopifyGraphQL<{
    bulkOperationRunQuery: {
      bulkOperation: { id: string; status: string } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(BULK_RUN_MUTATION, { query: BULK_INVENTORY_QUERY });
  if (errors?.length) throw new Error(`bulk start failed: ${errors.map((e) => e.message).join("; ")}`);
  const ue = data?.bulkOperationRunQuery?.userErrors ?? [];
  if (ue.length) throw new Error(`bulk start userErrors: ${ue.map((e) => e.message).join("; ")}`);
}

async function pollBulkOperation(timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data } = await shopifyGraphQL<{
      currentBulkOperation: {
        status: string;
        errorCode: string | null;
        objectCount: string | null;
        url: string | null;
      } | null;
    }>(BULK_POLL_QUERY);
    const op = data?.currentBulkOperation;
    if (op?.status === "COMPLETED") {
      if (!op.url) throw new Error("bulk completed with no url (empty result)");
      return op.url;
    }
    if (op && ["FAILED", "CANCELED", "EXPIRED"].includes(op.status)) {
      throw new Error(`bulk operation ${op.status}: ${op.errorCode ?? "unknown"}`);
    }
    await sleep(3000);
  }
  throw new Error("bulk operation timed out");
}

export async function syncAllLocationsBulk(options: { timeoutMs?: number } = {}): Promise<{
  ok: boolean;
  locations: LocationSyncResult[];
  variantsSeen: number;
  ms: number;
}> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;

  const physicalIds = new Set(PHYSICAL_LOCATIONS.map((l) => l.id));

  await startBulkOperation();
  const url = await pollBulkOperation(timeoutMs);

  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`bulk download failed: HTTP ${res.status}`);

  // Stream JSONL line-by-line. Parent (variant) lines precede their child
  // inventory-level lines. In bulk exports an inventory-level's __parentId is
  // the ProductVariant id (the inline `inventoryItem` is NOT a separate node),
  // so we key the map by variant id.
  const variantById = new Map<
    string,
    { variantId: string; inventoryItemId: string; sku: string | null; gtin: string | null }
  >();
  const seenByLocation = new Map<string, Set<string>>();
  for (const l of PHYSICAL_LOCATIONS) seenByLocation.set(l.id, new Set());

  const now = new Date();
  let variantsSeen = 0;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleLine = async (line: string) => {
    if (!line.trim()) return;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      return;
    }
    // Variant line: has a ProductVariant id and inline inventoryItem. Index by
    // BOTH ids so an inventory-level's __parentId resolves whether Shopify sets
    // it to the variant id or the inventoryItem id.
    if (typeof obj.id === "string" && obj.id.includes("/ProductVariant/")) {
      variantsSeen += 1;
      const info = {
        variantId: obj.id,
        inventoryItemId: obj.inventoryItem?.id ?? "",
        sku: obj.sku ?? null,
        gtin: obj.barcode ?? null,
      };
      variantById.set(obj.id, info);
      if (info.inventoryItemId) variantById.set(info.inventoryItemId, info);
      return;
    }
    // Inventory-level line: __parentId = ProductVariant id, plus location.
    if (obj.__parentId && obj.location?.id) {
      const locId = obj.location.id;
      if (!physicalIds.has(locId)) return;
      const available = Array.isArray(obj.quantities)
        ? obj.quantities.find((q: any) => q.name === "available")?.quantity ?? 0
        : 0;
      if (available <= 0) return;
      const variant = variantById.get(obj.__parentId);
      if (!variant) return;
      const location = PHYSICAL_LOCATIONS.find((l) => l.id === locId)!;
      await upsertRow(location, {
        shopifyVariantId: variant.variantId,
        inventoryItemId: variant.inventoryItemId,
        sku: variant.sku,
        gtin: variant.gtin,
        available,
      }, now);
      seenByLocation.get(locId)!.add(variant.variantId);
    }
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      await handleLine(line);
    }
  }
  if (buffer.trim()) await handleLine(buffer);

  const results: LocationSyncResult[] = [];
  for (const location of PHYSICAL_LOCATIONS) {
    const seen = Array.from(seenByLocation.get(location.id) ?? []);
    const zeroedOut = await zeroOutUnseen(location, seen, now);
    results.push({
      locationName: location.name,
      sourceType: location.sourceType,
      stocked: seen.length,
      zeroedOut,
      pages: 0,
      capped: false,
    });
  }

  return { ok: true, locations: results, variantsSeen, ms: Date.now() - startedAt };
}
