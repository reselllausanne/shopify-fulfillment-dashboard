/**
 * Ensures `.env*` from the project root are merged into `process.env` on the Node
 * server runtime (same behaviour as `next dev`, but explicit for `next start` /
 * Docker cwd edge cases).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadEnvConfig } = await import("@next/env");
  // Avoid direct Node API call that Edge analyzer flags in shared instrumentation file.
  loadEnvConfig(".");

  if (process.env.SCRAPER_RECOVER_ORPHANS_ON_STARTUP !== "0") {
    try {
      const { recoverOrphanedRuns, recoverStaleRuns } = await import("@/app/lib/shopifyScrape");
      const orphaned = await recoverOrphanedRuns();
      if (orphaned > 0) {
        console.log(`[SCRAPER] recovered ${orphaned} orphaned running scrape run(s) on startup`);
      }
      await recoverStaleRuns(Number(process.env.SCRAPER_STALE_RUN_MINUTES || 90));
      if (process.env.SCRAPER_AUTO_RESUME_ON_STARTUP !== "0") {
        const { resumeInterruptedScrapes } = await import("@/app/lib/scraperResume");
        const resumed = await resumeInterruptedScrapes();
        if (resumed.length) {
          console.log(`[SCRAPER] auto-resumed interrupted scrape(s): ${resumed.join(", ")}`);
        }
      }
    } catch (err) {
      console.warn("[SCRAPER] startup recovery skipped:", (err as Error)?.message || err);
    }
  }
}
