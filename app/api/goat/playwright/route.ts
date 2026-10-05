import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium, firefox, type Browser, type BrowserContext, type Page } from "playwright";
import { extractOrdersArray, normalizeGoatOrder } from "@/app/lib/goat/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

const DEFAULT_SESSION_FILE = path.join(process.cwd(), ".data", "goat-session.json");
const ORDERS_URLS = [
  "https://www.goat.com/fr-fr/account/orders",
  "https://www.goat.com/en-us/account/orders",
  "https://www.goat.com/account/orders",
];
const ORDER_FETCH_PATHS = [
  "/web-api/v1/orders?filter=buy&page=PAGE",
  "/web-api/v1/orders?filter=purchases&page=PAGE",
  "/web-api/v1/orders?page=PAGE",
  "/web-api/v2/orders?filter=buy&page=PAGE",
  "/web-api/v1/purchases?page=PAGE",
  "/web-api/v1/purchase_orders?page=PAGE",
  "/web-api/v1/users/me/orders?filter=buy&page=PAGE",
];

const ensureSessionDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
};

const isPersistentProfileLockError = (error: unknown): boolean => {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("processsingleton") ||
    message.includes("singletonlock") ||
    message.includes("profile is already in use") ||
    message.includes("failed to create a processsingleton") ||
    message.includes("browser has been closed")
  );
};

const isCloudflarePage = (url: string, title: string): boolean => {
  const hay = `${url} ${title}`.toLowerCase();
  return (
    /just a moment|attention required|performing security verification|verify you are (not )?a bot|cf-browser-verification/.test(
      hay
    ) || /cdn-cgi|challenges\.cloudflare\.com/.test(hay)
  );
};

const isLoginPage = (url: string): boolean =>
  /\/(login|signin|sign-in|auth|account\/login)/i.test(url);

const isGoatOrdersApiUrl = (url: string): boolean => {
  const lower = url.toLowerCase();
  if (!/goat\.com/i.test(lower)) return false;
  if (/\.(js|css|png|jpe?g|gif|webp|svg|woff2?|map)(\?|$)/i.test(lower)) return false;
  return /\/(web-api|api)\//i.test(lower) && /(order|purchase|buy)/i.test(lower);
};

const pagePathFromUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url, "https://www.goat.com");
    const page = parsed.searchParams.get("page");
    if (page) parsed.searchParams.set("page", "PAGE");
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
};

const clearStaleChromeProfileLocks = async (userDataDir: string) => {
  const lockNames = [
    "SingletonLock",
    "SingletonCookie",
    "SingletonSocket",
    "RunningChromeVersion",
  ];
  for (const name of lockNames) {
    try {
      await fs.unlink(path.join(userDataDir, name));
    } catch {
      // ignore missing
    }
  }
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
      console.log("[GOAT-PW] Deleted existing session (force login)");
    } catch {
      // ignore missing file
    }
    console.log("[GOAT-PW] Force login: fresh context");
    return browser.newContext({
      userAgent,
      locale: "fr-FR",
      timezoneId: "Europe/Paris",
    });
  }

  try {
    await fs.access(sessionFile);
    console.log("[GOAT-PW] Loaded existing session");
    return browser.newContext({
      storageState: sessionFile,
      userAgent,
      locale: "fr-FR",
      timezoneId: "Europe/Paris",
    });
  } catch {
    console.log("[GOAT-PW] No session found, fresh context");
    return browser.newContext({
      userAgent,
      locale: "fr-FR",
      timezoneId: "Europe/Paris",
    });
  }
};

const closeBrowserResources = async (
  persistentUsed: boolean,
  context: BrowserContext | null,
  browser: Browser | null
) => {
  try {
    if (persistentUsed) {
      await context?.close();
    } else {
      await browser?.close();
    }
  } catch {
    // ignore close races
  }
};

const fetchOrdersFromPage = async (
  page: Page,
  pathTemplate: string,
  pageNum: number
): Promise<unknown> => {
  const requestPath = pathTemplate.replace("PAGE", String(pageNum));
  return page.evaluate(async (target) => {
    try {
      const res = await fetch(target, {
        method: "GET",
        credentials: "include",
        headers: {
          accept: "application/json",
          "x-requested-with": "XMLHttpRequest",
        },
      });
      if (!res.ok) return { __goatStatus: res.status, __goatPath: target };
      return await res.json();
    } catch {
      return null;
    }
  }, requestPath);
};

