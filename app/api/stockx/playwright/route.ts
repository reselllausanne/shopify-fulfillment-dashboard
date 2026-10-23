import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, firefox, type Browser, type BrowserContext } from "playwright";
import {
  DEFAULT_STOCKX_PERSISTED_HASHES_FILE,
  readStockxPersistedHashes,
  writeStockxPersistedHashes,
} from "@/app/lib/stockxPersistedHashes";
import {
  clearStockxForceLoginTransactions,
  cookieJarHasAuth0Session,
  cookieJarHasLoggedInMarker,
  cookieJarHasTokenCookie,
  softNavigateForSilentRemint,
  stockxCredentialsFromEnv,
  tryStockxCredentialLogin,
  waitForCookieSessionWarm,
  type StockxCookieWarm,
} from "@/lib/stockxAutoLogin";
import {
  trySilentAuth0CodeRemint,
  writeStockxTokenFile,
} from "@/lib/stockxSilentAuth0";
import {
  connectWarmBrowser,
  markWarmKeepAlive,
  markWarmToken,
  stockxCdpPort,
  writeWarmState,
  type StockxWarmAccount,
} from "@/lib/stockxWarmBrowser";
import {
  nextStockxPlaywrightProxy,
  stockxBrowserProxyMode,
} from "@/lib/stockxPlaywrightProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SESSION_FILE = path.join(process.cwd(), ".data", "stockx-session.json");
const DEFAULT_SESSION_META_FILE = path.join(process.cwd(), ".data", "stockx-session-meta.json");
const DEFAULT_TOKEN_FILE = path.join(process.cwd(), ".data", "stockx-token.json");

const ensureSessionDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
};

const resolveOptionalFile = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const cleaned = value.trim();
  return path.isAbsolute(cleaned) ? cleaned : path.join(process.cwd(), cleaned);
};

const extractTokenValue = (raw: string | null): string | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, any>;
    const candidate =
      parsed?.value ||
      parsed?.token ||
      parsed?.accessToken ||
      parsed?.access_token ||
      parsed?.authToken ||
      parsed?.bearer;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  } catch {
    // not JSON
  }
  return trimmed;
};

const base64UrlDecode = (input: string): string => {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
};

const isStockxJwt = (value: string | null): boolean => {
  if (!value) return false;
  const trimmed = value.trim().replace(/^bearer\s+/i, "");
  if (!trimmed.startsWith("eyJ")) return false;
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) return false;
  try {
    const payloadRaw = base64UrlDecode(trimmed.split(".")[1] || "");
    const payload = JSON.parse(payloadRaw) as Record<string, any>;
    const iss = typeof payload.iss === "string" ? payload.iss : "";
    const aud = payload.aud;
    const audList = Array.isArray(aud) ? aud : [aud];
    const audMatch = audList.some(
      (entry) => typeof entry === "string" && entry.toLowerCase().includes("stockx")
    );
    return iss.toLowerCase().includes("stockx") || audMatch;
  } catch {
    return false;
  }
};

const extractJwtFromText = (value: string | null): string | null => {
  if (!value) return null;
  const match = value.match(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  if (!match) return null;
  return isStockxJwt(match[0]) ? match[0] : null;
};

const normalizeBearer = (value: string | null): string | null => {
  const extracted = extractTokenValue(value);
  if (!extracted) return null;
  const token = extracted.replace(/^bearer\s+/i, "").trim();
  if (!isStockxJwt(token)) return null;
  return `Bearer ${token}`;
};

const stripBearer = (value: string | null): string | null => {
  const extracted = extractTokenValue(value);
  if (!extracted) return null;
  const token = extracted.replace(/^bearer\s+/i, "").trim();
  return isStockxJwt(token) ? token : null;
};

const extractTokenFromStorage = (store: Record<string, string | null>): string | null => {
  const candidates = Object.entries(store);
  for (const [, raw] of candidates) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as Record<string, any>;
      const token =
        parsed.value ||
        parsed.token ||
        parsed.accessToken ||
        parsed.access_token ||
        parsed.bearer ||
        parsed.authToken;
      const normalized = normalizeBearer(token);
      if (normalized) return normalized;
    } catch {
      // ignore JSON parse errors
    }
    const normalized = normalizeBearer(raw);
    if (normalized) return normalized;
  }
  return null;
};

const isTokenExpired = (token: string, skewSeconds = 60): boolean => {
  try {
    const payloadRaw = base64UrlDecode(token.split(".")[1] || "");
    const payload = JSON.parse(payloadRaw) as Record<string, any>;
    const exp = typeof payload?.exp === "number" ? payload.exp : null;
    if (!exp) return true;
    const now = Math.floor(Date.now() / 1000);
    return exp <= now + skewSeconds;
  } catch {
    return true;
  }
};

const extractTokenFromCookies = (cookies: Array<{ name: string; value: string }>): string | null => {
  for (const cookie of cookies) {
    const token = extractJwtFromText(cookie.value);
    if (token && !isTokenExpired(token)) return `Bearer ${token}`;
  }
  return null;
};

