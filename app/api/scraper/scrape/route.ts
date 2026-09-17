import { NextResponse } from "next/server";
import { parseScraperShops, findScraperShop } from "@/app/lib/scraperShops";
import { hasRunningRun, recoverStaleRuns } from "@/app/lib/shopifyScrape";
import { runScraperJob } from "@/app/lib/scraperRunner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Kick off a scrape via the central runner (finalize stock reconciliation exactly once).
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

  await recoverStaleRuns(Number(process.env.SCRAPER_STALE_RUN_MINUTES || 90));

  const started: Array<{ shop: string; runId: number }> = [];
  const skipped: string[] = [];

  for (const shop of shops) {
    if (!shop) continue;
    if (await hasRunningRun(shop.key)) {
      skipped.push(shop.key);
      continue;
    }
    const result = await runScraperJob({
      shopKey: shop.key,
      maxProducts,
      background: true,
    });
    if (result.skipped || !result.runId) {
      skipped.push(shop.key);
      continue;
    }
    started.push({ shop: shop.key, runId: result.runId });
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
