import { GALAXUS_FEED_SUPPLIER_ALLOWLIST } from "@/galaxus/config";

/**
 * Websites to scrape are configured via the SCRAPER_SHOPS env var.
 * Format: comma-separated entries `KEY|Name|baseUrl[|CURRENCY][|platform]`
 *   KEY  = supplier key, MUST be 3 letters (becomes the Galaxus ProviderKey prefix)
 *   Name = display name
 *   baseUrl = storefront root (e.g. https://www.wellplayed.ch)
 *   CURRENCY = optional ISO code (default CHF)
 *   platform = optional adapter: shopify (default) | hhv
 *
 * Example:
 *   SCRAPER_SHOPS=WEL|WellPlayed|https://www.wellplayed.ch,HHV|HHV|https://www.hhv.de|EUR|hhv
 */

export type ScraperPlatform = "shopify" | "hhv";

export type ScraperShop = {
  key: string; // lowercase, used as shop_id + VariantMapping.supplierKey
  code: string; // uppercase 3-letter provider code
  name: string;
  baseUrl: string;
  currency: string;
  platform: ScraperPlatform;
  gated: boolean; // true = NOT in Galaxus feed allowlist (won't be sent)
};

function allowlistKeys(): Set<string> {
  return new Set(
    GALAXUS_FEED_SUPPLIER_ALLOWLIST.split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function parseScraperShops(): ScraperShop[] {
  const raw = String(process.env.SCRAPER_SHOPS || "").trim();
  if (!raw) return [];
  const allow = allowlistKeys();
  const out: ScraperShop[] = [];
  const seen = new Set<string>();

  for (const entry of raw.split(",")) {
    const parts = entry.split("|").map((p) => p.trim());
    const [rawKey, name, baseUrl, currencyOrPlatform, platformRaw] = parts;
    if (!rawKey || !baseUrl) continue;
    const key = rawKey.toLowerCase().replace(/[^a-z0-9]/g, "");
    const code = key.slice(0, 3).toUpperCase();
    if (code.length !== 3) continue;
    if (seen.has(key)) continue;
    seen.add(key);

    const currencyCandidate = String(currencyOrPlatform || "").toUpperCase();
    const currency =
      currencyCandidate.length === 3 && /^[A-Z]{3}$/.test(currencyCandidate) ? currencyCandidate : "CHF";
    const platformCandidate = String(platformRaw || currencyOrPlatform || "shopify").toLowerCase();
    const platform: ScraperPlatform = platformCandidate === "hhv" ? "hhv" : "shopify";

    out.push({
      key,
      code,
      name: name || rawKey,
      baseUrl: baseUrl.replace(/\/+$/, ""),
      currency,
      platform,
      // allowlist is checked against the lowercase key AND the 3-letter code
      gated: !(allow.has(key) || allow.has(code.toLowerCase())),
    });
  }
  return out;
}

export function findScraperShop(key: string): ScraperShop | null {
  const k = key.trim().toLowerCase();
  return parseScraperShops().find((s) => s.key === k) || null;
}