const acceptFreshBearer = (value: string | null): string | null => {
  const normalized = normalizeBearer(value);
  if (!normalized) return null;
  const raw = stripBearer(normalized);
  if (!raw || isTokenExpired(raw)) return null;
  return normalized;
};

const isPersistentProfileLockError = (error: unknown): boolean => {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("processsingleton") ||
    message.includes("singletonlock") ||
    message.includes("profile is already in use") ||
    message.includes("failed to create a processsingleton")
  );
};

const createEphemeralContext = async ({
  browser,
  sessionFile,
  userAgent,
  forceLogin,
}: {
  browser: Browser;
  sessionFile: string;
  userAgent: string;
  forceLogin: boolean;
}): Promise<BrowserContext> => {
  if (forceLogin) {
    try {
      await fs.unlink(sessionFile);
      console.log("[STOCKX-PW] Deleted existing session (force login)");
    } catch {
      // ignore missing file
    }
    const context = await browser.newContext({ userAgent });
    console.log("[STOCKX-PW] Force login: fresh context");
    return context;
  }

  try {
    await fs.access(sessionFile);
    const context = await browser.newContext({ storageState: sessionFile, userAgent });
    console.log("[STOCKX-PW] Loaded existing session");
    return context;
  } catch {
    const context = await browser.newContext({ userAgent });
    console.log("[STOCKX-PW] No session found, fresh context");
    return context;
  }
};