const collectAuthFromContext = async (
  context: BrowserContext,
  capturedCookie: string | null,
  capturedCsrf: string | null
): Promise<{ cookie: string | null; csrfToken: string | null }> => {
  let cookie = capturedCookie;
  let csrfToken = capturedCsrf;
  try {
    const cookies = await context.cookies();
    if (!cookie) {
      const header = cookies
        .filter((entry) => /goat\.com/i.test(entry.domain || "") || !entry.domain)
        .map((entry) => `${entry.name}=${entry.value}`)
        .join("; ");
      if (header) cookie = header;
    }
    if (!csrfToken) {
      const csrfCookie = cookies.find((entry) => /csrf/i.test(entry.name));
      if (csrfCookie?.value) csrfToken = csrfCookie.value;
    }
  } catch {
    // ignore cookie read failures
  }
  return { cookie, csrfToken };
};

const SYSTEM_CHROME_PATH =
  process.env.GOAT_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_PORT = Number(process.env.GOAT_CDP_PORT || 9333);
const CDP_PROFILE_DIR = path.join(process.cwd(), ".data", "goat-chrome-cdp");

type CdpTarget = { type: string; url: string; title: string };

const listCdpTargets = async (): Promise<CdpTarget[] | null> => {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    return (await res.json()) as CdpTarget[];
  } catch {
    return null;
  }
};

