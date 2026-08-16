/**
 * Repair pairs sold out from owned physical stock:
 * - clear stale Shopify 48h / express availability
 * - re-run normal dropship convergence
 * - queue one current Galaxus stock + price upload
 *
 * Run on VPS:
 *   docker compose exec -T web npx tsx scripts/backfill-sold-out-physical-48h.ts
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import { resolveAppOriginForPartnerJobs } from "@/app/lib/partnerJobOrigin";
import { startFeedPushAsync } from "@/galaxus/ops/feedPipelineCore";
import { loadPhysicalMirrorStockByGtin } from "@/shopify/inventory/physicalAvailability";
import { convergeVariant } from "@/shopify/inventory/convergence";

const CONCURRENCY = 2;

async function main() {
  const candidates = await prisma.supplierVariant.findMany({
    where: {
      supplierVariantId: { startsWith: "stx_" },
      manualLock: false,
      manualNote: { startsWith: "phase4:dropship" },
      gtin: { not: null },
    },
    select: { gtin: true },
  });
  const gtins = new Set<string>();
  for (const row of candidates) {
    const gtin = String(row.gtin ?? "").trim();
    if (gtin) gtins.add(gtin);
  }

  const physical = await loadPhysicalMirrorStockByGtin([...gtins]);
  const soldOutGtins = [...gtins].filter((gtin) => (physical.get(gtin)?.qty ?? 0) <= 0);
  let changed = 0;
  let errors = 0;
  for (let offset = 0; offset < soldOutGtins.length; offset += CONCURRENCY) {
    const batch = soldOutGtins.slice(offset, offset + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (gtin) => {
        try {
          return await convergeVariant(gtin, { afterWebSale: true });
        } catch (error) {
          console.error("[sold-out-48h-backfill] convergence failed", { gtin, error });
          return null;
        }
      })
    );
    for (const result of results) {
      if (!result || result.error) errors += 1;
      else if (result.changed) changed += 1;
    }
    console.info("[sold-out-48h-backfill] progress", {
      processed: Math.min(offset + batch.length, soldOutGtins.length),
      total: soldOutGtins.length,
      changed,
      errors,
    });
  }

  const origin = resolveAppOriginForPartnerJobs(null) ?? "http://127.0.0.1:3000";
  // Full Galaxus files make every affected listing consistent. Do not run a
  // synchronous Decathlon sync here: it can delay this urgent storefront repair.
  const stockPush = await startFeedPushAsync({
    origin,
    scope: "stock",
    triggerSource: "manual-pricing",
  });
  const pricePush = await startFeedPushAsync({
    origin,
    scope: "price",
    triggerSource: "manual-pricing",
  });

  console.info(
    "[sold-out-48h-backfill] done",
    JSON.stringify({
      candidates: gtins.size,
      soldOut: soldOutGtins.length,
      changed,
      errors,
      stockPush,
      pricePush,
    })
  );
}

main()
  .catch((error) => {
    console.error("[sold-out-48h-backfill] fatal", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
