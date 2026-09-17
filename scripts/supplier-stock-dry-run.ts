/**
 * Dry-run supplier stock finalize or seed policies (staging/local ONLY).
 *
 *   npx tsx scripts/supplier-stock-dry-run.ts --supplier=exl --listed=0 --wrote=0 --priorActive=90000
 *   SUPPLIER_STOCK_ALLOW_SEED=1 npx tsx scripts/supplier-stock-dry-run.ts --seed-policies
 */
import "dotenv/config";
import {
  ensureSupplierStockPolicies,
  finalizeSupplierStockRun,
  maySeedSupplierStockPolicies,
} from "@/inventory/supplierStock/applyRun";
import { evaluateScrapeRunValidity } from "@/inventory/supplierStock/runValidity";
import { validateFreshSourceEvidence } from "@/inventory/supplierStock/observation";
import { decidePublishedQuantity, halfCeilStock } from "@/inventory/supplierStock/quantity";
import type { ScrapeRunMetrics, SupplierVariantObservation } from "@/inventory/supplierStock/types";
import { SCRAPER_STOCK_HOOK_CALL_SITES } from "@/app/lib/scraperRunner";

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
  if (process.argv.includes("--call-sites")) {
    console.log(JSON.stringify({ callSites: SCRAPER_STOCK_HOOK_CALL_SITES }, null, 2));
    return;
  }

  if (process.argv.includes("--seed-policies")) {
    if (!maySeedSupplierStockPolicies()) {
      console.error(
        JSON.stringify({
          ok: false,
          error: "Refusing seed — set SUPPLIER_STOCK_ALLOW_SEED=1 (staging/local only). Never seed production automatically.",
        })
      );
      process.exitCode = 1;
      return;
    }
    const count = await ensureSupplierStockPolicies();
    console.log(JSON.stringify({ ok: true, seeded: count }));
    return;
  }

  const supplierKey = (arg("supplier") || "exl").trim().toLowerCase();
  const listed = numArg("listed");
  const wrote = numArg("wrote");
  const priorActive = numArg("priorActive", 90_000);
  const scrapeRunId = numArg("runId", 0);
  const status = arg("status") || "ok";
  const snapshot = (arg("snapshot") || "unknown") as "full" | "partial" | "unknown";

  const metrics: ScrapeRunMetrics = {
    supplierKey,
    scrapeRunId: scrapeRunId || 1,
    status,
    message: `dry-run listed=${listed} wrote=${wrote}`,
    productsListed: listed,
    variantsUpserted: wrote,
    withGtin: wrote,
    errors: 0,
    priorActiveCatalog: priorActive,
    finishedAt: new Date(),
    snapshotCompleteness: snapshot,
    previousReliableSnapshotCount: priorActive > 0 ? priorActive : null,
    partialRun: snapshot === "partial",
  };

  const validity = evaluateScrapeRunValidity(metrics);
  console.log(JSON.stringify({ phase: "validity", supplierKey, metrics, validity }, null, 2));

  // Demo: historical DB stock alone is rejected
  const fakeFromDb: SupplierVariantObservation = {
    supplierKey,
    supplierVariantId: `${supplierKey}_hist`,
    sourceAvailability: "unknown",
    scrapeRunId: 1,
    observedAt: new Date(),
    supplierStockQty: 5,
    sourcePrice: 10,
  };
  console.log(
    JSON.stringify({
      phase: "db_stock_is_not_proof",
      check: validateFreshSourceEvidence(fakeFromDb),
      halfCeil: { 1: halfCeilStock(1), 2: halfCeilStock(2), 3: halfCeilStock(3), 4: halfCeilStock(4), 5: halfCeilStock(5) },
      qtyUnknown: decidePublishedQuantity({
        availabilityStatus: "confirmed_in_stock",
        supplierStockQty: null,
        quantityUnknown: true,
        hasFreshSourceEvidence: true,
      }),
    })
  );

  if (scrapeRunId > 0) {
    const result = await finalizeSupplierStockRun({
      supplierKey,
      scrapeRunId,
      dryRun: true,
      priorActiveCatalog: priorActive,
      snapshotCompleteness: snapshot,
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
