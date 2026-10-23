/**
 * Residential proxy for StockX Playwright remint (LemonPrime / LemonProxy).
 *
 * Env priority:
 *   1. STOCKX_PROXY_FILE / STOCKX_PROXY_URLS — multi-line sticky pool (round-robin)
 *   2. STOCKX_PROXY / STOCKX_PROXY_URL / STOCKX_PROXY_SERVER (+ USER/PASS)
 *   3. Fallback: SCRAPER_PROXY_FILE / SCRAPER_PROXY_URLS (shared Reichelt pool)
 *
 * Mode:
 *   STOCKX_BROWSER_PROXY_MODE=off | on_fail | always
 *   default on_fail — try direct/warm first, then proxy remint
 *
 * STOCKX_PROXY_FILE is StockX-only; does not touch SCRAPER_PROXY_FILE.
 */
import fs from "node:fs";
import { nextScraperProxyUrl, scraperProxyPool } from "@/app/lib/scraperProxy";

export type PlaywrightProxyConfig = {
  server: string;
  username?: string;
  password?: string;
  label: string;
};

export type StockxBrowserProxyMode = "off" | "on_fail" | "always";

export function stockxBrowserProxyMode(): StockxBrowserProxyMode {
  const raw = String(process.env.STOCKX_BROWSER_PROXY_MODE ?? "on_fail")
    .trim()
    .toLowerCase();
  if (raw === "off" || raw === "0" || raw === "false") return "off";
  if (raw === "always" || raw === "on" || raw === "1" || raw === "true") return "always";
  return "on_fail";
}

/** Parse http(s)://user:pass@host:port or host:port:user:pass → Playwright proxy. */
export function parsePlaywrightProxyUrl(raw: string): PlaywrightProxyConfig | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      if (!u.hostname || !u.port) return null;
      const username = u.username ? decodeURIComponent(u.username) : undefined;
      const password = u.password ? decodeURIComponent(u.password) : undefined;
      return {
        server: `${u.protocol}//${u.hostname}:${u.port}`,
        username: username || undefined,
        password: password || undefined,
        label: `${u.hostname}:${u.port}`,
      };
    }
    const parts = s.split(":");
    if (parts.length >= 4) {
      const [host, port, username, ...rest] = parts;
      const password = rest.join(":");
      if (!host || !port) return null;
      return {
        server: `http://${host}:${port}`,
        username,
        password,
        label: `${host}:${port}`,
      };
    }
    if (parts.length === 2) {
      return { server: `http://${parts[0]}:${parts[1]}`, label: `${parts[0]}:${parts[1]}` };
    }
  } catch {
    return null;
  }
  return null;
}

function splitProxyEntries(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizePoolEntry(raw: string): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      if (!u.hostname) return null;
      return u.toString();
    }
    const parts = s.split(":");
    if (parts.length >= 4) {
      const [host, port, user, ...rest] = parts;
      const pass = rest.join(":");
      if (!host || !port) return null;
      return new URL(
        `http://${encodeURIComponent(user!)}:${encodeURIComponent(pass)}@${host}:${port}`
      ).toString();
    }
    if (parts.length === 2) {
      return new URL(`http://${parts[0]}:${parts[1]}`).toString();
    }
  } catch {
    return null;
  }
  return null;
}

let stockxPoolCache: string[] | null = null;
let stockxPoolCursor = 0;

function readStockxProxyFileEntries(): string[] {
  const filePath = String(process.env.STOCKX_PROXY_FILE ?? "").trim();
  if (!filePath) return [];
  try {
    if (!fs.existsSync(filePath)) return [];
    return splitProxyEntries(fs.readFileSync(filePath, "utf8"));
  } catch {
    return [];
  }
}

/**
 * StockX-dedicated sticky pool from STOCKX_PROXY_FILE / STOCKX_PROXY_URLS.
 * Empty → caller falls through to single STOCKX_PROXY_* or SCRAPER pool.
 */
