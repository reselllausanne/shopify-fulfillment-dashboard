/**
 * Count NER supplier variants with gender/colorway present.
 * Usage: npx tsx scripts/ner-gender-color-audit.ts
 */
import "dotenv/config";
import { prisma } from "../app/lib/prisma";

async function main() {
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      total: number;
      with_gender: number;
      with_colorway: number;
      with_both: number;
      with_gtin: number;
    }>
  >(`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE "supplierGender" IS NOT NULL AND "supplierGender" <> '')::bigint AS with_gender,
      COUNT(*) FILTER (WHERE "supplierColorway" IS NOT NULL AND "supplierColorway" <> '')::bigint AS with_colorway,
      COUNT(*) FILTER (WHERE "supplierGender" IS NOT NULL AND "supplierGender" <> ''
        AND "supplierColorway" IS NOT NULL AND "supplierColorway" <> '')::bigint AS with_both,
      COUNT(*) FILTER (WHERE "gtin" IS NOT NULL)::bigint AS with_gtin
    FROM "public"."SupplierVariant"
    WHERE "supplierVariantId" ILIKE 'ner:%' OR "supplierVariantId" ILIKE 'ner_%';
  `);

  const row = rows[0] ?? {
    total: 0,
    with_gender: 0,
    with_colorway: 0,
    with_both: 0,
    with_gtin: 0,
  };
  const normalize = (value: number) => Number(value);

  console.log(
    JSON.stringify(
      {
        supplier: "ner",
        total: normalize(row.total),
        with_gender: normalize(row.with_gender),
        with_colorway: normalize(row.with_colorway),
        with_both: normalize(row.with_both),
        with_gtin: normalize(row.with_gtin),
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
