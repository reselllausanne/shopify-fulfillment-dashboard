/**
 * Dry-run supplier stock finalize or seed policies.
 *
 *   npx tsx scripts/supplier-stock-dry-run.ts --supplier=exl --listed=0 --wrote=0 --priorActive=90000
 *   npx tsx scripts/supplier-stock-dry-run.ts --seed-policies
 */
import "dotenv/config";
import { ensureSupplierStockPolicies, finalizeSupplierStockRun } from "@/inventory/supplierStock/applyRun";
import { evaluateScrapeRunValidity } from "@/inventory/supplierStock/runValidity";
import type { ScrapeRunMetrics } from "@/inventory/supplierStock/types";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : undefined;
}

function numArg(name: string, fallback = 0): number {
  const raw = arg(name);
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

async function main() {
  if (process.argv.includes("--seed-policies")) {
    const count = await ensureSupplierStockPolicies();
    console.log(JSON.stringify({ ok: true, seeded: count }));
    return;
  }

  const supplierKey = (arg("supplier") || "exl").trim().toLowerCase();
  const listed = numArg("listed");
  const wrote = numArg("wrote");
  const priorActive = numArg("priorActive", 90_000);
  const scrapeRunId = numArg("runId", 0);

  const metrics: ScrapeRunMetrics = {
    supplierKey,
    scrapeRunId: scrapeRunId || 1,
    status: "ok",
    message: `dry-run listed=${listed} wrote=${wrote}`,
    productsListed: listed,
    variantsUpserted: wrote,
    withGtin: wrote,
    errors: 0,
    priorActiveCatalog: priorActive,
  };

  const validity = evaluateScrapeRunValidity(metrics);
  console.log(JSON.stringify({ phase: "validity", supplierKey, metrics, validity }, null, 2));

  if (scrapeRunId > 0) {
    const result = await finalizeSupplierStockRun({
      supplierKey,
      scrapeRunId,
      dryRun: true,
      priorActiveCatalog: priorActive,
    });
    console.log(JSON.stringify({ phase: "finalize", result }, null, 2));
  } else {
    console.log(
      JSON.stringify({
        phase: "finalize_skipped",
        hint: "Pass --runId=<scraper.scrape_runs.id> to dry-run full finalize against DB run row",
      })
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