export function stockxProxyFilePool(): string[] {
  if (stockxPoolCache) return stockxPoolCache;
  const multi = String(process.env.STOCKX_PROXY_URLS ?? "").trim();
  const rawEntries = [
    ...readStockxProxyFileEntries(),
    ...(multi ? splitProxyEntries(multi) : []),
  ];
  const seen = new Set<string>();
  stockxPoolCache = [];
  for (const entry of rawEntries) {
    const url = normalizePoolEntry(entry);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    stockxPoolCache.push(url);
  }
  return stockxPoolCache;
}

/** Reset StockX file-pool cache (tests). */
export function resetStockxProxyFilePoolCache(): void {
  stockxPoolCache = null;
  stockxPoolCursor = 0;
}

function nextFromStockxFilePool(preferCountry?: string): PlaywrightProxyConfig | null {
  const pool = stockxProxyFilePool();
  if (!pool.length) return null;

  const prefer = (preferCountry || process.env.STOCKX_PROXY_COUNTRY || "ch")
    .trim()
    .toLowerCase();
  let candidates = pool;
  if (prefer) {
    const matched = pool.filter((u) => u.toLowerCase().includes(`country-${prefer}`));
    if (matched.length) candidates = matched;
  }

  // Round-robin within preferred slice (sticky sessions are distinct URLs).
  const idx = stockxPoolCursor % candidates.length;
  stockxPoolCursor += 1;
  return parsePlaywrightProxyUrl(candidates[idx]!);
}

function fromExplicitEnv(): PlaywrightProxyConfig | null {
  const url =
    String(process.env.STOCKX_PROXY_URL ?? "").trim() ||
    String(process.env.STOCKX_PROXY ?? "").trim();
  if (url) {
    const parsed = parsePlaywrightProxyUrl(url);
    if (parsed) return parsed;
  }

  const server = String(process.env.STOCKX_PROXY_SERVER ?? "").trim();
  if (!server) return null;
  const username = String(process.env.STOCKX_PROXY_USERNAME ?? "").trim() || undefined;
  const password = String(process.env.STOCKX_PROXY_PASSWORD ?? "").trim() || undefined;
  try {
    const withScheme = /^https?:\/\//i.test(server) ? server : `http://${server}`;
    const u = new URL(withScheme);
    if (!u.hostname) return null;
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    return {
      server: `${u.protocol}//${u.hostname}:${port}`,
      username: username || (u.username ? decodeURIComponent(u.username) : undefined),
      password: password || (u.password ? decodeURIComponent(u.password) : undefined),
      label: `${u.hostname}:${port}`,
    };
  } catch {
    return null;
  }
}

/**
 * Prefer STOCKX_PROXY_FILE stickies (rotate), else single STOCKX_PROXY_*, else
 * SCRAPER_PROXY_FILE pool. CH sticky preferred when country tag present.
 */
export function nextStockxPlaywrightProxy(opts?: {
  preferCountry?: string;
}): PlaywrightProxyConfig | null {
  const fromFile = nextFromStockxFilePool(opts?.preferCountry);
  if (fromFile) return fromFile;

  const explicit = fromExplicitEnv();
  if (explicit) return explicit;

  const prefer = (opts?.preferCountry || process.env.STOCKX_PROXY_COUNTRY || "ch")
    .trim()
    .toLowerCase();
  const pool = scraperProxyPool();
  if (prefer && pool.length) {
    const matched = pool.filter((u) => u.toLowerCase().includes(`country-${prefer}`));
    if (matched.length) {
      const pick = matched[Math.floor(Math.random() * matched.length)]!;
      return parsePlaywrightProxyUrl(pick);
    }
  }

  const fromPool =
    nextScraperProxyUrl("STOCKX") ||
    nextScraperProxyUrl() ||
    (pool[0] ? pool[0]! : null);
  if (!fromPool) return null;
  return parsePlaywrightProxyUrl(fromPool);
}

export function stockxPlaywrightProxyAvailable(): boolean {
  if (stockxBrowserProxyMode() === "off") return false;
  return Boolean(
    stockxProxyFilePool().length > 0 || fromExplicitEnv() || scraperProxyPool().length > 0
  );
}
