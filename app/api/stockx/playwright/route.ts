import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, firefox, type Browser, type BrowserContext } from "playwright";
import {
  DEFAULT_STOCKX_PERSISTED_HASHES_FILE,
  readStockxPersistedHashes,
  writeStockxPersistedHashes,
} from "@/app/lib/stockxPersistedHashes";

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

const extractTokenFromCookies = (cookies: Array<{ name: string; value: string }>): string | null => {
  for (const cookie of cookies) {
    const token = extractJwtFromText(cookie.value);
    if (token) return `Bearer ${token}`;
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
    const autoNavigate = autoNavigateRequested && headless;
    const startUrl = String(body?.startUrl || "https://stockx.com/login");
    const reuseTokenFile = Boolean(body?.reuseTokenFile ?? true);
    const persistent = Boolean(body?.persistent ?? false);
    const userDataDir = String(
      body?.userDataDir || path.join(process.cwd(), ".data", "stockx-profile")
    );
    const userAgent = String(
      body?.userAgent ||
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    );

    await ensureSessionDir(sessionFile);
    await ensureSessionDir(sessionMetaFile);
    if (tokenFile) await ensureSessionDir(tokenFile);
    await ensureSessionDir(persistedHashesFile);

    if (tokenFile && !forceLogin) {
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
    const launchOptions = {
      headless,
      slowMo: headless ? 0 : 50,
      args: baseArgs,
      env: {
        ...process.env,
        MOZ_DISABLE_CONTENT_SANDBOX: "1",
      },
    };

    let browser: Browser | null = null;
    let context: BrowserContext;
    let usedPersistentContext = false;
    let persistentFallback = false;

    if (persistent) {
      if (forceLogin) {
        try {
          await fs.rm(userDataDir, { recursive: true, force: true });
          console.log("[STOCKX-PW] Deleted persistent profile (force login)");
        } catch {
          // ignore removal errors
        }
      }
      await fs.mkdir(userDataDir, { recursive: true });
      try {
        if (browserType === "chromium") {
          context = await chromium.launchPersistentContext(userDataDir, {
            ...launchOptions,
            locale: "fr-FR",
            timezoneId: "Europe/Paris",
            userAgent,
          });
        } else {
          context = await firefox.launchPersistentContext(userDataDir, {
            ...launchOptions,
            locale: "fr-FR",
            timezoneId: "Europe/Paris",
            userAgent,
          });
        }
        browser = context.browser();
        usedPersistentContext = true;
        console.log("[STOCKX-PW] Using persistent context");
      } catch (error: any) {
        if (!isPersistentProfileLockError(error)) {
          throw error;
        }
        persistentFallback = true;
        console.warn("[STOCKX-PW] Persistent profile busy; fallback to ephemeral context");
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
    } else {
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
      const normalized = normalizeBearer(auth || null);
      if (
        normalized &&
        !/undefined|null/i.test(normalized) &&
        normalized.length > 25
      ) {
        capturedToken = normalized;
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
      const normalized = normalizeBearer(auth || null);
      if (
        normalized &&
        !/undefined|null/i.test(normalized) &&
        normalized.length > 25
      ) {
        capturedToken = normalized;
      }
    });

    const page = await context.newPage();
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
    await page.goto(startUrl, { waitUntil: "domcontentloaded" });
    const currentUrl = page.url();
    const pageTitle = await page.title().catch(() => "");
    const cloudflareDetected =
      /cdn-cgi|challenges\.cloudflare\.com/i.test(currentUrl) ||
      /just a moment|cloudflare/i.test(pageTitle);
    if (cloudflareDetected) {
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
          error: "Cloudflare challenge detected. Profile reset; please retry login.",
          reset: true,
          url: currentUrl,
          title: pageTitle,
        },
        { status: 403 }
      );
    }
    try {
      await page.waitForURL(/stockx\.com\/(login|account|profile|browse)/i, {
        timeout: 15000,
      });
    } catch {
      // ignore URL wait timeout
    }

    const start = Date.now();
    let lastKick = 0;
    while (!capturedToken && Date.now() - start < maxWaitMs) {
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
            await page.goto(startUrl, { waitUntil: "domcontentloaded" });
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
      const token = extractTokenFromStorage(localStorageDump);
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
      const sessionToken = extractTokenFromStorage(sessionDump);
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
      return NextResponse.json(
        {
          ok: false,
          error: "StockX token not found. Login may be incomplete.",
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
      };
      await fs.writeFile(tokenFile, `${JSON.stringify(tokenPayload, null, 2)}\n`, "utf8");
    }
    const existingHashes = await readStockxPersistedHashes(persistedHashesFile);
    const mergedHashes = {
      ...existingHashes,
      ...capturedPersistedHashes,
    };
    await writeStockxPersistedHashes(mergedHashes, persistedHashesFile);

    if (usedPersistentContext) {
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
      if (cleanupContext) {
        await cleanupContext.close();
      } else if (cleanupBrowser) {
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

