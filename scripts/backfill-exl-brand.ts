/** One-shot: EXL rows need supplierBrand for Galaxus catalog-ready gate. */
import { prisma } from "@/app/lib/prisma";

async function main() {
  const prismaAny = prisma as any;
  const updated = await prismaAny.$executeRaw`
    UPDATE "SupplierVariant"
    SET "supplierBrand" = COALESCE(NULLIF(TRIM("supplierProductType"), ''), 'Ex Libris'),
        "updatedAt" = NOW()
    WHERE "supplierVariantId" LIKE 'exl_%'
      AND ("supplierBrand" IS NULL OR TRIM("supplierBrand") = '')
  `;
  console.log(`backfill-exl-brand: updated ${updated} rows`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
