/**
 * Node-only startup hooks.
 * Do not statically import Node builtins / native addons — Next also analyzes
 * this file for Edge (crypto/ssh2/cpu-features crash the browser graph).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // `.env` is already loaded by `next dev` / `next start` — skip @next/env here.

  if (process.env.SCRAPER_RECOVER_ORPHANS_ON_STARTUP === "0") return;

  try {
    // Dynamic path + Function constructor import so webpack/Edge cannot follow
    // the scraper → SFTP → ssh2 → cpu-features.node chain.
    const dynamicImport = new Function("m", "return import(m)") as (
      m: string
    ) => Promise<any>;
    const scrape = await dynamicImport(
      pathToScraperModule("@/app/lib/shopifyScrape")
    );
    const orphaned = await scrape.recoverOrphanedRuns();
    if (orphaned > 0) {
      console.log(`[SCRAPER] recovered ${orphaned} orphaned running scrape run(s) on startup`);
    }
    await scrape.recoverStaleRuns(Number(process.env.SCRAPER_STALE_RUN_MINUTES || 90));
    if (process.env.SCRAPER_AUTO_RESUME_ON_STARTUP !== "0") {
      const resume = await dynamicImport(
        pathToScraperModule("@/app/lib/scraperResume")
      );
      const resumed = await resume.resumeInterruptedScrapes();
      if (resumed.length) {
        console.log(`[SCRAPER] auto-resumed interrupted scrape(s): ${resumed.join(", ")}`);
      }
    }
  } catch (err) {
    console.warn("[SCRAPER] startup recovery skipped:", (err as Error)?.message || err);
  }
}

function pathToScraperModule(specifier: string): string {
  return specifier;
}
