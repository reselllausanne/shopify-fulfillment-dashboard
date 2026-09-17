/**
 * One-off AWB backfill with pasted bearer. Usage:
 *   STOCKX_BEARER='...' npx tsx scripts/run-manual-awb-backfill.ts
 */
import { runGalaxusAwbBackfill } from "@/lib/galaxusAwbBackfill";
import { runDecathlonAwbBackfill } from "@/lib/decathlonAwbBackfill";
import { runAwbBackfill } from "@/lib/stockxAwbBackfill";
import { runStxAwbResync } from "@/galaxus/jobs/stxAwbResync";
import { prisma } from "@/app/lib/prisma";

const token = String(process.env.STOCKX_BEARER ?? "").trim().replace(/^bearer\s+/i, "");
if (!token) {
  console.error("Missing STOCKX_BEARER env");
  process.exit(1);
}

const days = Math.min(Math.max(Number(process.env.DAYS ?? 180) || 180, 1), 180);
const limit = Math.min(Math.max(Number(process.env.LIMIT ?? 200) || 200, 1), 200);
const passes = Math.min(Math.max(Number(process.env.PASSES ?? 3) || 3, 1), 10);

async function main() {
  let totalGalaxus = 0;
  let totalShopify = 0;
  let totalDecathlon = 0;

  for (let pass = 1; pass <= passes; pass++) {
    console.log(`\n=== pass ${pass}/${passes} days=${days} limit=${limit} ===`);

    const shopify = await runAwbBackfill({
      token,
      days,
      limit,
      dryRun: false,
      includeFulfilled: false,
    });
    const galaxus = await runGalaxusAwbBackfill({
      token,
      days,
      limit,
      dryRun: false,
      includeFulfilled: false,
    });
    const decathlon = await runDecathlonAwbBackfill({
      token,
      days,
      limit,
      dryRun: false,
      includeFulfilled: false,
    });

    totalShopify += shopify.updated;
    totalGalaxus += galaxus.updated;
    totalDecathlon += decathlon.updated;

    console.log(
      JSON.stringify(
        {
          pass,
          shopify: {
            candidates: shopify.candidates,
            updated: shopify.updated,
            authFailures: shopify.authFailures,
            aborted: shopify.abortedReason,
          },
          galaxus: {
            candidates: galaxus.candidates,
            updated: galaxus.updated,
            authFailures: galaxus.authFailures,
            aborted: galaxus.abortedReason,
          },
          decathlon: {
            candidates: decathlon.candidates,
            updated: decathlon.updated,
            authFailures: decathlon.authFailures,
            aborted: decathlon.abortedReason,
          },
        },
        null,
        2
      )
    );

    for (const item of galaxus.items.filter((x) => x.status === "UPDATED")) {
      console.log(`galaxus ${item.galaxusOrderRef} ${item.stockxOrderNumber} -> ${item.awb}`);
    }
    for (const item of shopify.items.filter((x) => x.status === "UPDATED")) {
      console.log(`shopify ${item.shopifyOrderName} ${item.stockxOrderNumber} -> ${item.awb}`);
    }

    if (shopify.abortedReason || galaxus.abortedReason || decathlon.abortedReason) {
      console.error("Aborted due to auth failure");
      break;
    }
    if (shopify.updated + galaxus.updated + decathlon.updated === 0) {
      console.log("No updates this pass — stopping early");
      break;
    }
  }

  const resync = await runStxAwbResync({
    token,
    minAgeHours: 1,
    limitUnits: 500,
    concurrency: 2,
  });
  console.log(
    JSON.stringify(
      {
        totals: { shopify: totalShopify, galaxus: totalGalaxus, decathlon: totalDecathlon },
        stxResync: resync,
      },
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
  .finally(() => prisma.$disconnect());
