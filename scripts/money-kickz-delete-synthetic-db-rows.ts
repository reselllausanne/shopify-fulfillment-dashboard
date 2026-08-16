/**
 * Delete synthetic JMONEY_ / phy_jmoney_ SupplierVariant rows created by mistake.
 * Does NOT touch Shopify prices/locks.
 *
 * Usage: npx tsx scripts/money-kickz-delete-synthetic-db-rows.ts --write
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";

const WRITE = process.argv.includes("--write");

async function main() {
  const prismaAny = prisma as any;
  const created = await prismaAny.supplierVariant.findMany({
    where: {
      OR: [
        { supplierVariantId: { startsWith: "phy_jmoney_" } },
        { providerKey: { startsWith: "JMONEY_" } },
      ],
    },
    select: {
      id: true,
      supplierVariantId: true,
      providerKey: true,
      gtin: true,
      supplierProductName: true,
      manualPrice: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  console.log(`found ${created.length} synthetic JMONEY rows`);
  for (const r of created.slice(0, 30)) {
    console.log(
      `${r.providerKey} | ${r.supplierVariantId} | ${r.gtin} | ${r.supplierProductName} | ${r.manualPrice}`
    );
  }

  if (!WRITE) {
    console.log("dry-run — pass --write to delete");
    return;
  }

  const ids = created.map((r: { supplierVariantId: string }) => r.supplierVariantId);
  if (!ids.length) return;

  // Best-effort related cleanup
  let mappings = 0;
  let listings = 0;
  let events = 0;
  try {
    const m = await prismaAny.variantMapping.deleteMany({
      where: { supplierVariantId: { in: ids } },
    });
    mappings = m.count ?? 0;
  } catch {
    // ignore
  }
  try {
    const l = await prismaAny.channelListingState.deleteMany({
      where: { supplierVariantId: { in: ids } },
    });
    listings = l.count ?? 0;
  } catch {
    // ignore
  }
  try {
    const e = await prismaAny.inventoryEvent.deleteMany({
      where: { supplierVariantId: { in: ids } },
    });
    events = e.count ?? 0;
  } catch {
    // ignore
  }

  const del = await prismaAny.supplierVariant.deleteMany({
    where: {
      OR: [
        { supplierVariantId: { startsWith: "phy_jmoney_" } },
        { providerKey: { startsWith: "JMONEY_" } },
      ],
    },
  });

  console.log(
    JSON.stringify(
      { deleted: del.count, mappingsRemoved: mappings, listingsRemoved: listings, eventsRemoved: events },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
