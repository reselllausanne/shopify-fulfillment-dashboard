/**
 * Shared scraper HTTP(S) proxy pool + fetch helper.
 *
 * Pool sources (first non-empty wins per entry, de-duped):
 *   SCRAPER_PROXY_FILE / SCRAPER_REI_PROXY_FILE
 *   SCRAPER_PROXY_URLS / SCRAPER_REI_PROXY_URLS
 *   SCRAPER_PROXY_URL / SCRAPER_PROXY / SCRAPER_REI_PROXY_URL
 *   shop override: SCRAPER_<SHOP>_PROXY (e.g. SCRAPER_HAW_PROXY)
 *
 * Native fetch has no HTTP proxy; when a proxy is selected we use curl --proxy
 * (same pattern as Reichelt). Without proxies → plain fetch.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ScraperProxyFetchInit = {
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Shop key for SCRAPER_<KEY>_PROXY override (haw, bae, exl, …). */
  shopKey?: string;
  /** Force curl even without proxy (default: only when proxy selected). */
  forceCurl?: boolean;
};

let proxyPoolCache: string[] | null = null;
let proxyPoolCursor = 0;

function splitProxyEntries(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeProxyUrl(raw: string): string | null {
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
    return new URL(`http://${s}`).toString();
  } catch {
    return null;
  }
}

function readProxyFileEntries(): string[] {
  const filePath =
    String(process.env.SCRAPER_PROXY_FILE ?? "").trim() ||
    String(process.env.SCRAPER_REI_PROXY_FILE ?? "").trim();
  if (!filePath) return [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    if (!fs.existsSync(filePath)) return [];
    return splitProxyEntries(fs.readFileSync(filePath, "utf8"));
  } catch {
    return [];
  }
}

/** Round-robin residential/shared proxy pool. Empty = direct. */
export function scraperProxyPool(): string[] {
  if (proxyPoolCache) return proxyPoolCache;
  const multi =
    String(process.env.SCRAPER_PROXY_URLS ?? "").trim() ||
    String(process.env.SCRAPER_REI_PROXY_URLS ?? "").trim();
  const single =
    String(process.env.SCRAPER_PROXY_URL ?? "").trim() ||
    String(process.env.SCRAPER_PROXY ?? "").trim() ||
    String(process.env.SCRAPER_REI_PROXY_URL ?? "").trim();
  const rawEntries = [
    ...readProxyFileEntries(),
    ...(multi ? splitProxyEntries(multi) : []),
    ...(single ? [single] : []),
  ];
  const seen = new Set<string>();
  proxyPoolCache = [];
  for (const entry of rawEntries) {
    const url = normalizeProxyUrl(entry);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    proxyPoolCache.push(url);
  }
  return proxyPoolCache;
}

/** Reset pool cache (tests). */
export function resetScraperProxyPoolCache(): void {
  proxyPoolCache = null;
  proxyPoolCursor = 0;
}

export function nextScraperProxyUrl(shopKey?: string): string | null {
  const key = String(shopKey || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (key) {
    const shopProxy = String(process.env[`SCRAPER_${key}_PROXY`] || "").trim();
    if (shopProxy) return normalizeProxyUrl(shopProxy.startsWith("http") ? shopProxy : `http://${shopProxy}`);
  }
  const pool = scraperProxyPool();
  if (!pool.length) return null;
  const url = pool[proxyPoolCursor % pool.length]!;
  proxyPoolCursor = (proxyPoolCursor + 1) % pool.length;
  return url;
}

async function fetchTextViaCurl(
  url: string,
  headers: Record<string, string>,
  proxy: string | null,
  timeoutMs: number
): Promise<string> {
  const args = [
    "-sL",
    "--compressed",
    "--max-time",
    String(Math.max(5, Math.ceil(timeoutMs / 1000))),
    "-w",
    "\n__SCRAPER_CURL_HTTP__:%{http_code}",
  ];
  if (proxy) args.push("--proxy", proxy);
  for (const [k, v] of Object.entries(headers)) {
    if (!v) continue;
    args.push("-H", `${k}: ${v}`);
  }
  args.push(url);
  const { stdout } = await execFileAsync("curl", args, {
    maxBuffer: 25 * 1024 * 1024,
    encoding: "utf8",
  });
  const marker = "\n__SCRAPER_CURL_HTTP__:";
  const idx = stdout.lastIndexOf(marker);
  const body = idx >= 0 ? stdout.slice(0, idx) : stdout;
  const status = idx >= 0 ? Number(stdout.slice(idx + marker.length).trim()) : 0;
  if (status && status >= 400) {
    throw new Error(`HTTP ${status}`);
  }
  return body;
}

function looksBlocked(status: number, body: string): boolean {
  if (status === 403 || status === 429 || status === 502 || status === 503) return true;
  const sample = body.slice(0, 4000).toLowerCase();
  return (
    sample.includes("cf-browser-verification") ||
    sample.includes("just a moment") ||
    sample.includes("attention required") ||
    sample.includes("access denied") ||
    sample.includes("myracloud") ||
    sample.includes("<title>security check</title>")
  );
}

/**
 * GET text — direct first. Proxy only when locked/blocked (or forceCurl / always mode).
 * Modes: SCRAPER_PROXY_MODE=on_block (default) | always | off
 */
export async function scraperFetchText(url: string, init: ScraperProxyFetchInit = {}): Promise<string> {
  const timeoutMs = Math.max(5_000, Number(init.timeoutMs || 45_000));
  const headers: Record<string, string> = {
    "User-Agent":
      process.env.SCRAPER_USER_AGENT ||
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-CH,de;q=0.9,en;q=0.8",
    ...(init.headers || {}),
  };
  const mode = String(process.env.SCRAPER_PROXY_MODE || "on_block").trim().toLowerCase();
  const shopProxy = nextScraperProxyUrl(init.shopKey);
  const poolHasProxy = Boolean(shopProxy) || scraperProxyPool().length > 0;

  if (init.forceCurl || mode === "always") {
    const proxy = shopProxy || nextScraperProxyUrl(init.shopKey);
    if (proxy || init.forceCurl) {
      return fetchTextViaCurl(url, headers, proxy, timeoutMs);
    }
  }

  // Direct path (default / off)
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    const text = await res.text();
    if (res.ok && !looksBlocked(res.status, text)) return text;
    if (mode === "off" || !poolHasProxy) {
      throw new Error(`HTTP ${res.status}`);
    }
    // fall through to proxy retry
  } catch (err) {
    if (mode === "off" || !poolHasProxy) throw err;
    // proxy retry below
  }

  // Locked → one proxy attempt (rotate pool)
  const proxy = nextScraperProxyUrl(init.shopKey);
  if (!proxy) throw new Error(`HTTP blocked and no proxy configured for ${url}`);
  return fetchTextViaCurl(url, headers, proxy, timeoutMs);
}
