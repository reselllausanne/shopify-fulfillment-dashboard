/**
 * Remint StockX JWT via residential proxy + Auth0 cookies (CF cookies stripped).
 *
 * VPS datacenter IP often stuck on Turnstile; LemonProxy residential IP can clear CF
 * while Auth0 SSO cookies still mint a bearer — no human click when session is valid.
 *
 * Bandwidth rules (mandatory):
 * - Prefer direct/warm remint first (caller: STOCKX_BROWSER_PROXY_MODE=on_fail).
 * - One sticky sit ≤45s on CF then fail — do NOT rotate through the whole pool loading
 *   challenges.cloudflare.com JS (GB killer).
 * - CF sticky-rotate budget ≤2/hour process-wide (see stockxProxyCfBudget).
 *
 * Does NOT write proxy cookies back into the VPS profile/session (keeps direct path clean).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import {
  nextStockxPlaywrightProxy,
  stockxPlaywrightProxyAvailable,
  type PlaywrightProxyConfig,
} from "@/lib/stockxPlaywrightProxy";
import { tryConsumeStockxCfRotateBudget } from "@/lib/stockxProxyCfBudget";
import { writeStockxTokenFile } from "@/lib/stockxSilentAuth0";
import { stockxTokenExpiresAt } from "@/lib/stockxServerToken";
import type { StockxWarmAccount } from "@/lib/stockxWarmBrowser";

const DATA_DIR = path.join(process.cwd(), ".data");
/** Sit on CF then abort this sticky — never burn full maxWaitMs loading challenge JS. */
const CF_ABORT_MS = 45_000;

export type StockxProxyRemintAccount = StockxWarmAccount;

function sessionFileFor(account: StockxProxyRemintAccount): string {
  return path.join(
    DATA_DIR,
    account === "galaxus" ? "stockx-session-galaxus.json" : "stockx-session.json"
  );
}

function tokenFileFor(account: StockxProxyRemintAccount): string {
  return path.join(
    DATA_DIR,
    account === "galaxus" ? "stockx-token-galaxus.json" : "stockx-token.json"
  );
}

function decodeJwt(tok: string): { exp?: number } | null {
  try {
    const p = tok.split(".")[1] || "";
    return JSON.parse(
      Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    ) as { exp?: number };
  } catch {
    return null;
  }
}

function isFreshJwt(tok: string): boolean {
  const p = decodeJwt(tok);
  return Boolean(p?.exp && p.exp * 1000 > Date.now() + 60_000);
}

function looksCloudflare(url: string, title: string, body: string): boolean {
  return (
    /cdn-cgi|__cf_chl|challenges\.cloudflare/i.test(url) ||
    /just a moment|un instant|vérification de sécurité|security check|cf-turnstile/i.test(
      `${title}\n${body}`
    )
  );
}

async function loadAuth0Seed(sessionFile: string): Promise<{
  cookies: Array<Record<string, unknown>>;
  origins: unknown[];
  auth0Count: number;
} | null> {
  try {
    const raw = JSON.parse(await fs.readFile(sessionFile, "utf8")) as {
      cookies?: Array<Record<string, unknown>>;
      origins?: unknown[];
    };
    const keep = (raw.cookies || []).filter((c) => {
      const name = String(c.name || "");
      if (/^cf_|^__cf/i.test(name)) return false;
      return true;
    });
    const auth0Count = keep.filter((c) => {
      const n = String(c.name || "");
      return n === "auth0" || n === "auth0_compat" || n === "did";
    }).length;
    if (!auth0Count) return null;
    return { cookies: keep, origins: raw.origins || [], auth0Count };
  } catch {
    return null;
  }
}

export type StockxProxyRemintResult = {
  ok: boolean;
  token: string | null;
  expiresAt: Date | null;
  proxyLabel: string | null;
  error: string | null;
  stuckOnTurnstile: boolean;
};

