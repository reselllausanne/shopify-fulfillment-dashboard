/**
 * Central scraper runner — every API / CLI / cron path must finalize exactly once.
 */
import type { ScraperShop } from "@/app/lib/scraperShops";
import { findScraperShop, parseScraperShops } from "@/app/lib/scraperShops";
import { startRun, scrapeShop, hasRunningRun, recoverStaleRuns } from "@/app/lib/shopifyScrape";
import { scrapeReicheltShop } from "@/app/lib/reicheltScrape";
import { scrapeFantasyweltShop } from "@/app/lib/fantasyweltScrape";
import { scrapeExlibrisShop } from "@/app/lib/exlibrisScrape";
import { scrapeHawkShop } from "@/app/lib/hawkScrape";
import { scrapeBabyWalzShop } from "@/app/lib/babyWalzScrape";
import { scrapeUncommonShop } from "@/app/lib/uncommonScrape";
import { scrapeAlternateShop } from "@/app/lib/alternateScrape";
import { scrapeVenovaShop } from "@/app/lib/venovaScrape";
import { finalizeSupplierStockFromScrapeRun } from "@/inventory/supplierStock/hookScrape";
import { drainFanObservations } from "@/inventory/supplierStock/fanObservation";
import "@/inventory/supplierStock/fanObservation";
import type { FinalizeRunResult } from "@/inventory/supplierStock/applyRun";
import type { SnapshotCompleteness, SupplierVariantObservation } from "@/inventory/supplierStock/types";

export type ScrapeFn = (
  shop: ScraperShop,
  runId: number,
  maxProducts?: number
) => Promise<void>;

const KILLED_SCRAPERS: Record<string, string> = {
  bae: "BAE_SCRAPER_KILLED — Bächli removed from codebase",
  hhv: "HHV_SCRAPER_KILLED — HHV removed from codebase",
  snl: "SNL_SCRAPER_KILLED — Snowleader removed (no GTIN)",
  nso: "NSO_SCRAPER_KILLED — Newsole removed from codebase",
};

export function resolveScrapeFn(shop: ScraperShop): ScrapeFn {
  switch (shop.platform) {
    case "rei":
      return scrapeReicheltShop;
    case "fan":
      return scrapeFantasyweltShop;
    case "exl":
      return scrapeExlibrisShop;
    case "haw":
      return scrapeHawkShop;
    case "bwz":
      return scrapeBabyWalzShop;
    case "tus":
      return scrapeUncommonShop;
    case "alt":
      return scrapeAlternateShop;
    case "ven":
      return scrapeVenovaShop;
    default:
      return scrapeShop;
  }
}

export type RunScraperJobInput = {
  shopKey: string;
  maxProducts?: number;
  /** When set, skip startRun (caller already created the run). */
  existingRunId?: number;
  background?: boolean;
  observations?: SupplierVariantObservation[];
  snapshotCompleteness?: SnapshotCompleteness;
  incompletenessReason?: string | null;
  /** Collect observations during scrape — future scrapers push here. */
  observationSink?: SupplierVariantObservation[];
};

export type RunScraperJobResult = {
  ok: boolean;
  shop: string;
  runId: number | null;
  skipped?: boolean;
  error?: string;
  finalize?: FinalizeRunResult;
};

/**
 * Run one shop scrape then finalize stock reconciliation exactly once.
 * CLI scripts and the API route must use this (or call finalize in finally).
 */
export async function runScraperJob(input: RunScraperJobInput): Promise<RunScraperJobResult> {
  const shopKey = String(input.shopKey ?? "")
    .trim()
    .toLowerCase();
  const killed = KILLED_SCRAPERS[shopKey];
  if (killed) {
    return {
      ok: false,
      shop: shopKey,
      runId: null,
      error: killed,
    };
  }

  const shop = findScraperShop(input.shopKey) ?? parseScraperShops().find((s) => s.key === input.shopKey);
  if (!shop) {
    return { ok: false, shop: input.shopKey, runId: null, error: `Unknown shop '${input.shopKey}'` };
  }

  await recoverStaleRuns(Number(process.env.SCRAPER_STALE_RUN_MINUTES || 90));

  if (!input.existingRunId && (await hasRunningRun(shop.key))) {
    return { ok: false, shop: shop.key, runId: null, skipped: true, error: "already_running" };
  }

  const runId = input.existingRunId ?? (await startRun(shop));
  const runScrape = resolveScrapeFn(shop);
  const partialRun = Boolean(input.maxProducts && input.maxProducts > 0);
  const snapshotCompleteness: SnapshotCompleteness =
    input.snapshotCompleteness ?? (partialRun ? "partial" : "unknown");
  const incompletenessReason =
    input.incompletenessReason ??
    (partialRun ? "max_products_limit" : "snapshot_not_declared_full");

  const execute = async (): Promise<FinalizeRunResult> => {
    try {
      await runScrape(shop, runId, input.maxProducts);
    } catch (e: any) {
      console.error(`[SCRAPER] ${shop.key} run#${runId} failed:`, e?.message || e);
    }
    const fanObs = shop.key === "fan" ? drainFanObservations(runId) : [];
    const observations: SupplierVariantObservation[] | undefined =
      input.observations ??
      (input.observationSink?.length
        ? input.observationSink
        : fanObs.length
          ? fanObs
          : undefined);
    return finalizeSupplierStockFromScrapeRun(shop.key, runId, {
      observations,
      snapshotCompleteness,
      incompletenessReason,
      partialRun,
    });
  };

  if (input.background) {
    void execute()
      .then((result) => {
        console.log(
          `[supplier-stock] ${shop.key} run#${runId} finalize valid=${result.valid} reason=${result.invalidReason ?? "-"} paused=${result.paused} observations=${result.observationContractPresent}`
        );
      })
      .catch((e: any) => {
        console.error(`[supplier-stock] ${shop.key} run#${runId} finalize failed:`, e?.message || e);
      });
    return { ok: true, shop: shop.key, runId };
  }

  const finalize = await execute();
  return { ok: true, shop: shop.key, runId, finalize };
}

/** Call-site checklist — keep in sync with scripts + API. */
export const SCRAPER_STOCK_HOOK_CALL_SITES = [
  { path: "app/api/scraper/scrape/route.ts", via: "runScraperJob / finalize in finally", hooked: true },
  { path: "scripts/scrape-cron.sh", via: "POST /api/scraper/scrape", hooked: true },
  { path: "scripts/run-reichelt-scrape.ts", via: "runScraperJob", hooked: true },
  { path: "scripts/run-reichelt-detached.sh", via: "run-reichelt-scrape.ts", hooked: true },
  { path: "scripts/run-fantasywelt-scrape.ts", via: "runScraperJob", hooked: true },
  { path: "scripts/run-fantasywelt-detached.sh", via: "run-fantasywelt-scrape.ts", hooked: true },
  { path: "scripts/run-exlibris-scrape.ts", via: "runScraperJob", hooked: true },
  { path: "scripts/run-exlibris-detached.sh", via: "run-exlibris-scrape.ts", hooked: true },
  { path: "scripts/run-hawk-scrape.ts", via: "runScraperJob", hooked: true },
  { path: "scripts/run-baby-walz-scrape.ts", via: "runScraperJob", hooked: true },
  { path: "scripts/run-uncommon-scrape.ts", via: "runScraperJob", hooked: true },
  { path: "scripts/run-alternate-scrape.ts", via: "runScraperJob", hooked: true },
  { path: "scripts/run-venova-scrape.ts", via: "runScraperJob", hooked: true },
] as const;
