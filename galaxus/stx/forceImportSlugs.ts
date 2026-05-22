import { prisma } from "@/app/lib/prisma";

/** StockX / KickDB product slugs allowed without express asks (standard-only OK). */
export const STX_FORCE_IMPORT_SLUGS = new Set([
  "swatch-x-audemars-piguet-bioceramic-royal-pop-savonnette-lan-ba-ssx03l100n-blue",
  "swatch-x-audemars-piguet-bioceramic-royal-pop-ocho-negro-ssx03w101n-black",
  "swatch-x-audemars-piguet-bioceramic-royal-pop-savonnette-otg-roz-ssx03j100n-blue",
  "swatch-x-audemars-piguet-bioceramic-royal-pop-huit-blanc-ssx03w100n-white",
  "swatch-x-audemars-piguet-bioceramic-royal-pop-orenji-hachi-ssx03l103n-black",
  "swatch-x-audemars-piguet-bioceramic-royal-pop-green-eight-ssx03g100n-green",
]);

export function normalizeStxProductSlug(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function isStxForceImportSlug(value: unknown): boolean {
  const slug = normalizeStxProductSlug(value);
  return slug.length > 0 && STX_FORCE_IMPORT_SLUGS.has(slug);
}

/** STX supplierVariantIds linked to force-import KickDB products (sync must not delete / zero them). */
export async function listForceImportStxSupplierVariantIds(): Promise<string[]> {
  const slugs = Array.from(STX_FORCE_IMPORT_SLUGS);
  if (slugs.length === 0) return [];

  const prismaAny = prisma as any;
  const products = await prismaAny.kickDBProduct.findMany({
    where: {
      OR: slugs.map((slug) => ({ urlKey: { equals: slug, mode: "insensitive" } })),
    },
    select: { kickdbProductId: true },
  });

  const productIds = products
    .map((row: { kickdbProductId?: string }) => String(row?.kickdbProductId ?? "").trim())
    .filter(Boolean);
  if (productIds.length === 0) return [];

  const rows = await prisma.$queryRaw<Array<{ supplierVariantId: string }>>`
    SELECT sv."supplierVariantId"
    FROM "public"."SupplierVariant" sv
    INNER JOIN "public"."VariantMapping" vm ON vm."supplierVariantId" = sv."supplierVariantId"
    INNER JOIN "public"."KickDBVariant" kv ON kv.id = vm."kickdbVariantId"
    INNER JOIN "public"."KickDBProduct" kp ON kp.id = kv."productId"
    WHERE kp."kickdbProductId" = ANY(${productIds}::text[])
      AND sv."supplierVariantId" LIKE 'stx_%'
  `;
  return rows.map((r) => r.supplierVariantId).filter(Boolean);
}
