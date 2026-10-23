/**
 * Remint StockX JWT via residential proxy + Auth0 cookies (CF cookies stripped).
 *
 * VPS datacenter IP often stuck on Turnstile; LemonProxy residential IP can clear CF
 * while Auth0 SSO cookies still mint a bearer — no human click when session is valid.
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
import { writeStockxTokenFile } from "@/lib/stockxSilentAuth0";
import { stockxTokenExpiresAt } from "@/lib/stockxServerToken";
import type { StockxWarmAccount } from "@/lib/stockxWarmBrowser";

const DATA_DIR = path.join(process.cwd(), ".data");

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

    const sitUntil = Date.now() + maxWaitMs;
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
      // LemonProxy often gets bare StockX "Error" title (HTTP 403) — rotate early.
      if (/^error$/i.test(title.trim()) || /\baccess denied\b/i.test(body)) {
        stockxHardBlock = true;
        console.warn(`[STOCKX-PROXY-REMINT] hard block title=${title} — rotate proxy`);
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
 * Headed Chromium through residential proxy; retries a few pool IPs on hard 403.
 */
export async function remintStockxTokenViaProxy(options: {
  account: StockxProxyRemintAccount;
  maxWaitMs?: number;
  proxy?: PlaywrightProxyConfig | null;
  /** Extra pool rotations after hard 403 (default 2 → up to 3 attempts). */
  maxProxyAttempts?: number;
}): Promise<StockxProxyRemintResult> {
  const account = options.account;
  const maxWaitMs = Math.min(Math.max(options.maxWaitMs ?? 240_000, 30_000), 420_000);
  const maxAttempts = Math.min(Math.max(options.maxProxyAttempts ?? 2, 0), 4) + 1;

  if (!stockxPlaywrightProxyAvailable() && !options.proxy) {
    return {
      ok: false,
      token: null,
      expiresAt: null,
      proxyLabel: null,
      error: "No STOCKX_PROXY_* / SCRAPER_PROXY pool configured",
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
    // Shorter sit per attempt when rotating — don't burn 4min × 3 on hard 403.
    const perAttemptMs = Math.min(maxWaitMs, attempt === 0 ? maxWaitMs : 90_000);
    last = await remintOnceViaProxy({
      account,
      proxy,
      seed,
      maxWaitMs: perAttemptMs,
      tokenFile,
    });
    if (last.ok) return last;
    if (!last.error?.includes("403/Error")) break;
  }
  return last;
}
