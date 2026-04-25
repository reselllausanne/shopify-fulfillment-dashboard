import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, firefox, type Browser, type BrowserContext } from "playwright";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SESSION_FILE = path.join(process.cwd(), ".data", "stockx-session.json");

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

export async function POST(req: NextRequest) {
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
    const tokenFile = resolveOptionalFile(body?.tokenFile);
    const maxWaitMs = Math.min(Number(body?.maxWaitMs || 600000), 900000);
    let forceLogin = Boolean(body?.forceLogin ?? false);
    const waitForUserClose = Boolean(body?.waitForUserClose ?? false);
    const waitForCloseMs = Math.min(Number(body?.waitForCloseMs || 120000), 600000);
    const autoNavigate = Boolean(body?.autoNavigate ?? true);
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
    if (tokenFile) await ensureSessionDir(tokenFile);

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
      console.log("[STOCKX-PW] Using persistent context");
    } else {
      browser =
        browserType === "chromium"
          ? await chromium.launch(launchOptions)
          : await firefox.launch(launchOptions);

      if (forceLogin) {
        try {
          await fs.unlink(sessionFile);
          console.log("[STOCKX-PW] Deleted existing session (force login)");
        } catch {
          // ignore missing file
        }
        context = await browser.newContext({ userAgent });
        console.log("[STOCKX-PW] Force login: fresh context");
      } else {
        try {
          await fs.access(sessionFile);
          context = await browser.newContext({ storageState: sessionFile, userAgent });
          console.log("[STOCKX-PW] Loaded existing session");
        } catch {
          context = await browser.newContext({ userAgent });
          console.log("[STOCKX-PW] No session found, fresh context");
        }
      }
    }

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    let capturedToken: string | null = null;
    const consoleLogs: string[] = [];
    const pageErrors: string[] = [];
    const requestFails: string[] = [];
    const authResponses: Array<{ url: string; status: number }> = [];

    context.on("request", (req) => {
      const url = req.url();
      if (
        !url.includes("stockx.com") &&
        !url.includes("gateway.stockx.com") &&
        !url.includes("stockx.com")
      ) {
        return;
      }
      const headers = req.headers();
      const auth = headers["authorization"] || headers["Authorization"];
      const normalized = normalizeBearer(auth || null);
      if (
        normalized &&
        !/undefined|null/i.test(normalized) &&
        normalized.length > 25
      ) {
        capturedToken = normalized;
      }
    });

    context.on("response", async (res) => {
      const url = res.url();
      if (
        !url.includes("stockx.com") &&
        !url.includes("gateway.stockx.com") &&
        !url.includes("stockx.com")
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
      const cleanupTargets = [userDataDir, sessionFile];
      if (tokenFile) cleanupTargets.push(tokenFile);
      for (const target of cleanupTargets) {
        try {
          await fs.rm(target, { recursive: true, force: true });
        } catch {
          // ignore cleanup failures
        }
      }
      if (persistent) {
        await context.close();
      } else {
        await browser?.close();
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
      await page.waitForTimeout(2000);
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
      const localStorageDump = await page.evaluate(() => {
        const out: Record<string, string | null> = {};
        for (const key of Object.keys(localStorage)) {
          out[key] = localStorage.getItem(key);
        }
        return out;
      });
      const token = extractTokenFromStorage(localStorageDump);
      if (token) {
        capturedToken = token;
        break;
      }
      const sessionDump = await page.evaluate(() => {
        const out: Record<string, string | null> = {};
        for (const key of Object.keys(sessionStorage)) {
          out[key] = sessionStorage.getItem(key);
        }
        return out;
      });
      const sessionToken = extractTokenFromStorage(sessionDump);
      if (sessionToken) {
        capturedToken = sessionToken;
        break;
      }
      const cookies = await context.cookies();
      const cookieToken = extractTokenFromCookies(cookies as Array<{ name: string; value: string }>);
      if (cookieToken) {
        capturedToken = cookieToken;
        break;
      }
    }

    if (!persistent) {
      await context.storageState({ path: sessionFile });
      console.log("[STOCKX-PW] Session saved");
    }
    if (persistent) {
      await context.close();
    } else {
      await browser?.close();
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

    if (tokenFile) {
      const tokenPayload = {
        token: stripBearer(capturedToken),
        updatedAt: new Date().toISOString(),
      };
      await fs.writeFile(tokenFile, `${JSON.stringify(tokenPayload, null, 2)}\n`, "utf8");
    }

    return NextResponse.json({
      ok: true,
      token: stripBearer(capturedToken),
      sessionFile,
      tokenFile: tokenFile ?? null,
    });
  } catch (error: any) {
    console.error("[STOCKX-PW] Error:", error?.message || error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Playwright failure" },
      { status: 500 }
    );
  }
}

