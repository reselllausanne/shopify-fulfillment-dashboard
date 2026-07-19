import { NextResponse } from "next/server";
import { parseScraperShops, findScraperShop } from "@/app/lib/scraperShops";
import { startRun, scrapeShop, hasRunningRun, recoverStaleRuns } from "@/app/lib/shopifyScrape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Kick off a scrape. Runs in the background (fire-and-forget) and returns
 * immediately with the started run ids; poll /api/scraper/overview for progress.
 *
 * Params: shop=<key> (default: all configured shops), max=<n> (cap products, testing).
 */
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const shopKey = (searchParams.get("shop") || "").trim().toLowerCase();
  const maxRaw = Number(searchParams.get("max") || 0);
  const maxProducts = Number.isFinite(maxRaw) && maxRaw > 0 ? Math.floor(maxRaw) : undefined;

  const shops = shopKey ? [findScraperShop(shopKey)].filter(Boolean) : parseScraperShops();
  if (shops.length === 0) {
    return NextResponse.json(
      { ok: false, error: shopKey ? `Unknown shop '${shopKey}'` : "No shops configured (set SCRAPER_SHOPS)." },
      { status: 400 }
    );
  }

  // Recover any run left 'running' by a previous crash/restart so it can't block us.
  await recoverStaleRuns(20);

  const started: Array<{ shop: string; runId: number }> = [];
  const skipped: string[] = [];

  for (const shop of shops) {
    if (!shop) continue;
    if (await hasRunningRun(shop.key)) {
      skipped.push(shop.key);
      continue;
    }
    const runId = await startRun(shop);
    started.push({ shop: shop.key, runId });
    // Fire-and-forget: keep processing after the response returns.
    void scrapeShop(shop, runId, maxProducts).catch((e) => {
      console.error(`[SCRAPER] ${shop.key} run#${runId} failed:`, e?.message || e);
    });
  }

  return NextResponse.json({
    ok: true,
    started,
    skipped,
    message: started.length
      ? `Scraping ${started.map((s) => s.shop).join(", ")} in background.`
      : "Nothing started (already running).",
  });
}
