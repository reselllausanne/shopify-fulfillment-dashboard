import { scraperQuery } from "@/app/lib/scraperDb";
import type { ScraperShop } from "@/app/lib/scraperShops";

async function ensureShopRow(shop: ScraperShop) {
  await scraperQuery(
    `INSERT INTO scraper.shops (id, name, base_url, enabled)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, base_url = EXCLUDED.base_url, enabled = TRUE`,
    [shop.key, shop.name, shop.baseUrl]
  );
}

export async function startRun(shop: ScraperShop): Promise<number> {
  await ensureShopRow(shop);
  const rows = await scraperQuery<{ id: string }>(
    `INSERT INTO scraper.scrape_runs (shop_id, status) VALUES ($1, 'running') RETURNING id`,
    [shop.key]
  );
  return Number(rows[0].id);
}

/** Mark runs stuck in 'running' longer than maxAgeMin as errored (crash recovery). */
export async function recoverStaleRuns(maxAgeMin = 20): Promise<void> {
  try {
    await scraperQuery(
      `UPDATE scraper.scrape_runs
         SET status = 'error', finished_at = NOW(),
             message = COALESCE(message, '') || ' [auto-recovered: stale run]'
       WHERE status = 'running'
         AND started_at < NOW() - make_interval(mins => $1::int)`,
      [maxAgeMin]
    );
  } catch {
    /* best-effort */
  }
}

export async function hasRunningRun(shopKey: string): Promise<boolean> {
  const rows = await scraperQuery<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM scraper.scrape_runs WHERE shop_id = $1 AND status = 'running'`,
    [shopKey]
  );
  return Number(rows[0]?.n || 0) > 0;
}
