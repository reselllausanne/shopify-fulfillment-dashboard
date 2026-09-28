/**
 * Heal rows that stored a bare numeric Shopify order id instead of the canonical GID.
 *
 * `ShopifyOrder.shopifyOrderId` always holds `gid://shopify/Order/<n>`. Rows written by
 * `autoMatchOnPaidOrder` between 2026-08-17 and the GID fix stored `<n>` instead, so every
 * cost/order join silently dropped them (August cost coverage read 69% instead of 98%).
 *
 * Dry-run by default. Apply with `--apply`.
 *
 *   npx tsx scripts/normalize-shopify-order-gids.ts
 *   npx tsx scripts/normalize-shopify-order-gids.ts --apply
 */
import "dotenv/config";

import { prisma } from "@/app/lib/prisma";
import { toShopifyOrderGid } from "@/app/lib/swissPostCustomerTracking";

const APPLY = process.argv.includes("--apply");

type Target = {
  table: string;
  /** Prisma delegate name used for the update. */
  update: (id: string, gid: string) => Promise<unknown>;
  /** Primary-key column used to address a row. */
  pk: string;
  /** Called when the converted row would collide with an existing canonical twin. */
  dedupeOnConflict?: (id: string) => Promise<unknown>;
};

const TARGETS: Target[] = [
  {
    table: "OrderMatch",
    pk: "id",
    update: (id, gid) => prisma.orderMatch.update({ where: { id }, data: { shopifyOrderId: gid } }),
  },
  {
    table: "ShopifyFulfillmentRecord",
    pk: "id",
    update: (id, gid) =>
      prisma.shopifyFulfillmentRecord.update({ where: { id }, data: { shopifyOrderId: gid } }),
    dedupeOnConflict: (id) => prisma.shopifyFulfillmentRecord.delete({ where: { id } }),
  },
];

async function main() {
  console.log(APPLY ? "MODE: APPLY (ecritures reelles)" : "MODE: DRY-RUN (aucune ecriture)");

  for (const target of TARGETS) {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; shopifyOrderId: string }>>(
      `SELECT "${target.pk}" AS id, "shopifyOrderId"
       FROM "${target.table}"
       WHERE "shopifyOrderId" IS NOT NULL
         AND "shopifyOrderId" <> ''
         AND "shopifyOrderId" NOT LIKE 'gid://%'`
    );

    console.log(`\n=== ${target.table}: ${rows.length} ligne(s) au mauvais format ===`);
    if (rows.length === 0) continue;

    let converted = 0;
    let skipped = 0;
    let failed = 0;
    let deduped = 0;

    for (const row of rows) {
      const gid = toShopifyOrderGid(row.shopifyOrderId);
      if (!gid || !gid.startsWith("gid://")) {
        skipped += 1;
        console.log(`  SKIP ${row.id}: valeur non convertible ${JSON.stringify(row.shopifyOrderId)}`);
        continue;
      }
      if (converted < 5) {
        console.log(`  ${row.shopifyOrderId} -> ${gid}`);
      }
      if (APPLY) {
        try {
          await target.update(row.id, gid);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // A canonical twin already exists for this natural key: the bare-numeric row is a
          // thin duplicate written by a second code path, so drop it instead of converting.
          if (target.dedupeOnConflict && /Unique constraint failed/i.test(message)) {
            await target.dedupeOnConflict(row.id);
            deduped += 1;
            continue;
          }
          failed += 1;
          console.log(`  ERREUR ${row.id}: ${message}`);
          continue;
        }
      }
      converted += 1;
    }
    console.log(
      `  ${APPLY ? "converties" : "a convertir"}: ${converted} | doublons supprimes: ${deduped} | ignorees: ${skipped} | erreurs: ${failed}`
    );
  }

  // Post-check: cost coverage per month, the metric the bug was distorting.
  const coverage = await prisma.$queryRawUnsafe<Array<Record<string, number | string>>>(`
    SELECT to_char(o."createdAt", 'YYYY-MM') AS mois,
           COUNT(*)::int AS commandes,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM "OrderMatch" m WHERE m."shopifyOrderId" = o."shopifyOrderId"
           ))::int AS avec_cout_par_id
    FROM "ShopifyOrder" o
    WHERE o."createdAt" >= '2026-06-01' AND o."cancelledAt" IS NULL
    GROUP BY 1 ORDER BY 1
  `);
  console.log("\n=== COUVERTURE COUT PAR JOINTURE D'ID ===");
  for (const r of coverage) {
    const total = Number(r.commandes);
    const ok = Number(r.avec_cout_par_id);
    console.log(
      `  ${r.mois}: ${ok}/${total} (${total ? Math.round((ok / total) * 100) : 0}%)`
    );
  }

  if (!APPLY) console.log("\nRelancer avec --apply pour ecrire.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
