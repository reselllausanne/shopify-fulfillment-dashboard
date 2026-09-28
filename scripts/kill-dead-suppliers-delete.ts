/**
 * Delete dead-supplier rows (SNL/HHV/NSO; BAE has dedicated kill-bae-delete.ts).
 *
 * Usage:
 *   npx tsx scripts/kill-dead-suppliers-delete.ts --keys=snl,hhv,nso
 *   npx tsx scripts/kill-dead-suppliers-delete.ts --keys=snl --confirm=DEAD_DELETE
 *
 * After merge: upload Galaxus stock feed (force-zeros), then run delete.
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import { DEAD_DELETE_CONFIRM_TOKEN, DEAD_SUPPLIER_KEYS } from "@/galaxus/exports/deadSupplierKill";

const CONFIRM = process.argv.find((a) => a.startsWith("--confirm="))?.slice("--confirm=".length) ?? "";
const keysRaw = process.argv.find((a) => a.startsWith("--keys="))?.slice("--keys=".length) ?? "snl,hhv,nso";
const KEYS = keysRaw
  .split(",")
  .map((k) => k.trim().toLowerCase())
  .filter((k): k is (typeof DEAD_SUPPLIER_KEYS)[number] =>
    (DEAD_SUPPLIER_KEYS as readonly string[]).includes(k)
  );

async function counts(key: string) {
  const p = prisma as any;
  const prefix = `${key}_`;
  const pk = `${key.toUpperCase()}_`;
  const [variants, mappings, listings] = await Promise.all([
    p.supplierVariant.count({ where: { supplierVariantId: { startsWith: prefix } } }),
    p.variantMapping.count({ where: { supplierVariantId: { startsWith: prefix } } }),
    p.channelListingState.count({
      where: {
        OR: [{ providerKey: { startsWith: pk } }, { supplierVariantId: { startsWith: prefix } }],
      },
    }),
  ]);
  return { key, variants, mappings, listings };
}

async function deleteKey(key: string) {
  const p = prisma as any;
  const prefix = `${key}_`;
  const pk = `${key.toUpperCase()}_`;
  const chunk = 500;

  const listingIds: { id: string }[] = await p.channelListingState.findMany({
    where: {
      OR: [{ providerKey: { startsWith: pk } }, { supplierVariantId: { startsWith: prefix } }],
    },
    select: { id: true },
  });
  let listingsDeleted = 0;
  for (let i = 0; i < listingIds.length; i += chunk) {
    const ids = listingIds.slice(i, i + chunk).map((r) => r.id);
    const res = await p.channelListingState.deleteMany({ where: { id: { in: ids } } });
    listingsDeleted += res.count;
  }

  await p.supplierStockReviewItem.deleteMany({ where: { supplierKey: key } }).catch(() => null);
  await p.supplierVariantEvidence.deleteMany({ where: { supplierKey: key } }).catch(() => null);
  await p.supplierStockPolicy.deleteMany({ where: { supplierKey: key } }).catch(() => null);

  const variantIds: { supplierVariantId: string }[] = await p.supplierVariant.findMany({
    where: { supplierVariantId: { startsWith: prefix } },
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
  return { key, listingsDeleted, mappingsDeleted, variantsDeleted };
}

async function main() {
  if (!KEYS.length) {
    console.error("[kill-dead] no valid --keys= (bae|hhv|snl|nso)");
    process.exitCode = 1;
    return;
  }
  const before = [];
  for (const key of KEYS) before.push(await counts(key));
  console.log(JSON.stringify({ mode: CONFIRM ? "delete" : "count", before }, null, 2));

  if (CONFIRM !== DEAD_DELETE_CONFIRM_TOKEN) {
    console.error(`[kill-dead] count only. To delete: --confirm=${DEAD_DELETE_CONFIRM_TOKEN}`);
    return;
  }

  const deleted = [];
  for (const key of KEYS) deleted.push(await deleteKey(key));
  const after = [];
  for (const key of KEYS) after.push(await counts(key));
  console.log(JSON.stringify({ deleted: true, deleted, after }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
