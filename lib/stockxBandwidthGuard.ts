/**
 * StockX checkout bandwidth guard — keep LemonPrime residential GB tiny + measurable.
 *
 * LemonPrime bills the whole tunnel (bytes), not the number of stickies. Stickies are
 * free/unlimited; GB is the cost. So the lever for "cheap + reliable" buying is:
 *   1. BLOCK heavy resources (image / media / font / analytics / ads / beacons).
 *      Checkout works on document + script + xhr/fetch + css; images are pure waste.
 *   2. METER every response so we log real MB per session (no more guessing).
 *   3. HARD CAP: once a session exceeds STOCKX_PROXY_MAX_MB, abort further requests so
 *      a runaway CF loop can never silently burn gigabytes again.
 *
 * Applied to EVERY StockX Playwright context (direct too — blocking just makes it faster).
 *
 * Env:
 *   STOCKX_BLOCK_HEAVY   = "1" (default) | "0"   — block image/media/font + trackers
 *   STOCKX_PROXY_MAX_MB  = "500" (default)        — hard per-session ceiling (MB)
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Route } from "playwright";

const DATA_DIR = path.join(process.cwd(), ".data");
const USAGE_LOG = path.join(DATA_DIR, "stockx-proxy-usage.jsonl");

/** Resource types that are pure bytes-waste for an automated checkout. */
const HEAVY_RESOURCE_TYPES = new Set(["image", "media", "font"]);

/** Third-party hosts that never help a buy but pull JS/pixels. */
const BLOCKED_HOST_RE =
  /(google-analytics|googletagmanager|doubleclick|googlesyndication|facebook\.(com|net)|connect\.facebook|hotjar|segment\.(io|com)|fullstory|optimizely|branch\.io|snapchat|tiktok|criteo|bing\.com|clarity\.ms|amplitude|mixpanel|sentry\.io|datadog|newrelic|nr-data|bat\.bing|pinterest|twitter|ads-twitter)/i;

export function stockxBlockHeavy(): boolean {
  return (process.env.STOCKX_BLOCK_HEAVY ?? "1") !== "0";
}

export function stockxProxyMaxMb(): number {
  const n = Number(process.env.STOCKX_PROXY_MAX_MB ?? "500");
  return Number.isFinite(n) && n > 0 ? n : 500;
}

export type BandwidthTracker = {
  /** Bytes counted from response bodies / content-length. */
  bytes: () => number;
  mb: () => number;
  blockedRequests: () => number;
  capHit: () => boolean;
  /** Write one JSONL usage row + console summary. Call once per session (on close). */
  flush: (meta: { proxyLabel?: string | null; context?: string }) => Promise<void>;
};

/**
 * Attach request-block + byte-meter + hard-cap to a persistent context.
 * Safe to call once right after launchPersistentContext.
 */
export function attachStockxBandwidthGuard(
  ctx: BrowserContext,
  opts?: { proxyLabel?: string | null; context?: string }
): BandwidthTracker {
  const block = stockxBlockHeavy();
  const capBytes = stockxProxyMaxMb() * 1024 * 1024;

  let bytes = 0;
  let blockedRequests = 0;
  let capHit = false;
  let flushed = false;

  // --- metering: sum response transfer sizes ---
  ctx.on("response", (res) => {
    try {
      const len = Number(res.headers()["content-length"] || 0);
      if (Number.isFinite(len) && len > 0) {
        bytes += len;
        if (!capHit && bytes > capBytes) {
          capHit = true;
          console.error(
            `[STOCKX-BW] HARD CAP hit: ${(bytes / 1048576).toFixed(1)}MB > ${stockxProxyMaxMb()}MB — aborting further requests`
          );
        }
      }
    } catch {
      /* ignore */
    }
  });

  // --- blocking + cap enforcement ---
  void ctx.route("**/*", (route: Route) => {
    const req = route.request();
    const type = req.resourceType();
    const url = req.url();

    // Once over the ceiling, abort everything new (defuse runaway CF loops).
    if (capHit) {
      blockedRequests += 1;
      return route.abort().catch(() => undefined);
    }

    if (block) {
      if (HEAVY_RESOURCE_TYPES.has(type)) {
        blockedRequests += 1;
        return route.abort().catch(() => undefined);
      }
      // data: URIs are local (free) — let them through.
      if (!url.startsWith("data:") && BLOCKED_HOST_RE.test(url)) {
        blockedRequests += 1;
        return route.abort().catch(() => undefined);
      }
    }

    return route.continue().catch(() => undefined);
  });

  const tracker: BandwidthTracker = {
    bytes: () => bytes,
    mb: () => bytes / 1048576,
    blockedRequests: () => blockedRequests,
    capHit: () => capHit,
    flush: async (meta) => {
      if (flushed) return;
      flushed = true;
      const row = {
        ts: new Date().toISOString(),
        context: meta.context ?? opts?.context ?? "stockx-checkout",
        proxyLabel: meta.proxyLabel ?? opts?.proxyLabel ?? null,
        mb: Number((bytes / 1048576).toFixed(2)),
        blockedRequests,
        capHit,
        blockHeavy: block,
        maxMb: stockxProxyMaxMb(),
      };
      console.log(
        `[STOCKX-BW] session mb=${row.mb} blockedReq=${blockedRequests} capHit=${capHit} proxy=${row.proxyLabel ?? "direct"}`
      );
      try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        await fs.appendFile(USAGE_LOG, `${JSON.stringify(row)}\n`, "utf8");
      } catch {
        /* non-fatal */
      }
    },
  };

  // Best-effort auto-flush if caller forgets.
  ctx.on("close", () => {
    void tracker.flush({});
  });

  return tracker;
}
