import { prisma } from "@/app/lib/prisma";

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
 * physical locations (Bussigny, Antica, Bienne). Dropship = Chemin de Bas-de-
 * Plan (online), which we intentionally EXCLUDE here — dropship qty already
 * flows through the STX supplier path (asks cap etc.), so summing the online
 * mirror row would double-count.
 *
 * Zero-count semantics: a missing key = 0. Never returns negatives.
 *
 * Feature-flag gate: callers should only merge when `RESOLVER_MERGE_PHYSICAL`
 * is enabled, so we can ship code first, verify with a diff, and cut over
 * after the THE_ purge migration lands.
 */

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

export type PhysicalStockMap = Map<string, PhysicalStockRow>;

/**
 * Batch load physical availability keyed by GTIN.
 *
 * Only rows with `sourceType='physical'` and `available > 0` are aggregated.
 * Empty input → empty map (single trip avoided).
 */
export async function loadPhysicalMirrorStockByGtin(gtins: string[]): Promise<PhysicalStockMap> {
  const clean = Array.from(new Set(gtins.filter((g): g is string => !!g && g.length > 0)));
  const out: PhysicalStockMap = new Map();
  if (clean.length === 0) return out;

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
      AND s."gtin"       = ANY(${clean}::text[])
    GROUP BY s."gtin"
  `;

  for (const r of rows) {
    const qty = Number(r.qty ?? 0);
    if (qty <= 0) continue;
    out.set(r.gtin, {
      qty,
      preferredLocationId: r.loc_id,
      preferredLocationName: r.loc_name,
    });
  }
  return out;
}

/**
 * Convenience: single-GTIN lookup. Prefer the batch version in hot paths.
 */
export async function getPhysicalStockForGtin(gtin: string): Promise<PhysicalStockRow> {
  const m = await loadPhysicalMirrorStockByGtin([gtin]);
  return m.get(gtin) ?? { qty: 0, preferredLocationId: null, preferredLocationName: null };
}

/**
 * Merge helper (pure). Applies the physical qty on top of a dropship qty for a
 * marketplace row, with the "keep live if physical>0" override.
 *
 *  - dropshipStock: value AFTER STX ask-cap / express filter / price-cap delist
 *  - physicalQty: from mirror
 *  - dropshipDelisted: true if STX would have delisted this row (0 stock forced
 *    by non-express/price-cap etc.)
 *
 * Returns the final qty to publish. Callers still apply their own price + row
 * skip rules; this only decides the number.
 */
export function mergePhysicalWithDropship(args: {
  dropshipStock: number;
  physicalQty: number;
  dropshipDelisted?: boolean;
}): { finalStock: number; kept: boolean; source: "dropship" | "physical" | "combined" | "empty" } {
  const dropship = Math.max(0, Math.floor(args.dropshipStock ?? 0));
  const physical = Math.max(0, Math.floor(args.physicalQty ?? 0));
  const delisted = args.dropshipDelisted === true;

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
