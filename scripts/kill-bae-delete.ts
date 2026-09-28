/**
 * Delete all BAE (Bächli) rows from the DB.
 *
 * Usage:
 *   npx tsx scripts/kill-bae-delete.ts              # counts only
 *   npx tsx scripts/kill-bae-delete.ts --confirm=BAE_DELETE
 *
 * Galaxus live offers: after merge, next stock feed emits QuantityOnStock=0 for BAE
 * (shouldForceBaeStockZero). Upload stock feed, then run this delete.
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import { BAE_DELETE_CONFIRM_TOKEN } from "@/galaxus/exports/baeKill";

const CONFIRM = process.argv.find((a) => a.startsWith("--confirm="))?.slice("--confirm=".length) ?? "";

async function counts() {
  const p = prisma as any;
  const [variants, mappings, listings, evidence, review] = await Promise.all([
    p.supplierVariant.count({ where: { supplierVariantId: { startsWith: "bae_" } } }),
    p.variantMapping.count({ where: { supplierVariantId: { startsWith: "bae_" } } }),
    p.channelListingState.count({
      where: {
        OR: [{ providerKey: { startsWith: "BAE_" } }, { supplierVariantId: { startsWith: "bae_" } }],
      },
    }),
    p.supplierVariantEvidence.count({ where: { supplierKey: "bae" } }).catch(() => 0),
    p.supplierStockReviewItem.count({ where: { supplierKey: "bae" } }).catch(() => 0),
  ]);
  return { variants, mappings, listings, evidence, review };
}

async function main() {
  const before = await counts();
  console.log(JSON.stringify({ mode: CONFIRM ? "delete" : "count", before }, null, 2));

  if (CONFIRM !== BAE_DELETE_CONFIRM_TOKEN) {
    console.error(`[kill-bae] count only. To delete: --confirm=${BAE_DELETE_CONFIRM_TOKEN}`);
    return;
  }

  const p = prisma as any;
  const chunk = 500;

  // Listings first
  const listingIds: { id: string }[] = await p.channelListingState.findMany({
    where: {
      OR: [{ providerKey: { startsWith: "BAE_" } }, { supplierVariantId: { startsWith: "bae_" } }],
    },
    select: { id: true },
  });
  let listingsDeleted = 0;
  for (let i = 0; i < listingIds.length; i += chunk) {
    const ids = listingIds.slice(i, i + chunk).map((r) => r.id);
    const res = await p.channelListingState.deleteMany({ where: { id: { in: ids } } });
    listingsDeleted += res.count;
  }

  await p.supplierStockReviewItem.deleteMany({ where: { supplierKey: "bae" } }).catch(() => null);
  await p.supplierVariantEvidence.deleteMany({ where: { supplierKey: "bae" } }).catch(() => null);
  await p.supplierStockPolicy.deleteMany({ where: { supplierKey: "bae" } }).catch(() => null);

  const variantIds: { supplierVariantId: string }[] = await p.supplierVariant.findMany({
    where: { supplierVariantId: { startsWith: "bae_" } },
    select: { supplierVariantId: true },
  });
  let mappingsDeleted = 0;
  let variantsDeleted = 0;
  for (let i = 0; i < variantIds.length; i += chunk) {
    const batch = variantIds.slice(i, i + chunk).map((r) => r.supplierVariantId);
    const m = await p.variantMapping.deleteMany({ where: { supplierVariantId: { in: batch } } });
    const v = await p.supplierVariant.deleteMany({ where: { supplierVariantId: { in: batch } } });
    mappingsDeleted += m.count;
    variantsDeleted += v.count;
  }

  const after = await counts();
  console.log(
    JSON.stringify(
      {
        deleted: true,
        listingsDeleted,
        mappingsDeleted,
        variantsDeleted,
        after,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