const normalizeAndDedupe = (rawOrders: any[]) => {
  const seen = new Set<string>();
  return rawOrders
    .map((raw) => normalizeGoatOrder(raw))
    .filter((o: any) => {
      const key = o?.orderId;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

/**
 * Cloudflare Turnstile on goat.com rejects Playwright-launched browsers (checkbox loops forever).
 * Real Chrome is started as a plain process; CDP attaches only after the user is past Cloudflare
 * and logged in, so the challenge never sees an automated browser.
 */
async function fetchViaSystemChrome({
  sessionFile,
  maxWaitMs,
  includeRaw,
}: {
  sessionFile: string;
  maxWaitMs: number;
  includeRaw: boolean;
}): Promise<NextResponse> {
  if (!(await listCdpTargets())) {
    await fs.mkdir(CDP_PROFILE_DIR, { recursive: true });
    await clearStaleChromeProfileLocks(CDP_PROFILE_DIR);
    const child = spawn(
      SYSTEM_CHROME_PATH,
      [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${CDP_PROFILE_DIR}`,
        "--no-first-run",
        "--no-default-browser-check",
        ORDERS_URLS[0],
      ],
      { detached: true, stdio: "ignore" }
    );
    child.unref();
    console.log("[GOAT-PW] Spawned system Chrome on CDP port", CDP_PORT);
  } else {
    console.log("[GOAT-PW] Reusing running system Chrome on CDP port", CDP_PORT);
  }

  const start = Date.now();
  let browser: Browser | null = null;
  let page: Page | null = null;
  let lastTarget: CdpTarget | null = null;
  let lastProbeStatus: number | null = null;
  while (Date.now() - start < maxWaitMs) {
    const targets = await listCdpTargets();
    const goatTarget = targets?.find((t) => t.type === "page" && /goat\.com/i.test(t.url)) ?? null;
    if (goatTarget) lastTarget = goatTarget;
    // Attaching CDP while Cloudflare is still challenging gets the browser flagged.
    if (
      goatTarget &&
      !isCloudflarePage(goatTarget.url, goatTarget.title) &&
      !/^un instant/i.test(goatTarget.title)
    ) {
      const candidate = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
      const candidatePage =
        candidate.contexts()[0]?.pages().find((p) => /goat\.com/i.test(p.url())) ?? null;
      lastProbeStatus = candidatePage
        ? await candidatePage
            .evaluate(async () => {
              const res = await fetch("/web-api/v1/users/me", {
                credentials: "include",
                headers: { accept: "application/json" },
              });
              return res.status;
            })
            .catch(() => null)
        : null;
      if (lastProbeStatus === 200 && candidatePage) {
        browser = candidate;
        page = candidatePage;
        break;
      }
      await candidate.close().catch(() => undefined);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  if (!browser || !page) {
    return NextResponse.json(
      {
        ok: false,
        error: "GOAT not logged in. In the Chrome window: pass Cloudflare and log in, then retry.",
        debug: {
          lastUrl: lastTarget?.url,
          lastTitle: lastTarget?.title,
          lastProbeStatus,
          cdpPort: CDP_PORT,
        },
      },
      { status: 401 }
    );
  }

  try {
    const context = browser.contexts()[0];

    const allOrdersRaw: any[] = [];
    let discoveredPath: string | null = null;
    for (const template of ORDER_FETCH_PATHS) {
      const items = extractOrdersArray(await fetchOrdersFromPage(page, template, 1));
      if (items.length) {
        allOrdersRaw.push(...items);
        discoveredPath = template;
        break;
      }
    }

    if (!discoveredPath) {
      const onResponse = async (response: any) => {
        try {
          const url = response.url();
          if (!isGoatOrdersApiUrl(url)) return;
          const items = extractOrdersArray(await response.json());
          if (!items.length) return;
          allOrdersRaw.push(...items);
          discoveredPath = pagePathFromUrl(url);
        } catch {
          // ignore non-JSON
        }
      };
      page.on("response", onResponse);
      await page.reload({ waitUntil: "networkidle", timeout: 45000 }).catch(() => undefined);
      await page.waitForTimeout(3000);
      page.off("response", onResponse);
    }

    if (!allOrdersRaw.length) {
      return NextResponse.json(
        { ok: false, error: "Logged in, but no GOAT orders API response found.", debug: { url: page.url() } },
        { status: 502 }
      );
    }

    if (discoveredPath?.includes("PAGE")) {
      for (let pageNum = 2; pageNum <= 200; pageNum += 1) {
        const items = extractOrdersArray(await fetchOrdersFromPage(page, discoveredPath, pageNum));
        if (!items.length) break;
        allOrdersRaw.push(...items);
        await page.waitForTimeout(200);
      }
    }

    await ensureSessionDir(sessionFile);
    await context.storageState({ path: sessionFile }).catch(() => undefined);
    const auth = await collectAuthFromContext(context, null, null);
    const deduped = normalizeAndDedupe(allOrdersRaw);

    return NextResponse.json({
      ok: true,
      count: deduped.length,
      orders: deduped,
      sessionFile,
      viaSystemChrome: true,
      cookie: auth.cookie,
      csrfToken: auth.csrfToken,
      discoveredPath,
      rawOrders: includeRaw ? allOrdersRaw : undefined,
    });
  } finally {
    // Disconnects only; the user's Chrome window stays open for the next run.
    await browser.close().catch(() => undefined);
  }
}

export async function POST(req: NextRequest) {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let usedPersistentContext = false;

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
    const browserType = String(body?.browser || "chromium").toLowerCase();
    // Local Mac: use installed Google Chrome when possible (Playwright Chromium gets GOAT login 403).
    const useSystemChrome =
      body?.channel === "chrome" ||
      (browserType === "chromium" && process.platform === "darwin" && !headless);
    const sessionFile = String(body?.sessionFile || DEFAULT_SESSION_FILE);
    const maxWaitMs = Math.min(Number(body?.maxWaitMs || 600000), 900000);
    const includeRaw = Boolean(body?.includeRaw ?? false);
    const forceLogin = Boolean(body?.forceLogin ?? false);
    const persistent = Boolean(body?.persistent ?? true);
    const userDataDir = String(
      body?.userDataDir || path.join(process.cwd(), ".data", "goat-profile")
    );
    const userAgent = String(
      body?.userAgent ||
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );

    await ensureSessionDir(sessionFile);
    if (useSystemChrome && process.platform === "darwin" && body?.mode !== "playwright") {
      return await fetchViaSystemChrome({ sessionFile, maxWaitMs, includeRaw });
    }
    if (!process.env.DISPLAY) {
      process.env.DISPLAY = ":99";
    }

    const launchArgs = ["--no-sandbox", "--disable-setuid-sandbox"];
    const antiBotArgs = ["--disable-blink-features=AutomationControlled"];
    const launchEnv: Record<string, string | undefined> = {
      ...process.env,
      DISPLAY: process.env.DISPLAY || ":99",
      MOZ_DISABLE_CONTENT_SANDBOX: "1",
    };
    const launchOptions: Record<string, unknown> = {
      headless,
      slowMo: headless ? 0 : 80,
      args: [...launchArgs, ...antiBotArgs],
      env: launchEnv,
    };
    if (useSystemChrome) {
      launchOptions.channel = "chrome";
      console.log("[GOAT-PW] Using system Google Chrome channel");
    }

    let persistentFallback = false;

    if (persistent) {
      await fs.mkdir(userDataDir, { recursive: true });
      if (forceLogin) {
        try {
          await fs.rm(userDataDir, { recursive: true, force: true });
          await fs.mkdir(userDataDir, { recursive: true });
          console.log("[GOAT-PW] Deleted persistent profile (force login)");
        } catch {
          // ignore
        }
      }
      await clearStaleChromeProfileLocks(userDataDir);

      try {
        context = await chromium.launchPersistentContext(userDataDir, {
          ...launchOptions,
          locale: "fr-FR",
          timezoneId: "Europe/Paris",
          userAgent,
        });
        browser = context.browser();
        usedPersistentContext = true;
        console.log("[GOAT-PW] Using persistent context");
      } catch (error: any) {
        if (!isPersistentProfileLockError(error)) throw error;
        persistentFallback = true;
        console.warn(
          "[GOAT-PW] Persistent profile busy; fallback to ephemeral context:",
          error?.message || error
        );
        await clearStaleChromeProfileLocks(userDataDir);
        browser =
          browserType === "chromium"
            ? await chromium.launch(launchOptions)
            : await firefox.launch({
                headless,
                slowMo: headless ? 0 : 50,
                args: launchArgs,
                env: launchEnv,
              });
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
          : await firefox.launch({
              headless,
              slowMo: headless ? 0 : 50,
              args: launchArgs,
              env: launchEnv,
            });
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

    const page = await context.newPage();
    const allOrdersRaw: any[] = [];
    const consoleLogs: string[] = [];
    const pageErrors: string[] = [];
    const requestFails: string[] = [];
    const loginResponses: Array<{ url: string; status: number }> = [];
    const seenOrderApiUrls: string[] = [];
    let discoveredPath: string | null = null;
    let capturedCookie: string | null = null;
    let capturedCsrf: string | null = null;

    const ingestJson = (json: unknown, sourceUrl?: string) => {
      const items = extractOrdersArray(json);
      if (!items.length) return false;
      allOrdersRaw.push(...items);
      if (sourceUrl) {
        const template = pagePathFromUrl(sourceUrl);
        if (template) discoveredPath = template;
      }
      return true;
    };

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

    page.on("request", (request) => {
      try {
        const url = request.url();
        if (!isGoatOrdersApiUrl(url) && !/\/(login|sessions|session|auth)/i.test(url)) return;
        const headers = request.headers();
        const cookie = headers.cookie || headers.Cookie;
        const csrf = headers["x-csrf-token"] || headers["x-xsrf-token"];
        if (cookie && cookie.length > 20) capturedCookie = cookie;
        if (csrf) capturedCsrf = csrf;
      } catch {
        // ignore
      }
    });

    page.on("response", async (response) => {
      try {
        const url = response.url();
        if (/\/login|\/sessions|\/session|\/auth/i.test(url)) {
          loginResponses.push({ url, status: response.status() });
        }
        if (!isGoatOrdersApiUrl(url)) return;
        if (!["GET", "POST"].includes(response.request().method())) return;
        seenOrderApiUrls.push(`${response.status()} ${url}`);
        const json = await response.json();
        ingestJson(json, url);
      } catch {
        // ignore parse errors
      }
    });

    let landed = false;
    for (const startUrl of ORDERS_URLS) {
      try {
        await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        landed = true;
        break;
      } catch (error: any) {
        console.warn("[GOAT-PW] goto failed:", startUrl, error?.message || error);
      }
    }
    if (!landed) {
      await page.goto(ORDERS_URLS[0], { waitUntil: "commit", timeout: 60000 }).catch(() => undefined);
    }

    const start = Date.now();
    let lastKick = 0;
    while (allOrdersRaw.length === 0 && Date.now() - start < maxWaitMs) {
      try {
        await page.waitForTimeout(2000);
      } catch {
        break;
      }
      if (page.isClosed()) break;
      if (allOrdersRaw.length) break;

      const currentUrl = page.url();
      const pageTitle = await page.title().catch(() => "");
      if (isCloudflarePage(currentUrl, pageTitle)) {
        console.log("[GOAT-PW] Waiting for Cloudflare challenge");
        continue;
      }

      if (isLoginPage(currentUrl)) {
        continue;
      }

      const now = Date.now();
      if (now - lastKick > 12000) {
        lastKick = now;
        const pathsToTry: string[] = discoveredPath
          ? [discoveredPath, ...ORDER_FETCH_PATHS]
          : [...ORDER_FETCH_PATHS];
        for (const template of pathsToTry) {
          const result = await fetchOrdersFromPage(page, template, 1);
          if (result && typeof result === "object" && !("__goatStatus" in (result as object))) {
            if (ingestJson(result, template.replace("PAGE", "1"))) {
              discoveredPath = template;
              break;
            }
          }
        }
        if (allOrdersRaw.length) break;
        if (!/account\/orders/i.test(currentUrl)) {
          await page.goto(ORDERS_URLS[0], { waitUntil: "domcontentloaded", timeout: 45000 }).catch(
            () => undefined
          );
        }
      }
    }

    if (allOrdersRaw.length === 0) {
      const debugDir = path.join(process.cwd(), ".data");
      await fs.mkdir(debugDir, { recursive: true });
      const screenshotPath = path.join(debugDir, "goat-login-failed.png");
      const htmlPath = path.join(debugDir, "goat-login-failed.html");
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
      const auth = await collectAuthFromContext(context, capturedCookie, capturedCsrf);
      const lastUrl = page.url();
      await closeBrowserResources(usedPersistentContext, context, browser);
      return NextResponse.json(
        {
          ok: false,
          error:
            "No GOAT orders detected. Finish Cloudflare + login in the Playwright window, then retry.",
          persistentFallback,
          cookie: auth.cookie,
          csrfToken: auth.csrfToken,
          debug: {
            lastUrl,
            screenshotPath,
            htmlPath,
            seenOrderApiUrls: seenOrderApiUrls.slice(-20),
            consoleLogs: consoleLogs.slice(-50),
            pageErrors: pageErrors.slice(-20),
            requestFails: requestFails.slice(-20),
            loginResponses: loginResponses.slice(-10),
          },
        },
        { status: 401 }
      );
    }

    try {
      await context.storageState({ path: sessionFile });
      console.log("[GOAT-PW] Session saved");
    } catch (error: any) {
      console.warn("[GOAT-PW] Failed to save session:", error?.message || error);
    }

    const paginationPath = discoveredPath || ORDER_FETCH_PATHS[0];
    let pageNum = 2;
    while (pageNum <= 200) {
      const result = await fetchOrdersFromPage(page, paginationPath, pageNum);
      const pageItems = extractOrdersArray(result);
      if (!pageItems.length) break;
      allOrdersRaw.push(...pageItems);
      pageNum += 1;
      await page.waitForTimeout(200);
    }

    const auth = await collectAuthFromContext(context, capturedCookie, capturedCsrf);
    await closeBrowserResources(usedPersistentContext, context, browser);

    const normalized = allOrdersRaw
      .map((raw) => normalizeGoatOrder(raw))
      .filter((o) => Boolean(o));

    const seen = new Set<string>();
    const deduped = normalized.filter((o: any) => {
      const key = o?.orderId;
      if (!key) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return NextResponse.json({
      ok: true,
      count: deduped.length,
      orders: deduped,
      sessionFile,
      persistentFallback,
      cookie: auth.cookie,
      csrfToken: auth.csrfToken,
      discoveredPath: paginationPath,
      rawOrders: includeRaw ? allOrdersRaw : undefined,
    });
  } catch (error: any) {
    await closeBrowserResources(usedPersistentContext, context, browser);
    console.error("[GOAT-PW] Error:", error?.message || error);
    const profileLocked = isPersistentProfileLockError(error);
    return NextResponse.json(
      {
        ok: false,
        error: profileLocked
          ? "GOAT browser profile is locked (another Chrome instance). Retry — auto-fallback should handle it."
          : error?.message || "Playwright failure",
        profileLocked,
      },
      { status: 500 }
    );
  }
}
