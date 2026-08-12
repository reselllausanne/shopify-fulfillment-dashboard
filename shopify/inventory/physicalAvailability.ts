import { prisma } from "@/app/lib/prisma";
import { cleanGtin, gtinCandidates } from "@/shopify/restock/gtinNormalize";

/**
 * Phase 2 — availability resolver (physical side).
 *
 * Reads ShopifyVariantLocationStock (Phase 1 mirror) and returns per-GTIN
 * physical stock the marketplace feeds should ADD to the STX dropship qty.
 *
 * Model reminder:
 *   effectiveMarketplaceStock(gtin) = dropshipStock(STX asks/cap) + Σ physical(gtin)
 *
 * Physical stock lives on ONE main Shopify product per shoe, split across
 * physical locations (Bussigny, Antica, Lab, COLD BIEN). Dropship = Chemin de Bas-de-
 * Plan (online), which we intentionally EXCLUDE here — dropship qty already
 * flows through the STX supplier path (asks cap etc.), so summing the online
 * mirror row would double-count.
 *
 * Zero-count semantics: a missing key = 0. Never returns negatives.
 * GTIN lookups are padding-tolerant (UPC-A / EAN-13 / GTIN-14 leading zeros).
 *
 * Feature-flag gate: callers should only merge when `RESOLVER_MERGE_PHYSICAL`
 * is enabled, so we can ship code first, verify with a diff, and cut over
 * after the THE_ purge migration lands.
 */

/** Digits-only GTIN with leading zeros stripped — used to merge padded aliases. */
function gtinNormKey(raw: string): string {
  const clean = cleanGtin(raw);
  if (!clean) return "";
  return clean.replace(/^0+/, "") || "0";
}

function expandGtinQuerySet(gtins: string[]): {
  requested: string[];
  candidates: string[];
} {
  const requested = Array.from(
    new Set(gtins.map((g) => String(g ?? "").trim()).filter((g) => g.length > 0))
  );
  const candidates = Array.from(
    new Set(requested.flatMap((g) => gtinCandidates(g)))
  );
  return { requested, candidates };
}

const FLAG_ENV = "RESOLVER_MERGE_PHYSICAL";

