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

export async function POST(req: NextRequest) {
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

    let browser: Browser | null = null;
    let context: BrowserContext;

    if (persistent) {
      await fs.mkdir(userDataDir, { recursive: true });
      context = await chromium.launchPersistentContext(userDataDir, {
        headless,
        slowMo: 50,
        args: [...launchArgs, ...antiBotArgs],
        locale: "fr-FR",
        timezoneId: "Europe/Paris",
        userAgent,
      });
      browser = context.browser();
      console.log("[GOAT-PW] Using persistent context");
    } else {
      browser =
        browserType === "chromium"
          ? await chromium.launch({ headless, slowMo: 50, args: [...launchArgs, ...antiBotArgs] })
          : await firefox.launch({ headless, slowMo: 50, args: launchArgs });

      if (forceLogin) {
        try {
          await fs.unlink(sessionFile);
          console.log("[GOAT-PW] Deleted existing session (force login)");
        } catch {
          // ignore missing file
        }
        context = await browser.newContext({ userAgent });
        console.log("[GOAT-PW] Force login: fresh context");
      } else {
        try {
          await fs.access(sessionFile);
          context = await browser.newContext({ storageState: sessionFile, userAgent });
          console.log("[GOAT-PW] Loaded existing session");
        } catch {
          context = await browser.newContext({ userAgent });
          console.log("[GOAT-PW] No session found, fresh context");
        }
      }
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
      if (persistent) {
        await context.close();
      } else {
        await browser?.close();
      }
      return NextResponse.json(
        {
          ok: false,
          error: "No GOAT orders detected. Login required.",
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

    if (!persistent) {
      await context.storageState({ path: sessionFile });
      console.log("[GOAT-PW] Session saved");
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

    if (persistent) {
      await context.close();
    } else {
      await browser?.close();
    }

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
      rawOrders: includeRaw ? allOrdersRaw : undefined,
    });
  } catch (error: any) {
    console.error("[GOAT-PW] Error:", error?.message || error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Playwright failure" },
      { status: 500 }
    );
  }
}

