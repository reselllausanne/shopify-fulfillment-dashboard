import { Prisma, type PrismaClient } from "@prisma/client";
import { validateGtin } from "@/app/lib/normalize";

export type GtinReferenceMin = { min: number; count: number };

/** Partner/supplier prefix from `ner:sku`, `NER_gtin`, `stx_…`. */
export function excludePartnerKeyFromVariantId(supplierVariantId: string): string | null {
  const id = String(supplierVariantId ?? "").trim();
  if (!id) return null;
  const colon = id.indexOf(":");
  if (colon > 0) return id.slice(0, colon).toLowerCase();
  const us = id.indexOf("_");
  if (us > 0) return id.slice(0, us).toLowerCase();
  return null;
}

/**
 * Lowest `SupplierVariant.price` per GTIN among offers that are not this partner/supplier.
 * Same rule as partner catalog (`referenceMinPriceChf`).
 */
export async function loadGtinReferenceMinPrices(
  prisma: PrismaClient,
  gtins: string[],
  excludePartnerKeyRaw: string
): Promise<Map<string, GtinReferenceMin>> {
  const out = new Map<string, GtinReferenceMin>();
  const excludeKey = String(excludePartnerKeyRaw ?? "").trim().toLowerCase();
  const uniqueGtins = [
    ...new Set(gtins.map((g) => String(g ?? "").trim()).filter((g) => validateGtin(g))),
  ];
  if (!excludeKey || uniqueGtins.length === 0) return out;

  const idPrefixPattern = `${excludeKey}:%`;
  const idUnderscoreRe = `^${excludeKey}_`;
  const rows = await prisma.$queryRaw<Array<{ gtin: string; min_price: unknown; cnt: bigint }>>(
    Prisma.sql`
      SELECT sv."gtin", MIN(sv."price") AS min_price, COUNT(*)::bigint AS cnt
      FROM "public"."SupplierVariant" sv
      WHERE sv."gtin" IN (${Prisma.join(uniqueGtins)})
        AND NOT (sv."supplierVariantId" ILIKE ${idPrefixPattern})
        AND sv."supplierVariantId" !~* ${idUnderscoreRe}
      GROUP BY sv."gtin"
    `
  );

  for (const r of rows) {
    const g = String(r.gtin ?? "").trim();
    const v = Number(r.min_price);
    if (validateGtin(g) && Number.isFinite(v)) {
      out.set(g, { min: v, count: Number(r.cnt) });
    }
  }
  return out;
}

export type VariantWithGtinRef = {
  supplierVariantId: string;
  gtin?: string | null;
  price?: unknown;
};

/**
 * Attach others-min + count (+ optional CHF delta vs this row’s price) per variant.
 * Groups by supplier prefix so NER rows exclude other NER ids, STX excludes STX, etc.
 */
export async function attachGtinReferenceMinPrices<T extends VariantWithGtinRef>(
  prisma: PrismaClient,
  items: T[]
): Promise<
  Array<
    T & {
      referenceMinPriceChf: number | null;
      referenceOfferCount: number | null;
      referencePriceDiffChf: number | null;
      isCheapestInDb: boolean | null;
    }
  >
> {
  if (items.length === 0) return [];

  const gtinsByExclude = new Map<string, string[]>();
  for (const item of items) {
    const g = item.gtin ? String(item.gtin).trim() : "";
    if (!validateGtin(g)) continue;
    const excludeKey = excludePartnerKeyFromVariantId(item.supplierVariantId);
    if (!excludeKey) continue;
    const list = gtinsByExclude.get(excludeKey) ?? [];
    list.push(g);
    gtinsByExclude.set(excludeKey, list);
  }

  const refByExcludeAndGtin = new Map<string, Map<string, GtinReferenceMin>>();
  await Promise.all(
    [...gtinsByExclude.entries()].map(async ([excludeKey, gtins]) => {
      const map = await loadGtinReferenceMinPrices(prisma, gtins, excludeKey);
      refByExcludeAndGtin.set(excludeKey, map);
    })
  );

  return items.map((item) => {
    const g = item.gtin ? String(item.gtin).trim() : "";
    const excludeKey = excludePartnerKeyFromVariantId(item.supplierVariantId);
    const ref =
      validateGtin(g) && excludeKey
        ? refByExcludeAndGtin.get(excludeKey)?.get(g)
        : undefined;

    const our = Number(item.price);
    let referencePriceDiffChf: number | null = null;
    let isCheapestInDb: boolean | null = null;

    if (ref == null) {
      // No other-supplier offers for this GTIN → nothing can undercut from DB.
      isCheapestInDb = validateGtin(g) ? true : null;
    } else if (Number.isFinite(our)) {
      referencePriceDiffChf = Number((our - ref.min).toFixed(2));
      isCheapestInDb = referencePriceDiffChf <= 0.009;
    }

    return {
      ...item,
      referenceMinPriceChf: ref != null ? ref.min : null,
      referenceOfferCount: ref != null ? ref.count : null,
      referencePriceDiffChf,
      isCheapestInDb,
    };
  });
}