export function isPhysicalMergeEnabled(): boolean {
  const v = (process.env[FLAG_ENV] ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export type PhysicalStockRow = {
  qty: number;
  /** Highest-priority (lowest number) location holding stock. Bussigny=1 wins. */
  preferredLocationId: string | null;
  preferredLocationName: string | null;
};

export type PhysicalLocationStockRow = {
  shopifyVariantId: string;
  inventoryItemId: string;
  sku: string | null;
  gtin: string;
  locationId: string;
  locationName: string;
  priority: number;
  available: number;
};

export type PhysicalStockMap = Map<string, PhysicalStockRow>;

/**
 * Batch load physical availability keyed by GTIN.
 *
 * Only rows with `sourceType='physical'` and `available > 0` are aggregated.
 * Empty input → empty map (single trip avoided).
 *
 * Lookup is padding-tolerant: requesting `196…` also finds mirror rows stored
 * as `0196…` / `00196…`. Results are keyed by each *requested* GTIN (and by
 * the stored mirror GTIN forms found) so callers can `.get(inputGtin)`.
 */
export async function loadPhysicalMirrorStockByGtin(gtins: string[]): Promise<PhysicalStockMap> {
  const { requested, candidates } = expandGtinQuerySet(gtins);
  const out: PhysicalStockMap = new Map();
  if (candidates.length === 0) return out;

  const rows = await prisma.$queryRaw<
    Array<{ gtin: string; qty: bigint; loc_id: string | null; loc_name: string | null }>
  >`
    SELECT
      s."gtin"                                       AS gtin,
      SUM(s."available")::bigint                     AS qty,
      (ARRAY_AGG(s."locationId"   ORDER BY s."priority" ASC))[1] AS loc_id,
      (ARRAY_AGG(s."locationName" ORDER BY s."priority" ASC))[1] AS loc_name
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."sourceType" = 'physical'
      AND s."available"  > 0
      AND s."gtin"       = ANY(${candidates}::text[])
    GROUP BY s."gtin"
  `;

  // Merge padded aliases under one norm key so dual-stored rows never double-count.
  const byNorm = new Map<
    string,
    { qty: number; preferredLocationId: string | null; preferredLocationName: string | null; storeGtins: string[] }
  >();
  for (const r of rows) {
    const stored = String(r.gtin ?? "").trim();
    const qty = Number(r.qty ?? 0);
    if (!stored || qty <= 0) continue;
    const norm = gtinNormKey(stored);
    if (!norm) continue;
    const existing = byNorm.get(norm);
    if (!existing) {
      byNorm.set(norm, {
        qty,
        preferredLocationId: r.loc_id,
        preferredLocationName: r.loc_name,
        storeGtins: [stored],
      });
      continue;
    }
    existing.qty += qty;
    existing.storeGtins.push(stored);
  }

  for (const g of requested) {
    const row = byNorm.get(gtinNormKey(g));
    if (!row || row.qty <= 0) continue;
    const entry: PhysicalStockRow = {
      qty: row.qty,
      preferredLocationId: row.preferredLocationId,
      preferredLocationName: row.preferredLocationName,
    };
    out.set(g, entry);
    for (const stored of row.storeGtins) out.set(stored, entry);
  }
  return out;
}

/**
 * Convenience: single-GTIN lookup. Prefer the batch version in hot paths.
 */
export async function getPhysicalStockForGtin(gtin: string): Promise<PhysicalStockRow> {
  const m = await loadPhysicalMirrorStockByGtin([gtin]);
  return (
    m.get(gtin) ??
    m.get(gtinNormKey(gtin)) ?? {
      qty: 0,
      preferredLocationId: null,
      preferredLocationName: null,
    }
  );
}

/**
 * All GTINs with physical location stock > 0 (Bussigny / Antica / Lab / COLD BIEN).
 * Excludes online/dropship location.
 */
export async function loadAllPhysicalMirrorStockByGtin(): Promise<PhysicalStockMap> {
  const out: PhysicalStockMap = new Map();
  const rows = await prisma.$queryRaw<
    Array<{ gtin: string; qty: bigint; loc_id: string | null; loc_name: string | null }>
  >`
    SELECT
      s."gtin"                                       AS gtin,
      SUM(s."available")::bigint                     AS qty,
      (ARRAY_AGG(s."locationId"   ORDER BY s."priority" ASC))[1] AS loc_id,
      (ARRAY_AGG(s."locationName" ORDER BY s."priority" ASC))[1] AS loc_name
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."sourceType" = 'physical'
      AND s."available"  > 0
      AND s."gtin" IS NOT NULL
      AND TRIM(s."gtin") <> ''
    GROUP BY s."gtin"
  `;

  for (const r of rows) {
    const gtin = String(r.gtin ?? "").trim();
    const qty = Number(r.qty ?? 0);
    if (!gtin || qty <= 0) continue;
    out.set(gtin, {
      qty,
      preferredLocationId: r.loc_id,
      preferredLocationName: r.loc_name,
    });
  }
  return out;
}

/**
 * GTINs stocked at every required physical location. Quantity includes only the
 * required locations, never another physical-location balance.
 */
export async function loadPhysicalMirrorStockByGtinAtEveryLocation(
  requiredLocationIds: string[]
): Promise<PhysicalStockMap> {
  const locationIds = Array.from(
    new Set(requiredLocationIds.map((id) => String(id ?? "").trim()).filter(Boolean))
  );
  const out: PhysicalStockMap = new Map();
  if (locationIds.length === 0) return out;

  const rows = await prisma.$queryRaw<
    Array<{ gtin: string; qty: bigint; loc_id: string | null; loc_name: string | null }>
  >`
    SELECT
      s."gtin"                                       AS gtin,
      SUM(s."available")::bigint                     AS qty,
      (ARRAY_AGG(s."locationId"   ORDER BY s."priority" ASC))[1] AS loc_id,
      (ARRAY_AGG(s."locationName" ORDER BY s."priority" ASC))[1] AS loc_name
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."sourceType" = 'physical'
      AND s."available"  > 0
      AND s."locationId" = ANY(${locationIds}::text[])
      AND s."gtin" IS NOT NULL
      AND TRIM(s."gtin") <> ''
    GROUP BY s."gtin"
    HAVING COUNT(DISTINCT s."locationId") = ${locationIds.length}
  `;

  for (const row of rows) {
    const gtin = String(row.gtin ?? "").trim();
    const qty = Number(row.qty ?? 0);
    if (!gtin || qty <= 0) continue;
    out.set(gtin, {
      qty,
      preferredLocationId: row.loc_id,
      preferredLocationName: row.loc_name,
    });
  }
  return out;
}

/**
 * GTINs with stock > 0 at any of the given physical locations.
 * Quantity sums only those locations (excludes Antica / other physical).
 */
export async function loadPhysicalMirrorStockByGtinAtAnyLocation(
  allowedLocationIds: string[]
): Promise<PhysicalStockMap> {
  const locationIds = Array.from(
    new Set(allowedLocationIds.map((id) => String(id ?? "").trim()).filter(Boolean))
  );
  const out: PhysicalStockMap = new Map();
  if (locationIds.length === 0) return out;

  const rows = await prisma.$queryRaw<
    Array<{ gtin: string; qty: bigint; loc_id: string | null; loc_name: string | null }>
  >`
    SELECT
      s."gtin"                                       AS gtin,
      SUM(s."available")::bigint                     AS qty,
      (ARRAY_AGG(s."locationId"   ORDER BY s."priority" ASC))[1] AS loc_id,
      (ARRAY_AGG(s."locationName" ORDER BY s."priority" ASC))[1] AS loc_name
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."sourceType" = 'physical'
      AND s."available"  > 0
      AND s."locationId" = ANY(${locationIds}::text[])
      AND s."gtin" IS NOT NULL
      AND TRIM(s."gtin") <> ''
    GROUP BY s."gtin"
  `;

  for (const row of rows) {
    const gtin = String(row.gtin ?? "").trim();
    const qty = Number(row.qty ?? 0);
    if (!gtin || qty <= 0) continue;
    out.set(gtin, {
      qty,
      preferredLocationId: row.loc_id,
      preferredLocationName: row.loc_name,
    });
  }
  return out;
}

/**
 * Per-location mirror rows for a GTIN, priority order (Bussigny first).
 * Used by marketplace sale routing to decrement the correct shop.
 * Padding-tolerant (same candidate set as batch physical load).
 */
export async function loadPhysicalMirrorLocationRowsByGtin(
  gtin: string
): Promise<PhysicalLocationStockRow[]> {
  const candidates = gtinCandidates(gtin);
  if (candidates.length === 0) return [];

  const rows = await prisma.$queryRaw<
    Array<{
      shopifyVariantId: string;
      inventoryItemId: string;
      sku: string | null;
      gtin: string;
      locationId: string;
      locationName: string;
      priority: number;
      available: number;
    }>
  >`
    SELECT
      s."shopifyVariantId",
      s."inventoryItemId",
      s."sku",
      s."gtin",
      s."locationId",
      s."locationName",
      s."priority",
      s."available"
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."sourceType" = 'physical'
      AND s."available"  > 0
      AND s."gtin"       = ANY(${candidates}::text[])
    ORDER BY s."priority" ASC, s."available" DESC
  `;

  return rows.map((r) => ({
    shopifyVariantId: r.shopifyVariantId,
    inventoryItemId: r.inventoryItemId,
    sku: r.sku,
    gtin: r.gtin,
    locationId: r.locationId,
    locationName: r.locationName,
    priority: Number(r.priority ?? 99),
    available: Number(r.available ?? 0),
  }));
}

/**
 * Merge helper (pure). Applies the physical qty on top of a dropship qty for a
 * marketplace row, with the "keep live if physical>0" override.
 *
 *  - dropshipStock: value AFTER STX ask-cap / express filter / price-cap delist
 *  - physicalQty: from mirror
 *  - dropshipDelisted: true if STX would have delisted this row (0 stock forced
 *    by non-express/price-cap etc.)
 *  - liquidationLocked: soldes/manualLock price is live — never add StockX ask
 *    depth on top (Galaxus buys N @ liquidation while only 1 unit sits in warehouse).
 *
 * Returns the final qty to publish. Callers still apply their own price + row
 * skip rules; this only decides the number.
 */
export function mergePhysicalWithDropship(args: {
  dropshipStock: number;
  physicalQty: number;
  dropshipDelisted?: boolean;
  /** Liquidation / manualLock sell price — publish physical qty only. */
  liquidationLocked?: boolean;
}): { finalStock: number; kept: boolean; source: "dropship" | "physical" | "combined" | "empty" } {
  const dropship = Math.max(0, Math.floor(args.dropshipStock ?? 0));
  const physical = Math.max(0, Math.floor(args.physicalQty ?? 0));
  const delisted = args.dropshipDelisted === true;
  const liquidationLocked = args.liquidationLocked === true;

  // Soldes price must not advertise StockX depth. Physical units only.
  if (liquidationLocked && physical > 0) {
    return { finalStock: physical, kept: true, source: "physical" };
  }

  if (delisted) {
    if (physical > 0) return { finalStock: physical, kept: true, source: "physical" };
    return { finalStock: 0, kept: false, source: "empty" };
  }
  if (dropship > 0 && physical > 0) {
    return { finalStock: dropship + physical, kept: true, source: "combined" };
  }
  if (dropship > 0) return { finalStock: dropship, kept: true, source: "dropship" };
  if (physical > 0) return { finalStock: physical, kept: true, source: "physical" };
  return { finalStock: 0, kept: false, source: "empty" };
}
