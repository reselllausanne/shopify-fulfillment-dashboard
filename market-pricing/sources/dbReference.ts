import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { validateGtin } from "@/app/lib/normalize";
import type { MarketOffer, SourceResult } from "@/market-pricing/types";
import type { LookupInput, PriceSource } from "@/market-pricing/sources/source";

/**
 * Free internal reference: the cheapest SupplierVariant price for this GTIN across
 * our own feeds, excluding our StockX rows. Not a true market price, but a zero-cost
 * sanity floor that always works offline. Prices are ex VAT in the DB; we gross them
 * up to a consumer-comparable incl.-VAT number.
 */
export const dbReferenceSource: PriceSource = {
  key: "db_reference",
  isEnabled: () => true,
  async lookup(input: LookupInput): Promise<SourceResult> {
    if (!validateGtin(input.gtin)) {
      return { source: "db_reference", ok: true, offers: [], shopCount: 0 };
    }
    const rows = await prisma.$queryRaw<Array<{ min_price: unknown; cnt: bigint }>>(
      Prisma.sql`
        SELECT MIN(sv."price") AS min_price, COUNT(*)::bigint AS cnt
        FROM "public"."SupplierVariant" sv
        WHERE sv."gtin" = ${input.gtin}
          AND sv."supplierVariantId" !~* '^stx'
          AND sv."stock" > 0
      `
    );
    const row = rows[0];
    const exVat = row ? Number(row.min_price) : NaN;
    const cnt = row ? Number(row.cnt) : 0;
    if (!Number.isFinite(exVat) || exVat <= 0) {
      return { source: "db_reference", ok: true, offers: [], shopCount: 0 };
    }
    const offer: MarketOffer = {
      source: "db_reference",
      seller: "internal_supplier_feed",
      priceChf: Math.round(exVat * 1.081 * 100) / 100, // gross to incl-VAT for comparability
      totalChf: null,
      availability: "in_stock",
      productUrl: null,
      isSelf: true, // our own supply, not a rival — excluded from market consensus
      observedAt: new Date().toISOString(),
    };
    return { source: "db_reference", ok: true, offers: [offer], shopCount: cnt };
  },
};
