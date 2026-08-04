import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, firefox, type Browser, type BrowserContext } from "playwright";
import { extractOrdersArray, normalizeGoatOrder } from "@/app/lib/goat/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SESSION_FILE = path.join(process.cwd(), ".data", "goat-session.json");

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
    return browser.newContext({ userAgent });
  }

  try {
    await fs.access(sessionFile);
    console.log("[GOAT-PW] Loaded existing session");
    return browser.newContext({ storageState: sessionFile, userAgent });
  } catch {
    console.log("[GOAT-PW] No session found, fresh context");
    return browser.newContext({ userAgent });
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

export async function POST(req: NextRequest) {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let usedPersistentContext = false;

  try {
    const body = await req.json().catch(() => ({}));
    const headless = Boolean(body?.headless ?? true);
    const browserType = String(body?.browser || "firefox").toLowerCase();
    const sessionFile = String(body?.sessionFile || DEFAULT_SESSION_FILE);
    const maxWaitMs = Math.min(Number(body?.maxWaitMs || 120000), 300000);
    const includeRaw = Boolean(body?.includeRaw ?? false);
    const forceLogin = Boolean(body?.forceLogin ?? false);
    const persistent = Boolean(body?.persistent ?? false);
    const userDataDir = String(
      body?.userDataDir || path.join(process.cwd(), ".data", "goat-profile")
    );
    const userAgent = String(
      body?.userAgent ||
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    );

    await ensureSessionDir(sessionFile);

    const launchArgs = headless
      ? ["--no-sandbox", "--disable-setuid-sandbox"]
      : [];
    const antiBotArgs = ["--disable-blink-features=AutomationControlled"];
    const launchOptions = {
      headless,
      slowMo: 50,
      args: [...launchArgs, ...antiBotArgs],
    };

    let persistentFallback = false;

    if (persistent) {
      await fs.mkdir(userDataDir, { recursive: true });
      // Stale locks from crashed Chromium often leave Singleton* files behind.
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
            : await firefox.launch({ headless, slowMo: 50, args: launchArgs });
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
          : await firefox.launch({ headless, slowMo: 50, args: launchArgs });
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

    page.on("response", async (response) => {
      try {
        const url = response.url();
        if (/\/login|\/sessions|\/session|\/auth/i.test(url)) {
          loginResponses.push({ url, status: response.status() });
        }
        if (!url.includes("/web-api/v1/orders")) return;
        if (response.request().method() !== "GET") return;
        const json = await response.json();
        const items = extractOrdersArray(json);
        if (items.length) allOrdersRaw.push(...items);
      } catch {
        // ignore parse errors
      }
    });

    await page.goto("https://www.goat.com/fr-fr/account/orders", {
      waitUntil: "domcontentloaded",
    });

    const start = Date.now();
    while (allOrdersRaw.length === 0 && Date.now() - start < maxWaitMs) {
      await page.waitForTimeout(2000);
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
      await closeBrowserResources(usedPersistentContext, context, browser);
      return NextResponse.json(
        {
          ok: false,
          error: "No GOAT orders detected. Login required.",
          persistentFallback,
          debug: {
            lastUrl: page.url(),
            screenshotPath,
            htmlPath,
            consoleLogs: consoleLogs.slice(-50),
            pageErrors: pageErrors.slice(-20),
            requestFails: requestFails.slice(-20),
            loginResponses: loginResponses.slice(-10),
          },
        },
        { status: 401 }
      );
    }

    // Always persist storageState so fallback / non-persistent runs keep cookies.
    try {
      await context.storageState({ path: sessionFile });
      console.log("[GOAT-PW] Session saved");
    } catch (error: any) {
      console.warn("[GOAT-PW] Failed to save session:", error?.message || error);
    }

    // Pagination via fetch inside browser context (keeps cookies)
    let pageNum = 2;
    while (pageNum <= 200) {
      const result = await page.evaluate(async (p) => {
        try {
          const res = await fetch(`/web-api/v1/orders?filter=buy&page=${p}`);
          if (!res.ok) return null;
          return await res.json();
        } catch {
          return null;
        }
      }, pageNum);
      const pageItems = extractOrdersArray(result);
      if (!pageItems.length) break;
      allOrdersRaw.push(...pageItems);
      pageNum += 1;
      await page.waitForTimeout(200);
    }

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
