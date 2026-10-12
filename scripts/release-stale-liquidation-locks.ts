/**
 * Release physical liquidation locks (`restock:liquidation` / `phase4:liquidation`)
 * whose pair is no longer on a liquidation-lane shelf, restore detached GTINs from
 * VariantMapping, converge Shopify for each released GTIN, then queue Galaxus
 * stock + price pushes.
 *
 * Run on VPS:
 *   docker compose exec -T web npx tsx scripts/release-stale-liquidation-locks.ts          # dry-run
 *   docker compose exec -T web npx tsx scripts/release-stale-liquidation-locks.ts --write
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import { resolveAppOriginForPartnerJobs } from "@/app/lib/partnerJobOrigin";
import { startFeedPushAsync } from "@/galaxus/ops/feedPipelineCore";
import { convergeVariant } from "@/shopify/inventory/convergence";
import { releaseStaleLiquidationLocks } from "@/shopify/inventory/staleLiquidationLocks";

async function main() {
  const write = process.argv.includes("--write");
  const sweep = await releaseStaleLiquidationLocks({ dryRun: !write });

  console.info(
    "[stale-liquidation] sweep",
    JSON.stringify({ dryRun: sweep.dryRun, scanned: sweep.scanned, kept: sweep.kept, skipped: sweep.skippedReason })
  );
  for (const r of sweep.released) {
    console.info(
      `  ${write ? "released" : "would release"} ${r.supplierVariantId} | ${r.name} ${r.size} | gtin=${r.gtin ?? "-"} | manual=${r.manualPrice} | restoreGtin=${r.restoredGtin} | stock0=${r.zeroedStaleStock}`
    );
  }
  if (!write || sweep.released.length === 0) return;

  for (const r of sweep.released) {
    if (!r.gtin) continue;
    try {
      const res = await convergeVariant(r.gtin, { afterWebSale: true });
      console.info(`  converge ${r.gtin} desired=${res.desired} changes=${res.changes.join(" | ") || "-"}`);
    } catch (err: any) {
      console.error(`  converge ${r.gtin} failed: ${err?.message ?? err}`);
    }
  }

  const origin = resolveAppOriginForPartnerJobs(null) ?? "http://127.0.0.1:3000";
  const stockPush = await startFeedPushAsync({ origin, scope: "stock", triggerSource: "manual-pricing" });
  const pricePush = await startFeedPushAsync({ origin, scope: "price", triggerSource: "manual-pricing" });
  console.info("[stale-liquidation] feed push", JSON.stringify({ stockPush, pricePush }));
}

main()
  .catch((error) => {
    console.error("[stale-liquidation] fatal", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
