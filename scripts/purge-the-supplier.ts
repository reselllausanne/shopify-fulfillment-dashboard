/**
 * Purge legacy THE warehouse supplier rows (providerKey THE_*, supplierVariantId the:*).
 * Does not touch THE LAB location / ShopifyVariantLocationStock.
 *
 *   npx tsx scripts/purge-the-supplier.ts           # dry-run
 *   npx tsx scripts/purge-the-supplier.ts --apply   # destructive
 */
import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "../app/lib/prisma";

const APPLY = process.argv.includes("--apply");

const svWhere: Prisma.SupplierVariantWhereInput = {
  OR: [
    { providerKey: { startsWith: "THE_" } },
    { supplierVariantId: { startsWith: "the:", mode: "insensitive" } },
    { supplierVariantId: { startsWith: "the_", mode: "insensitive" } },
  ],
};

const mappingWhere: Prisma.VariantMappingWhereInput = {
  OR: [
    { providerKey: { startsWith: "THE_" } },
    { supplierVariantId: { startsWith: "the:", mode: "insensitive" } },
    { supplierVariantId: { startsWith: "the_", mode: "insensitive" } },
    { supplierKey: { equals: "the", mode: "insensitive" } },
  ],
};

const clsWhere: Prisma.ChannelListingStateWhereInput = {
  OR: [
    { providerKey: { startsWith: "THE_" } },
    { supplierVariantId: { startsWith: "the:", mode: "insensitive" } },
    { supplierVariantId: { startsWith: "the_", mode: "insensitive" } },
  ],
};

const uploadRowWhere: Prisma.PartnerUploadRowWhereInput = {
  OR: [
    { providerKey: { equals: "THE", mode: "insensitive" } },
    { supplierVariantId: { startsWith: "the:", mode: "insensitive" } },
    { supplierVariantId: { startsWith: "the_", mode: "insensitive" } },
  ],
};

async function countCollisions(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ gtin: string; n: bigint }>>`
    SELECT gtin, COUNT(DISTINCT
      CASE
        WHEN "providerKey" LIKE 'THE_%' OR "supplierVariantId" ILIKE 'the:%' OR "supplierVariantId" ILIKE 'the_%'
          THEN 'THE'
        WHEN "providerKey" LIKE 'STX_%' OR "supplierVariantId" ILIKE 'stx:%' OR "supplierVariantId" ILIKE 'stx_%'
          THEN 'STX'
        ELSE 'OTHER'
      END
    ) AS n
    FROM "SupplierVariant"
    WHERE gtin IS NOT NULL AND gtin <> ''
    GROUP BY gtin
    HAVING COUNT(DISTINCT
      CASE
        WHEN "providerKey" LIKE 'THE_%' OR "supplierVariantId" ILIKE 'the:%' OR "supplierVariantId" ILIKE 'the_%'
          THEN 'THE'
        WHEN "providerKey" LIKE 'STX_%' OR "supplierVariantId" ILIKE 'stx:%' OR "supplierVariantId" ILIKE 'stx_%'
          THEN 'STX'
        ELSE 'OTHER'
      END
    ) > 1
      AND BOOL_OR("providerKey" LIKE 'THE_%' OR "supplierVariantId" ILIKE 'the:%' OR "supplierVariantId" ILIKE 'the_%')
  `;
  return rows.length;
}

async function main() {
  const [svCount, mapCount, clsCount, uploadCount, collisions] = await Promise.all([
    prisma.supplierVariant.count({ where: svWhere }),
    prisma.variantMapping.count({ where: mappingWhere }),
    prisma.channelListingState.count({ where: clsWhere }),
    prisma.partnerUploadRow.count({ where: uploadRowWhere }),
    countCollisions(),
  ]);

  const sample = await prisma.supplierVariant.findMany({
    where: svWhere,
    select: { supplierVariantId: true, providerKey: true, gtin: true },
    take: 10,
    orderBy: { createdAt: "asc" },
  });

  console.log("[purge-the-supplier] mode:", APPLY ? "APPLY" : "dry-run");
  console.log({
    supplierVariants: svCount,
    variantMappings: mapCount,
    channelListingStates: clsCount,
    partnerUploadRows: uploadCount,
    stxTheGtinCollisions: collisions,
    sample,
  });

  if (!APPLY) {
    console.log("Pass --apply to delete.");
    return;
  }

  const clsDeleted = await prisma.channelListingState.deleteMany({ where: clsWhere });
  const uploadDeleted = await prisma.partnerUploadRow.deleteMany({ where: uploadRowWhere });
  const mapDeleted = await prisma.variantMapping.deleteMany({ where: mappingWhere });
  const svDeleted = await prisma.supplierVariant.deleteMany({ where: svWhere });
  const result = {
    channelListingStates: clsDeleted.count,
    partnerUploadRows: uploadDeleted.count,
    variantMappings: mapDeleted.count,
    supplierVariants: svDeleted.count,
  };

  console.log("[purge-the-supplier] deleted", result);

  const remaining = await prisma.supplierVariant.count({ where: svWhere });
  if (remaining > 0) {
    throw new Error(`purge incomplete: ${remaining} THE supplier variants remain`);
  }
}

main()
  .catch((error) => {
    console.error("[purge-the-supplier] failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