async function remintOnceViaProxy(opts: {
  account: StockxProxyRemintAccount;
  proxy: PlaywrightProxyConfig;
  seed: { cookies: Array<Record<string, unknown>>; origins: unknown[]; auth0Count: number };
  maxWaitMs: number;
  tokenFile: string;
}): Promise<StockxProxyRemintResult> {
  const { account, proxy, seed, maxWaitMs, tokenFile } = opts;
  if (!process.env.DISPLAY) process.env.DISPLAY = ":99";

  const seededPath = path.join(DATA_DIR, `_proxy-seed-${account}.json`);
  await fs.writeFile(
    seededPath,
    JSON.stringify({ cookies: seed.cookies, origins: seed.origins })
  );

  console.log(
    `[STOCKX-PROXY-REMINT] account=${account} proxy=${proxy.label} auth0Cookies=${seed.auth0Count}`
  );

  const browser = await chromium.launch({
    headless: false,
    proxy: {
      server: proxy.server,
      username: proxy.username,
      password: proxy.password,
    },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
    env: {
      ...process.env,
      DISPLAY: process.env.DISPLAY || ":99",
    },
  });

  let captured: string | null = null;
  let stuckOnTurnstile = false;
  let stockxHardBlock = false;

  try {
    const ctx = await browser.newContext({
      storageState: seededPath,
      locale: "fr-FR",
      timezoneId: "Europe/Zurich",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 900 },
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    ctx.on("request", (req) => {
      const auth = req.headers()["authorization"];
      if (!auth) return;
      const tok = auth.replace(/^Bearer\s+/i, "").trim();
      if (tok.startsWith("eyJ") && isFreshJwt(tok)) captured = tok;
    });

    const page = await ctx.newPage();
    await page
      .goto("https://stockx.com/buying/orders", {
        waitUntil: "domcontentloaded",
        timeout: 120_000,
      })
      .catch((e: any) =>
        console.warn(`[STOCKX-PROXY-REMINT] goto: ${e?.message || e}`)
      );

    const startedAt = Date.now();
    const sitUntil = startedAt + maxWaitMs;
    let lastLog = 0;
    while (!captured && Date.now() < sitUntil) {
      const url = page.url();
      const title = await page.title().catch(() => "");
      const body = ((await page.locator("body").innerText().catch(() => "")) || "").slice(
        0,
        200
      );
      const cf = looksCloudflare(url, title, body);
      if (cf) stuckOnTurnstile = true;
      // LemonProxy often gets bare StockX "Error" title (HTTP 403) — may rotate if budget.
      if (/^error$/i.test(title.trim()) || /\baccess denied\b/i.test(body)) {
        stockxHardBlock = true;
        console.warn(`[STOCKX-PROXY-REMINT] hard block title=${title} — abort sticky`);
        break;
      }
      // CF: sit still ≤45s on THIS sticky then abort — never reload/rotate thrash.
      if (cf && Date.now() - startedAt > CF_ABORT_MS) {
        console.warn(
          `[STOCKX-PROXY-REMINT] Turnstile stuck >${CF_ABORT_MS / 1000}s on ${proxy.label} — abort sticky (no CF JS thrash)`
        );
        break;
      }
      if (Date.now() - lastLog > 15_000) {
        lastLog = Date.now();
        console.log(
          `[STOCKX-PROXY-REMINT] cf=${cf} title=${title.slice(0, 60)} url=${url.slice(0, 90)}`
        );
      }
      if (!cf) {
        for (const c of await ctx.cookies()) {
          if (c.name === "token" && c.value.startsWith("eyJ") && isFreshJwt(c.value)) {
            captured = c.value;
            break;
          }
        }
        if (captured) break;
        if (!/buying/i.test(url)) {
          await page
            .goto("https://stockx.com/buying/orders", { waitUntil: "domcontentloaded" })
            .catch(() => undefined);
        }
        await page.waitForTimeout(5000);
        continue;
      }
      await page.waitForTimeout(2000);
    }

    if (!captured) {
      await page
        .screenshot({
          path: path.join(DATA_DIR, `proxy-remint-fail-${account}.png`),
          fullPage: true,
        })
        .catch(() => undefined);
      return {
        ok: false,
        token: null,
        expiresAt: null,
        proxyLabel: proxy.label,
        error: stockxHardBlock
          ? "StockX 403/Error via this proxy IP (pool may be blocked)"
          : stuckOnTurnstile
            ? "Still on Cloudflare/Turnstile via proxy (Auth0 session may be dead)"
            : "No JWT captured via proxy remint",
        stuckOnTurnstile,
      };
    }

    await writeStockxTokenFile(tokenFile, captured, { source: "proxy-remint" });
    const expiresAt = stockxTokenExpiresAt(captured);
    console.log(
      `[STOCKX-PROXY-REMINT] SUCCESS account=${account} proxy=${proxy.label} exp=${expiresAt?.toISOString() ?? "?"}`
    );
    return {
      ok: true,
      token: captured,
      expiresAt,
      proxyLabel: proxy.label,
      error: null,
      stuckOnTurnstile: false,
    };
  } finally {
    await browser.close().catch(() => undefined);
    await fs.rm(seededPath, { force: true }).catch(() => undefined);
  }
}

/**
 * Headed Chromium through residential proxy.
 * Default: ONE sticky. Extra sticky only if CF/403 and hourly CF-rotate budget allows (≤2/h).
 */
export async function remintStockxTokenViaProxy(options: {
  account: StockxProxyRemintAccount;
  maxWaitMs?: number;
  proxy?: PlaywrightProxyConfig | null;
  /**
   * Extra pool rotations after first sticky fails (default 0 → one sticky only).
   * Hard cap 1; still gated by CF rotate budget ≤2/hour.
   */
  maxProxyAttempts?: number;
}): Promise<StockxProxyRemintResult> {
  const account = options.account;
  const maxWaitMs = Math.min(Math.max(options.maxWaitMs ?? 90_000, 30_000), 180_000);
  // Default 0 extra → 1 sticky. Cap at 1 extra (2 stickies max per call).
  const maxAttempts = Math.min(Math.max(options.maxProxyAttempts ?? 0, 0), 1) + 1;

  if (!stockxPlaywrightProxyAvailable() && !options.proxy) {
    return {
      ok: false,
      token: null,
      expiresAt: null,
      proxyLabel: null,
      error: "No STOCKX_PROXY_FILE / STOCKX_PROXY_* / SCRAPER_PROXY pool configured",
      stuckOnTurnstile: false,
    };
  }

  const sessionFile = sessionFileFor(account);
  const tokenFile = tokenFileFor(account);
  const seed = await loadAuth0Seed(sessionFile);
  if (!seed) {
    return {
      ok: false,
      token: null,
      expiresAt: null,
      proxyLabel: null,
      error: `No Auth0 cookies in ${path.basename(sessionFile)} — need one human login first`,
      stuckOnTurnstile: false,
    };
  }

  let last: StockxProxyRemintResult = {
    ok: false,
    token: null,
    expiresAt: null,
    proxyLabel: null,
    error: "Proxy pool empty",
    stuckOnTurnstile: false,
  };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const proxy =
      attempt === 0 && options.proxy
        ? options.proxy
        : nextStockxPlaywrightProxy();
    if (!proxy) break;
    // Cap sit: CF abort is 45s; don't burn minutes on a dead sticky.
    const perAttemptMs = Math.min(maxWaitMs, CF_ABORT_MS + 15_000);
    last = await remintOnceViaProxy({
      account,
      proxy,
      seed,
      maxWaitMs: perAttemptMs,
      tokenFile,
    });
    if (last.ok) return last;

    const wantRotate =
      Boolean(last.stuckOnTurnstile) ||
      Boolean(last.error?.includes("403/Error")) ||
      Boolean(last.error?.includes("pool may be blocked"));
    if (!wantRotate || attempt + 1 >= maxAttempts) break;

    // CF sticky rotate burns challenge JS — hard budget ≤2/hour.
    const ok = await tryConsumeStockxCfRotateBudget(
      last.stuckOnTurnstile ? "remint_cf" : "remint_403"
    );
    if (!ok) {
      last = {
        ...last,
        error: `${last.error || "proxy remint failed"} — CF sticky-rotate budget exhausted (≤2/h)`,
      };
      break;
    }
    console.warn(
      `[STOCKX-PROXY-REMINT] attempt=${attempt + 1}/${maxAttempts} fail=${last.error} — next sticky (budget ok)`
    );
  }
  return last;
}