export async function POST(req: NextRequest) {
  let cleanupBrowser: Browser | null = null;
  let cleanupContext: BrowserContext | null = null;
  let skipWarmClose = false;
  try {
    const body = await req.json().catch(() => ({}));
    const forceHeadless = ["1", "true", "yes"].includes(
      String(process.env.PLAYWRIGHT_HEADLESS ?? "").toLowerCase()
    );
    const remoteDesktopEnabled = ["1", "true", "yes"].includes(
      String(process.env.PLAYWRIGHT_ENABLE_REMOTE_DESKTOP ?? "").toLowerCase()
    );
    const requestedHeadless =
      body?.headless === undefined || body?.headless === null ? null : Boolean(body.headless);
    const defaultHeadless = process.env.NODE_ENV === "production" && !remoteDesktopEnabled;
    const headless = forceHeadless ? true : (requestedHeadless ?? defaultHeadless);
    const browserType = String(body?.browser || "firefox").toLowerCase();
    const sessionFile = String(body?.sessionFile || DEFAULT_SESSION_FILE);
    const sessionMetaFile = String(body?.sessionMetaFile || DEFAULT_SESSION_META_FILE);
    const tokenFile = resolveOptionalFile(body?.tokenFile) ?? DEFAULT_TOKEN_FILE;
    const persistedHashesFile =
      resolveOptionalFile(body?.persistedHashesFile) ?? DEFAULT_STOCKX_PERSISTED_HASHES_FILE;
    const maxWaitMs = Math.min(Number(body?.maxWaitMs || 600000), 900000);
    let forceLogin = Boolean(body?.forceLogin ?? false);
    const waitForUserClose = Boolean(body?.waitForUserClose ?? false);
    const waitForCloseMs = Math.min(Number(body?.waitForCloseMs || 120000), 600000);
    const autoNavigateRequested = Boolean(body?.autoNavigate ?? false);
    const startUrl = String(body?.startUrl || "https://stockx.com/login");
    const reuseTokenFile = Boolean(body?.reuseTokenFile ?? true);
    const persistent = Boolean(body?.persistent ?? false);
    // Scheduled refreshes must never throw away the logged-in profile: rebuilding it needs a human.
    const allowProfileReset = Boolean(body?.allowProfileReset ?? true);
    // Unattended cron can fill STOCKX_EMAIL/PASSWORD from env when the session is cold.
    const autoLogin = Boolean(body?.autoLogin ?? false);
    // Headed cron refreshes also need kick navigations (was headless-only before).
    const autoNavigate = autoNavigateRequested && (headless || autoLogin);
    const userDataDir = String(
      body?.userDataDir || path.join(process.cwd(), ".data", "stockx-profile")
    );
    const userAgent = String(
      body?.userAgent ||
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    );
    const credentialsAccount: StockxWarmAccount =
      body?.credentialsAccount === "galaxus" ? "galaxus" : "default";
    const useWarmCdp = Boolean(body?.useWarmCdp ?? false);
    const leaveWarm = Boolean(body?.leaveWarm ?? false);
    const silentAuth0 = Boolean(body?.silentAuth0 ?? autoLogin);
    const cdpPort = stockxCdpPort(credentialsAccount);

    await ensureSessionDir(sessionFile);
    await ensureSessionDir(sessionMetaFile);
    if (tokenFile) await ensureSessionDir(tokenFile);
    await ensureSessionDir(persistedHashesFile);

    if (tokenFile && !forceLogin && allowProfileReset) {
      try {
        await fs.access(tokenFile);
      } catch {
        // No token yet => force a fresh login once
        forceLogin = true;
      }
    }

    if (!forceLogin && reuseTokenFile && tokenFile) {
      try {
        const rawToken = await fs.readFile(tokenFile, "utf8");
        const parsed = JSON.parse(rawToken) as { token?: string };
        const raw = extractTokenValue(parsed?.token || rawToken);
        const token = stripBearer(raw);
        if (token && isStockxJwt(token) && !isTokenExpired(token)) {
          return NextResponse.json({
            ok: true,
            token: token,
            sessionFile,
            tokenFile,
            reused: true,
          });
        }
      } catch {
        // ignore token reuse failures
      }
    }

    const baseArgs =
      browserType === "chromium"
        ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"]
        : ["--no-sandbox", "--disable-setuid-sandbox"];
    // Cron/exec shells often lack DISPLAY even though entrypoint started Xvfb on :99.
    if (!process.env.DISPLAY) {
      process.env.DISPLAY = ":99";
    }
    // Optional residential proxy on cold launch (not warm CDP attach — that browser already has its own net).
    // Prefer STOCKX_PROXY_* / SCRAPER pool when STOCKX_BROWSER_PROXY_MODE=always or body.useProxy.
    const wantProxy =
      Boolean(body?.useProxy) || stockxBrowserProxyMode() === "always";
    const playwrightProxy = wantProxy ? nextStockxPlaywrightProxy() : null;
    if (playwrightProxy) {
      console.log(`[STOCKX-PW] launch proxy=${playwrightProxy.label}`);
    }

    const launchOptions = {
      headless,
      slowMo: headless ? 0 : 50,
      args: baseArgs,
      ...(playwrightProxy
        ? {
            proxy: {
              server: playwrightProxy.server,
              username: playwrightProxy.username,
              password: playwrightProxy.password,
            },
          }
        : {}),
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ":99",
        MOZ_DISABLE_CONTENT_SANDBOX: "1",
      },
    };

    let browser: Browser | null = null;
    let context!: BrowserContext;
    let usedPersistentContext = false;
    let persistentFallback = false;
    let attachedWarmCdp = false;
    let leftWarm = false;

    // Vacation path: attach to long-lived Chromium instead of cold launch (Turnstile).
    if (useWarmCdp && persistent && browserType === "chromium" && !forceLogin) {
      const warm = await connectWarmBrowser(credentialsAccount);
      if (warm) {
        browser = warm.browser;
        context = warm.context;
        usedPersistentContext = true;
        attachedWarmCdp = true;
        leftWarm = true; // never close a shared warm browser from a remint request
        skipWarmClose = true;
        await markWarmKeepAlive(credentialsAccount).catch(() => undefined);
        console.log(`[STOCKX-PW] Using warm CDP context account=${credentialsAccount}`);
      }
    }

    if (!attachedWarmCdp && persistent) {
      if (forceLogin) {
        try {
          await fs.rm(userDataDir, { recursive: true, force: true });
          console.log("[STOCKX-PW] Deleted persistent profile (force login)");
        } catch {
          // ignore removal errors
        }
      }
      await fs.mkdir(userDataDir, { recursive: true });
      // Interactive login / operator reclaim: drop zombie Chromiums on this profile first.
      // Never wipe cookies here — only process kill + Singleton* files.
      if (Boolean(body?.killExistingProfileBrowser)) {
        const { killChromeForUserDataDir } = await import("@/lib/stockxBrowserProcess");
        const killed = await killChromeForUserDataDir(userDataDir);
        if (killed > 0) {
          console.log(`[STOCKX-PW] Killed ${killed} Chromium pid(s) on ${userDataDir}`);
        }
      }
      // Stale Chromium Singleton* files from a crashed cron leave the profile unusable.
      for (const lockName of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
        try {
          await fs.rm(path.join(userDataDir, lockName), { force: true });
          await fs.rm(path.join(userDataDir, "Default", lockName), { force: true });
        } catch {
          // ignore
        }
      }
      const warmLaunchOptions = {
        ...launchOptions,
        args: [
          ...(launchOptions.args || []),
          ...(leaveWarm && browserType === "chromium"
            ? [`--remote-debugging-port=${cdpPort}`, "--remote-debugging-address=127.0.0.1"]
            : []),
        ],
      };
      try {
        if (browserType === "chromium") {
          context = await chromium.launchPersistentContext(userDataDir, {
            ...warmLaunchOptions,
            locale: "fr-FR",
            timezoneId: "Europe/Zurich",
            userAgent,
          });
        } else {
          context = await firefox.launchPersistentContext(userDataDir, {
            ...launchOptions,
            locale: "fr-FR",
            timezoneId: "Europe/Zurich",
            userAgent,
          });
        }
        browser = context.browser();
        usedPersistentContext = true;
        console.log("[STOCKX-PW] Using persistent context");
        if (leaveWarm && browserType === "chromium") {
          await writeWarmState({
            account: credentialsAccount,
            cdpUrl: `http://127.0.0.1:${cdpPort}`,
            port: cdpPort,
            profileDir: userDataDir,
            pid: process.pid,
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }).catch(() => undefined);
          leftWarm = true;
          skipWarmClose = true;
          console.log(`[STOCKX-PW] leaveWarm CDP :${cdpPort}`);
        }
      } catch (error: any) {
        if (!isPersistentProfileLockError(error)) {
          throw error;
        }
        // One retry after killing whoever holds the profile (avoids "Profile error" zombies).
        try {
          const { killChromeForUserDataDir } = await import("@/lib/stockxBrowserProcess");
          const killed = await killChromeForUserDataDir(userDataDir);
          console.warn(
            `[STOCKX-PW] Persistent profile busy; killed ${killed} pid(s), retrying launch`
          );
          if (browserType === "chromium") {
            context = await chromium.launchPersistentContext(userDataDir, {
              ...warmLaunchOptions,
              locale: "fr-FR",
              timezoneId: "Europe/Zurich",
              userAgent,
            });
          } else {
            context = await firefox.launchPersistentContext(userDataDir, {
              ...launchOptions,
              locale: "fr-FR",
              timezoneId: "Europe/Zurich",
              userAgent,
            });
          }
          browser = context.browser();
          usedPersistentContext = true;
          console.log("[STOCKX-PW] Using persistent context after lock reclaim");
          if (leaveWarm && browserType === "chromium") {
            await writeWarmState({
              account: credentialsAccount,
              cdpUrl: `http://127.0.0.1:${cdpPort}`,
              port: cdpPort,
              profileDir: userDataDir,
              pid: process.pid,
              startedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }).catch(() => undefined);
            leftWarm = true;
            skipWarmClose = true;
          }
        } catch (retryError: any) {
          // Never fall back to ephemeral when Auth0 cookies live in the session file —
          // that path burns credential /login without SSO and fails Turnstile.
          let sessionHasAuth0 = false;
          try {
            const raw = await fs.readFile(sessionFile, "utf8");
            const parsed = JSON.parse(raw) as { cookies?: Array<{ name?: string; domain?: string }> };
            sessionHasAuth0 = (parsed.cookies || []).some(
              (c) =>
                (c.name === "auth0" || c.name === "auth0_compat" || c.name === "did") &&
                String(c.domain || "").includes("stockx")
            );
          } catch {
            sessionHasAuth0 = false;
          }
          if (sessionHasAuth0 || autoLogin) {
            throw new Error(
              `StockX profile locked after reclaim; Auth0 session present — refusing ephemeral fallback. ${retryError?.message || retryError}`
            );
          }
          persistentFallback = true;
          console.warn(
            "[STOCKX-PW] Persistent profile still busy after reclaim; fallback to ephemeral context",
            retryError?.message || retryError
          );
          browser =
            browserType === "chromium"
              ? await chromium.launch(launchOptions)
              : await firefox.launch(launchOptions);
          context = await createEphemeralContext({
            browser,
            sessionFile,
            userAgent,
            forceLogin,
          });
        }
      }
    } else if (!attachedWarmCdp) {
      browser =
        browserType === "chromium"
          ? await chromium.launch(launchOptions)
          : await firefox.launch(launchOptions);
      context = await createEphemeralContext({
        browser,
        sessionFile,
        userAgent,
        forceLogin,
      });
    }

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    cleanupBrowser = browser;
    cleanupContext = context;

    let capturedToken: string | null = null;
    let capturedDeviceId: string | null = null;
    let capturedSessionId: string | null = null;
    const capturedPersistedHashes: Record<string, string> = {};
    const consoleLogs: string[] = [];
    const pageErrors: string[] = [];
    const requestFails: string[] = [];
    const authResponses: Array<{ url: string; status: number }> = [];
    const capturePersistedHash = (operationName: unknown, rawHash: unknown) => {
      const op = String(operationName ?? "").trim();
      const hash = String(rawHash ?? "").trim().toLowerCase();
      if (!op) return;
      if (!/^[a-f0-9]{64}$/.test(hash)) return;
      capturedPersistedHashes[op] = hash;
    };

    context.on("request", (req) => {
      const url = req.url();
      if (
        !url.includes("stockx.com") &&
        !url.includes("gateway.stockx.com") &&
        !url.includes("pro.stockx.com")
      ) {
        return;
      }
      const headers = req.headers();
      const auth = headers["authorization"] || headers["Authorization"];
      const deviceId = headers["x-stockx-device-id"] || headers["X-Stockx-Device-Id"];
      const sessionId = headers["x-stockx-session-id"] || headers["X-Stockx-Session-Id"];
      const fresh = acceptFreshBearer(auth || null);
      if (fresh) {
        capturedToken = fresh;
      }
      if (typeof deviceId === "string" && deviceId.trim()) {
        capturedDeviceId = deviceId.trim();
      }
      if (typeof sessionId === "string" && sessionId.trim()) {
        capturedSessionId = sessionId.trim();
      }
      if (url.includes("/api/graphql")) {
        const rawBody = req.postData();
        if (rawBody) {
          try {
            const parsed = JSON.parse(rawBody) as Record<string, any>;
            capturePersistedHash(
              parsed?.operationName,
              parsed?.extensions?.persistedQuery?.sha256Hash
            );
          } catch {
            // ignore non-JSON request payloads
          }
        }
      }
    });

    context.on("response", async (res) => {
      const url = res.url();
      if (
        !url.includes("stockx.com") &&
        !url.includes("gateway.stockx.com") &&
        !url.includes("pro.stockx.com")
      ) {
        return;
      }
      const headers = res.headers();
      if (/auth|login|session/i.test(url)) {
        authResponses.push({ url, status: res.status() });
      }
      const auth = headers["authorization"] || headers["Authorization"] || headers["x-auth-token"];
      const fresh = acceptFreshBearer(auth || null);
      if (fresh) {
        capturedToken = fresh;
      }
    });

    let page = await context.newPage();
    page.on("console", (msg) => {
      const text = msg.text();
      if (text) consoleLogs.push(text);
    });
    page.on("pageerror", (err) => {
      const text = err?.message || String(err);
      if (text) pageErrors.push(text);
    });
    page.on("requestfailed", (req) => {
      const url = req.url();
      const failure = req.failure();
      requestFails.push(`${url} :: ${failure?.errorText || "failed"}`);
    });
    // Cookie-first remint: soft StockX URLs with the persistent profile. Never open /login first —
    // that seeds Auth0 forceLogin + Turnstile even when auth0/did cookies are still valid for months.
    let cookieWarm: StockxCookieWarm | null = null;
    let hasAuth0Session = false;
    const probeCookiesForToken = async () => {
      if (capturedToken) return;
      try {
        const dump = await page.evaluate(() => {
          const out: Record<string, string | null> = {};
          for (const key of Object.keys(localStorage)) out[key] = localStorage.getItem(key);
          return out;
        });
        const fromStorage = acceptFreshBearer(extractTokenFromStorage(dump));
        if (fromStorage) capturedToken = fromStorage;
      } catch {
        // ignore
      }
      if (capturedToken) return;
      try {
        const cookies = (await context.cookies()) as Array<{ name: string; value: string }>;
        const fromCookies = extractTokenFromCookies(cookies);
        if (fromCookies) capturedToken = fromCookies;
      } catch {
        // ignore
      }
    };
    const logAuthCookieSummary = async (label: string) => {
      try {
        const cookies = (await context.cookies()) as Array<{
          name: string;
          value: string;
          domain: string;
          expires: number;
        }>;
        hasAuth0Session = cookieJarHasAuth0Session(cookies);
        const interesting = cookies.filter((c) =>
          /^(auth0|auth0_compat|did|did_compat|cf_clearance|loggedIn|token|stockx_session)$/i.test(
            c.name
          )
        );
        const summary = interesting.map((c) => {
          const exp =
            typeof c.expires === "number" && c.expires > 0
              ? new Date(c.expires * 1000).toISOString()
              : "session";
          return `${c.name}@${c.domain}(exp=${exp},len=${c.value?.length ?? 0})`;
        });
        console.log(
          `[STOCKX-PW] ${label} auth0=${hasAuth0Session} loggedIn=${cookieJarHasLoggedInMarker(cookies)} tokenCookie=${cookieJarHasTokenCookie(cookies)} :: ${summary.join(" | ") || "(none)"}`
        );
      } catch (err: any) {
        console.warn(`[STOCKX-PW] ${label} cookie summary failed`, err?.message || err);
      }
    };
    if (autoLogin) {
      try {
        await clearStockxForceLoginTransactions(context);
        await logAuthCookieSummary("pre-nav");
        await softNavigateForSilentRemint(page, {
          hasToken: () => Boolean(capturedToken),
          perUrlWaitMs: 6_000,
        });
        await probeCookiesForToken();
        cookieWarm = await waitForCookieSessionWarm(page, {
          // Headed Xvfb often needs a long Turnstile sit; Auth0 cookies stay valid meanwhile.
          timeoutMs: 150_000,
          hasToken: () => Boolean(capturedToken),
        });
        await probeCookiesForToken();
        await logAuthCookieSummary(`post-warm warm=${cookieWarm}`);
        if (capturedToken) {
          console.log("[STOCKX-PW] Cookie-first remint succeeded (persistent session)");
        } else {
          console.log(
            `[STOCKX-PW] Cookie-first remint missed (warm=${cookieWarm} auth0=${hasAuth0Session}); credentials only on login_wall without Auth0`
          );
        }
      } catch (err: any) {
        console.warn("[STOCKX-PW] Cookie-first remint navigation failed", err?.message || err);
      }
    }

    if (!capturedToken && cookieWarm !== "blocked") {
      // Soft only — never force /login here (burns Auth0 SSO behind Turnstile).
      const nextUrl =
        startUrl.includes("/login") || autoLogin
          ? "https://stockx.com/buying/orders"
          : startUrl;
      await page.goto(nextUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    }
    const currentUrl = page.url();
    const pageTitle = await page.title().catch(() => "");
    // Soft Cloudflare / Turnstile pages often auto-pass on headed Xvfb — wait instead of aborting.
    const cloudflareHardBlock =
      /access denied|attention required/i.test(pageTitle) &&
      /cdn-cgi|challenges\.cloudflare\.com/i.test(currentUrl);
    if (cloudflareHardBlock && !autoLogin) {
      if (allowProfileReset) {
        const cleanupTargets = [sessionFile];
        if (usedPersistentContext) {
          cleanupTargets.unshift(userDataDir);
        }
        if (tokenFile) cleanupTargets.push(tokenFile);
        for (const target of cleanupTargets) {
          try {
            await fs.rm(target, { recursive: true, force: true });
          } catch {
            // ignore cleanup failures
          }
        }
      }
      if (usedPersistentContext) {
        await context.close();
        cleanupContext = null;
        cleanupBrowser = null;
      } else {
        await browser?.close();
        cleanupContext = null;
        cleanupBrowser = null;
      }
      return NextResponse.json(
        {
          ok: false,
          error: allowProfileReset
            ? "Cloudflare challenge detected. Profile reset; please retry login."
            : "Cloudflare challenge detected. Profile kept; retry or log in again.",
          reset: allowProfileReset,
          url: currentUrl,
          title: pageTitle,
        },
        { status: 403 }
      );
    }
    try {
      await page.waitForURL(/stockx\.com\/(login|account|profile|browse|buying)/i, {
        timeout: 15000,
      });
    } catch {
      // ignore URL wait timeout
    }

    let autoLoginNeedsOtp = false;
    let autoLoginError: string | null = null;
    // Auth0/session cookies look logged-in but bearer not minted yet — soft URLs only.
    // Going to /login here kills a recoverable Auth0 session behind Turnstile + forceLogin.
    if (
      autoLogin &&
      !capturedToken &&
      (cookieWarm === "authenticated" || cookieWarm === "token" || hasAuth0Session)
    ) {
      console.log(
        `[STOCKX-PW] Silent remint (warm=${cookieWarm} auth0=${hasAuth0Session}) — soft URLs only, no /login`
      );
      await clearStockxForceLoginTransactions(context);
      const silentDeadline = Date.now() + 120_000;
      while (!capturedToken && Date.now() < silentDeadline) {
        try {
          if (page.isClosed()) {
            console.warn("[STOCKX-PW] Soft remint page closed — opening new tab on same profile");
            page = await context.newPage();
          }
          await softNavigateForSilentRemint(page, {
            hasToken: () => Boolean(capturedToken),
            perUrlWaitMs: 5_000,
          });
          await probeCookiesForToken();
        } catch (err: any) {
          const msg = String(err?.message || err);
          console.warn("[STOCKX-PW] Soft remint iteration error", msg);
          if (/has been closed|Target page|browser has been closed/i.test(msg)) {
            try {
              page = await context.newPage();
            } catch {
              break;
            }
          }
        }
        if (capturedToken) break;
      }
      await logAuthCookieSummary("post-silent");
      if (capturedToken) {
        console.log("[STOCKX-PW] Silent remint succeeded after soft Auth0 wait");
      } else if (hasAuth0Session && silentAuth0) {
        // Path: Auth0 prompt=none authorize (no /login) once CF is not blocking the page.
        const titleNow = await page.title().catch(() => "");
        const bodyNow = (await page.locator("body").innerText().catch(() => "")) || "";
        const stillCf =
          /just a moment|un instant|vérification de sécurité|cf-turnstile|__cf_chl/i.test(
            `${titleNow}\n${bodyNow}\n${page.url()}`
          );
        if (!stillCf) {
          console.log("[STOCKX-PW] Trying Auth0 silent authorize (prompt=none)");
          const silent = await trySilentAuth0CodeRemint(page, { timeoutMs: 45_000 });
          if (silent.token) {
            capturedToken = `Bearer ${silent.token}`;
            console.log("[STOCKX-PW] Auth0 silent authorize minted bearer");
            if (tokenFile && silent.refreshToken) {
              await writeStockxTokenFile(tokenFile, silent.token, {
                refreshToken: silent.refreshToken,
                source: "silent-auth0",
              }).catch(() => undefined);
            }
          } else {
            console.warn(`[STOCKX-PW] Auth0 silent authorize missed: ${silent.error}`);
          }
        }
        if (!capturedToken) {
          autoLoginError =
            "Auth0 cookies valid but JWT not reminted (Turnstile/cold). Auth0 SSO kept — no /login. Open /admin/stockx-login once OR wait for warm CDP keep-alive.";
          console.warn(`[STOCKX-PW] ${autoLoginError}`);
        }
      } else if (hasAuth0Session) {
        autoLoginError =
          "Auth0/session cookies still present but JWT was not reminted (Turnstile/cold browser). Do NOT burn /login — use /admin/stockx-login once.";
        console.warn(`[STOCKX-PW] ${autoLoginError}`);
      }
    }
    // Credentials ONLY when there is a real login wall and no Auth0 SSO cookie left.
    // Prior bug: always fell through to /login after warm=authenticated → Turnstile + forceLogin.
    const allowCredentialFallback =
      autoLogin &&
      !capturedToken &&
      !hasAuth0Session &&
      (cookieWarm === "login_wall" || cookieWarm === null);
    if (allowCredentialFallback) {
      const creds = stockxCredentialsFromEnv(
        body?.credentialsAccount === "galaxus" ? "galaxus" : "default"
      );
      if (creds) {
        if (!/accounts\.stockx\.com|stockx\.com\/login/i.test(page.url())) {
          await page.goto("https://stockx.com/login", {
            waitUntil: "domcontentloaded",
            timeout: 45000,
          }).catch(() => undefined);
        }
        console.log(
          `[STOCKX-PW] Attempting credential auto-login (cookieWarm=${cookieWarm ?? "n/a"} auth0=${hasAuth0Session})`
        );
        const result = await tryStockxCredentialLogin(page, creds);
        autoLoginNeedsOtp = result.needsOtp;
        autoLoginError = result.error;
        if (result.needsOtp) {
          console.warn("[STOCKX-PW] OTP / 2FA screen — Gmail auto-fill failed or not configured");
        }
        if (!result.needsOtp && !result.error) {
          try {
            await page.goto("https://stockx.com/buying/orders", {
              waitUntil: "domcontentloaded",
              timeout: 30000,
            });
          } catch {
            // ignore
          }
        }
      } else {
        autoLoginError =
          cookieWarm === "blocked"
            ? "Cloudflare challenge did not clear on buying/orders (Turnstile); STOCKX_EMAIL/PASSWORD not configured."
            : "STOCKX_EMAIL/STOCKX_PASSWORD not configured";
      }
    } else if (autoLogin && !capturedToken && !autoLoginError) {
      if (cookieWarm === "blocked") {
        autoLoginError =
          "Cloudflare/Turnstile blocked soft remint; Auth0 cookies kept (no /login burn). Retry or /admin/stockx-login.";
      } else if (hasAuth0Session) {
        autoLoginError =
          "Auth0 cookies valid but bearer missing after soft remint. Use /admin/stockx-login (credential /login skipped to protect SSO).";
      }
    }

    const start = Date.now();
    let lastKick = 0;
    // Auth0 present but silent remint already failed → don't burn another 3–9 minutes on /login-ish waits.
    const failFastAuth0 =
      autoLogin && !capturedToken && hasAuth0Session && Boolean(autoLoginError);
    while (!capturedToken && !failFastAuth0 && Date.now() - start < maxWaitMs) {
      try {
        await page.waitForTimeout(2000);
      } catch {
        break;
      }
      if (page.isClosed()) break;
      if (capturedToken) break;
      if (autoNavigate && !waitForUserClose) {
        const now = Date.now();
        if (now - lastKick > 15000) {
          lastKick = now;
          try {
            // Soft buying/orders only — never kick /login (Turnstile + forceLogin).
            const kickUrl = autoLogin
              ? "https://stockx.com/buying/orders"
              : startUrl.includes("/login")
                ? "https://stockx.com/buying/orders"
                : startUrl;
            await page.goto(kickUrl, { waitUntil: "domcontentloaded" });
          } catch {
            // ignore navigation errors
          }
        }
      }
      let localStorageDump: Record<string, string | null> = {};
      try {
        localStorageDump = await page.evaluate(() => {
          const out: Record<string, string | null> = {};
          for (const key of Object.keys(localStorage)) {
            out[key] = localStorage.getItem(key);
          }
          return out;
        });
      } catch {
        localStorageDump = {};
      }
      const token = acceptFreshBearer(extractTokenFromStorage(localStorageDump));
      if (token) {
        capturedToken = token;
        break;
      }
      let sessionDump: Record<string, string | null> = {};
      try {
        sessionDump = await page.evaluate(() => {
          const out: Record<string, string | null> = {};
          for (const key of Object.keys(sessionStorage)) {
            out[key] = sessionStorage.getItem(key);
          }
          return out;
        });
      } catch {
        sessionDump = {};
      }
      const sessionToken = acceptFreshBearer(extractTokenFromStorage(sessionDump));
      if (sessionToken) {
        capturedToken = sessionToken;
        break;
      }
      let cookies: Array<{ name: string; value: string }> = [];
      try {
        cookies = (await context.cookies()) as Array<{ name: string; value: string }>;
      } catch {
        cookies = [];
      }
      const cookieToken = extractTokenFromCookies(cookies);
      if (cookieToken) {
        capturedToken = cookieToken;
        break;
      }
    }

    if (waitForUserClose) {
      try {
        await Promise.race([
          page.waitForEvent("close"),
          page.waitForTimeout(waitForCloseMs),
        ]);
      } catch {
        // ignore wait errors
      }
    }

    if (!capturedToken) {
      const debugDir = path.join(process.cwd(), ".data");
      await fs.mkdir(debugDir, { recursive: true });
      const screenshotPath = path.join(debugDir, "stockx-login-failed.png");
      const htmlPath = path.join(debugDir, "stockx-login-failed.html");
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
      } catch {
        // ignore screenshot failures
      }
      try {
        const html = await page.content();
        await fs.writeFile(htmlPath, html, "utf-8");
      } catch {
        // ignore html capture failures
      }
      // Without this the browser keeps the process alive and a cron run never exits —
      // unless leaveWarm / CDP attach (vacation daemon must stay up).
      if (!leftWarm) {
        try {
          if (usedPersistentContext) {
            await context.close();
          } else {
            await browser?.close();
          }
        } catch {
          // ignore close failures
        }
        cleanupContext = null;
        cleanupBrowser = null;
      } else {
        cleanupContext = null;
        cleanupBrowser = null;
        console.log("[STOCKX-PW] leaveWarm — browser kept open after failed remint (CF sit)");
      }
      return NextResponse.json(
        {
          ok: false,
          error: autoLoginNeedsOtp
            ? "StockX asked for OTP/2FA. Complete login once on /admin/stockx-login."
            : autoLoginError
              ? `StockX token not found (${autoLoginError}).`
              : "StockX token not found. Login may be incomplete.",
          needsOtp: autoLoginNeedsOtp,
          leftWarm,
          attachedWarmCdp,
          debug: {
            lastUrl: page.url(),
            screenshotPath,
            htmlPath,
            consoleLogs: consoleLogs.slice(-50),
            pageErrors: pageErrors.slice(-20),
            requestFails: requestFails.slice(-20),
            authResponses: authResponses.slice(-10),
          },
        },
        { status: 401 }
      );
    }

    let cookieHeader: string | null = null;
    let finalUrl: string | null = null;
    try {
      const cookies = await context.cookies("https://stockx.com");
      finalUrl = page.url();
      if (!capturedDeviceId) {
        const fromCookie = cookies.find((c) => c.name === "stockx_device_id")?.value || null;
        if (fromCookie) capturedDeviceId = fromCookie;
      }
      if (!capturedSessionId) {
        const fromCookie = cookies.find((c) => c.name === "stockx_session_id")?.value || null;
        if (fromCookie) capturedSessionId = fromCookie;
      }
      if (cookies.length > 0) {
        cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      }
    } catch {
      cookieHeader = null;
      finalUrl = null;
    }

    await context.storageState({ path: sessionFile });
    console.log("[STOCKX-PW] Session saved");

    await fs.writeFile(
      sessionMetaFile,
      `${JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          sessionFile,
          userDataDir,
          browserType,
          persistent,
          deviceId: capturedDeviceId,
          sessionId: capturedSessionId,
          cookieHeader,
          lastUrl: finalUrl,
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    if (tokenFile) {
      const tokenPayload = {
        token: stripBearer(capturedToken),
        updatedAt: new Date().toISOString(),
        source: attachedWarmCdp ? "warm-cdp" : leaveWarm ? "leave-warm" : "playwright",
      };
      await fs.writeFile(tokenFile, `${JSON.stringify(tokenPayload, null, 2)}\n`, "utf8");
      await markWarmToken(credentialsAccount).catch(() => undefined);
    }
    const existingHashes = await readStockxPersistedHashes(persistedHashesFile);
    const mergedHashes = {
      ...existingHashes,
      ...capturedPersistedHashes,
    };
    await writeStockxPersistedHashes(mergedHashes, persistedHashesFile);

    if (leftWarm) {
      cleanupContext = null;
      cleanupBrowser = null;
      console.log("[STOCKX-PW] leaveWarm — browser kept open after success");
    } else if (usedPersistentContext) {
      await context.close();
      cleanupContext = null;
      cleanupBrowser = null;
    } else {
      await browser?.close();
      cleanupContext = null;
      cleanupBrowser = null;
    }

    return NextResponse.json({
      ok: true,
      token: stripBearer(capturedToken),
      sessionFile,
      sessionMetaFile,
      tokenFile: tokenFile ?? null,
      persistedHashesFile,
      persistentFallback,
      leftWarm,
      attachedWarmCdp,
      captured: {
        deviceId: capturedDeviceId,
        sessionId: capturedSessionId,
        hasCookieHeader: Boolean(cookieHeader && cookieHeader.trim()),
        lastUrl: finalUrl,
        persistedHashes: capturedPersistedHashes,
      },
    });
  } catch (error: any) {
    try {
      // Never kill a shared warm CDP browser on request errors.
      if (!skipWarmClose && cleanupContext) {
        await cleanupContext.close();
      } else if (!skipWarmClose && cleanupBrowser) {
        await cleanupBrowser.close();
      }
    } catch {
      // ignore cleanup failures
    }
    const profileLocked = isPersistentProfileLockError(error);
    const errorMessage = profileLocked
      ? "StockX browser profile locked by another Chromium instance. Close other StockX browser windows, then retry."
      : String(error?.message || "Playwright failure").split("\n")[0];
    console.error("[STOCKX-PW] Error:", error?.message || error);
    return NextResponse.json(
      { ok: false, error: errorMessage },
      { status: profileLocked ? 409 : 500 }
    );
  }
}

