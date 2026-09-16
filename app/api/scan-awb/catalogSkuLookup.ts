import { prisma } from "@/app/lib/prisma";

export type CatalogSkuHit = {
  gtin: string | null;
  providerKey: string | null;
  supplierSku: string;
};

/** Compact form for space-insensitive SKU match (`MW 3A03GS` ↔ `MW3A03GS`). */
export function compactCatalogSkuQuery(q: string): string {
  return String(q ?? "")
    .trim()
    .replace(/\s+/g, "");
}

/**
 * Resolve typed Reichelt/MINWA-style catalog SKUs (and similar) to GTINs /
 * providerKeys via SupplierVariant.supplierSku. Space-insensitive.
 */
export async function resolveCatalogSkuHits(
  q: string,
  limit = 40
): Promise<CatalogSkuHit[]> {
  const compact = compactCatalogSkuQuery(q);
  if (compact.length < 2) return [];

  const rows = await prisma.$queryRawUnsafe<
    Array<{ gtin: string | null; providerKey: string | null; supplierSku: string }>
  >(
    `
    SELECT DISTINCT ON (COALESCE(NULLIF(BTRIM(gtin), ''), "providerKey"), "supplierSku")
      NULLIF(BTRIM(gtin), '') AS gtin,
      NULLIF(BTRIM("providerKey"), '') AS "providerKey",
      "supplierSku"
    FROM "SupplierVariant"
    WHERE REPLACE("supplierSku", ' ', '') ILIKE '%' || $1 || '%'
    ORDER BY COALESCE(NULLIF(BTRIM(gtin), ''), "providerKey"), "supplierSku"
    LIMIT $2
    `,
    compact,
    Math.max(1, Math.min(100, Math.floor(limit)))
  );

  return rows
    .map((r) => ({
      gtin: r.gtin ? String(r.gtin).trim() : null,
      providerKey: r.providerKey ? String(r.providerKey).trim() : null,
      supplierSku: String(r.supplierSku ?? "").trim(),
    }))
    .filter((r) => r.supplierSku && (r.gtin || r.providerKey));
}

export function catalogSkuHitIndexes(hits: CatalogSkuHit[]): {
  gtins: string[];
  providerKeys: string[];
  skuByGtin: Map<string, string>;
} {
  const gtins: string[] = [];
  const providerKeys: string[] = [];
  const skuByGtin = new Map<string, string>();
  const seenG = new Set<string>();
  const seenP = new Set<string>();

  for (const hit of hits) {
    if (hit.gtin && !seenG.has(hit.gtin)) {
      seenG.add(hit.gtin);
      gtins.push(hit.gtin);
      skuByGtin.set(hit.gtin, hit.supplierSku);
    }
    if (hit.providerKey && !seenP.has(hit.providerKey)) {
      seenP.add(hit.providerKey);
      providerKeys.push(hit.providerKey);
    }
  }

  return { gtins, providerKeys, skuByGtin };
}
