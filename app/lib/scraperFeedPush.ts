// Use Core (no `server-only`) so scraper CLI (tsx) can schedule pushes too.
import { requestFeedPush } from "@/galaxus/ops/feedPipelineCore";
import { runImageSync } from "@/galaxus/jobs/imageSync";
import type { ScraperShop } from "@/app/lib/scraperShops";

function feedPushOrigin(): string {
  const raw =
    process.env.GALAXUS_OPS_BASE_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "http://127.0.0.1:3000";
  return raw.replace(/\/+$/, "");
}

export function scraperGalaxusFeedPushEnabled(): boolean {
  return String(process.env.SCRAPER_GALAXUS_FEED_PUSH ?? "1").trim() !== "0";
}

/**
 * Queue Galaxus master-specs + stock-price immediately (uses sourceImageUrl when
 * hosted not ready). Optionally host images in the background afterward; feed
 * picker prefers hosted JPEG once SYNCED, so later master pushes switch over.
 */
export async function scheduleScraperGalaxusFeedPush(params: {
  shop: ScraperShop;
  wrote: number;
  /** Host images in background after push (default true). Does not block push. */
  syncImages?: boolean;
}): Promise<void> {
  const { shop, wrote, syncImages = true } = params;
  if (!scraperGalaxusFeedPushEnabled() || shop.gated || wrote <= 0) return;

  const origin = feedPushOrigin();

  try {
    await requestFeedPush({ origin, scope: "master-specs", triggerSource: "scraper", runNow: true });
    await requestFeedPush({ origin, scope: "stock-price", triggerSource: "scraper", runNow: true });
    console.info(`[SCRAPER] ${shop.key} Galaxus feed push queued (wrote=${wrote})`);
  } catch (err) {
    console.warn(`[SCRAPER] ${shop.key} Galaxus feed push failed:`, (err as Error)?.message || err);
  }

  if (!syncImages) return;

  // Gradual host — do not delay the push above.
  void (async () => {
    try {
      const result = await runImageSync({
        supplierKeys: [shop.key],
        full: true,
        limit: 5000,
        concurrency: 8,
      });
      const synced = Number((result as { synced?: number } | null)?.synced ?? 0);
      console.info(`[SCRAPER] ${shop.key} background image sync done (synced=${synced})`);
      if (synced > 0) {
        // Re-push master so Galaxus picks hosted URLs for newly synced rows.
        await requestFeedPush({
          origin,
          scope: "master-specs",
          triggerSource: "scraper",
          runNow: true,
        });
      }
    } catch (err) {
      console.warn(
        `[SCRAPER] ${shop.key} background image sync failed:`,
        (err as Error)?.message || err
      );
    }
  })();
}
