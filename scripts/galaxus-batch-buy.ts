/**
 * Galaxus STX → StockX batch buy (EXPRESS-first HARD RULE).
 *
 * Usage:
 *   npx tsx scripts/galaxus-batch-buy.ts --order=208138931           # dry-run plan
 *   npx tsx scripts/galaxus-batch-buy.ts --order=208138931 --limit=3  # dry-run 3 lines
 *   npx tsx scripts/galaxus-batch-buy.ts --order=208138931 --limit=3 --go  # LIVE
 *   npx tsx scripts/galaxus-batch-buy.ts --oldest --limit=10          # oldest unbought
 */
import "dotenv/config";
import {
  listUnboughtGalaxusStxCandidates,
  type GalaxusBuyCandidate,
} from "@/lib/stockxAutoCheckout/galaxusBuyCandidates";
import { runGalaxusBatchBuy } from "@/lib/stockxAutoCheckout/galaxusBatchBuy";

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(`--${name}=`.length);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const confirmLive = args.has("--go") || args.has("--live");
  const limit = Math.max(1, Math.min(50, Number(arg("limit") ?? "3") || 3));
  const orderId = arg("order")?.trim();
  const oldest = args.has("--oldest") || !orderId;

  let candidates: GalaxusBuyCandidate[] = [];
  if (orderId) {
    candidates = await listUnboughtGalaxusStxCandidates({
      galaxusOrderId: orderId,
      limit,
    });
  } else if (oldest) {
    candidates = await listUnboughtGalaxusStxCandidates({ limit });
  }

  console.log(`[galaxus-batch-buy] ${candidates.length} candidate(s) (limit=${limit})`);
  console.table(
    candidates.map((c) => ({
      order: c.galaxusOrderId,
      line: c.lineNumber,
      product: c.productName.slice(0, 42),
      size: c.sizeEU,
      sell: c.sellChf,
      exp: c.expressBuyChf,
      std: c.standardBuyChf,
      hint: c.desiredLaneHint,
      slug: c.slug,
    }))
  );

  if (!candidates.length) {
    console.error("[galaxus-batch-buy] no candidates");
    process.exit(2);
  }

  if (!confirmLive) {
    console.log("[galaxus-batch-buy] dry-run (pass --go for live Place Order)");
  } else {
    console.warn("[galaxus-batch-buy] LIVE — Place Order with galaxus_express_first");
  }

  const summary = await runGalaxusBatchBuy({
    candidates,
    dryRun: !confirmLive,
    confirmLive,
  });

  console.log(JSON.stringify(summary, null, 2));
  const ok = summary.bought > 0 || (summary.dryRun && summary.aborted === 0 && summary.needsHuman === 0);
  process.exit(ok || summary.dryRun ? (summary.aborted && !summary.bought ? 2 : 0) : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
