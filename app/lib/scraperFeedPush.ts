import { requestFeedPush } from "@/galaxus/ops/feedPipeline";
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

/** Host pending images, then queue Galaxus master-specs + stock-price SFTP uploads. */
export async function scheduleScraperGalaxusFeedPush(params: {
  shop: ScraperShop;
  wrote: number;
  syncImages?: boolean;
}): Promise<void> {
  const { shop, wrote, syncImages = true } = params;
  if (!scraperGalaxusFeedPushEnabled() || shop.gated || wrote <= 0) return;

  const origin = feedPushOrigin();

  if (syncImages) {
    try {
      await runImageSync({
        supplierKeys: [shop.key],
        full: true,
        limit: 5000,
        concurrency: 8,
      });
    } catch (err) {
      console.warn(
        `[SCRAPER] ${shop.key} pre-push image sync failed:`,
        (err as Error)?.message || err
      );
    }
  }

  try {
    await requestFeedPush({ origin, scope: "master-specs", triggerSource: "scraper", runNow: true });
    await requestFeedPush({ origin, scope: "stock-price", triggerSource: "scraper", runNow: true });
    console.info(`[SCRAPER] ${shop.key} Galaxus feed push queued (wrote=${wrote})`);
  } catch (err) {
    console.warn(`[SCRAPER] ${shop.key} Galaxus feed push failed:`, (err as Error)?.message || err);
  }
}
