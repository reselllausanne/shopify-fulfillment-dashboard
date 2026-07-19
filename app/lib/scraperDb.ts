import { Pool } from "pg";

/**
 * Connection to the Shopify-catalog scraper tables.
 *
 * These live in the `scraper` schema of the SAME Supabase Postgres as the rest
 * of the app, so the exact same connection string works from localhost dev and
 * from the VPS (no tunnels, no exposed ports). Falls back to DATABASE_URL /
 * DIRECT_URL when SCRAPER_DATABASE_URL is not set.
 */

declare global {
  // eslint-disable-next-line no-var
  var scraperPgPool: Pool | undefined;
}

const globalForScraper = globalThis as typeof globalThis & { scraperPgPool?: Pool };

export function scraperDatabaseUrl(): string | null {
  const raw =
    String(process.env.SCRAPER_DATABASE_URL || "").trim() ||
    String(process.env.DATABASE_URL || "").trim() ||
    String(process.env.DIRECT_URL || "").trim();
  return raw || null;
}

export function isScraperDbConfigured(): boolean {
  return scraperDatabaseUrl() !== null;
}

export function getScraperPool(): Pool {
  const url = scraperDatabaseUrl();
  if (!url) {
    throw new Error(
      "SCRAPER_DATABASE_URL is not set. Point it at the shopify-scraper Postgres (db shopify_catalog)."
    );
  }
  if (!globalForScraper.scraperPgPool) {
    // pg v9 treats `sslmode=require` in the URL as verify-full (rejects Supabase's
    // chain). Strip sslmode and set SSL explicitly so rejectUnauthorized:false wins.
    const needsSsl = /sslmode=|supabase\.|amazonaws\.|\.pooler\./i.test(url);
    const cleanUrl = url.replace(/([?&])sslmode=[^&]*/gi, "$1").replace(/[?&]+$/g, "").replace(/\?&/g, "?");
    globalForScraper.scraperPgPool = new Pool({
      connectionString: cleanUrl,
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    });
  }
  return globalForScraper.scraperPgPool;
}

export async function scraperQuery<T = any>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const pool = getScraperPool();
  const res = await pool.query(text, params as any[]);
  return res.rows as T[];
}
