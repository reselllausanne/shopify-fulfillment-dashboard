/**
 * Residential proxy for StockX Playwright remint (LemonProxy / SCRAPER pool).
 *
 * Env (any one is enough):
 *   STOCKX_PROXY_SERVER=http://host:port   (+ optional USER/PASS)
 *   STOCKX_PROXY_URL=http://user:pass@host:port
 *   STOCKX_PROXY_USERNAME / STOCKX_PROXY_PASSWORD
 *   Or reuse scraper pool: SCRAPER_PROXY_FILE / SCRAPER_PROXY_URLS (same as GraphQL)
 *
 * Mode:
 *   STOCKX_BROWSER_PROXY_MODE=off | on_fail | always
 *   default on_fail — try direct/warm first, then proxy remint
 */
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
 * Prefer CH sticky sessions for StockX browser remint (store is CH; DE LemonProxy
 * often gets stockx.com 403 Error). Falls back to any pool entry.
 */
export function nextStockxPlaywrightProxy(opts?: {
  preferCountry?: string;
}): PlaywrightProxyConfig | null {
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
  return Boolean(fromExplicitEnv() || scraperProxyPool().length > 0);
}
