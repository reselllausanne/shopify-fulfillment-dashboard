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

/**
 * GET text: uses curl+proxy when a pool/override exists, else native fetch.
 * Rotates proxy on each call when using the shared pool.
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
  const proxy = nextScraperProxyUrl(init.shopKey);
  if (proxy || init.forceCurl) {
    return fetchTextViaCurl(url, headers, proxy, timeoutMs);
  }
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
