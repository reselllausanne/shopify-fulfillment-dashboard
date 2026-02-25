import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, firefox } from "playwright";
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
    // Keep below common reverse-proxy timeouts to avoid 504s.
    const maxWaitMs = Math.min(Number(body?.maxWaitMs || 55000), 120000);
    const includeRaw = Boolean(body?.includeRaw ?? false);
    const collectOrders = Boolean(body?.collectOrders ?? true);

    await ensureSessionDir(sessionFile);

    const launchOptions = {
      headless,
      slowMo: headless ? 0 : 50,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      env: {
        ...process.env,
        MOZ_DISABLE_CONTENT_SANDBOX: "1",
      },
    };
    const browser =
      browserType === "chromium"
        ? await chromium.launch(launchOptions)
        : await firefox.launch(launchOptions);

    let context;
    try {
      await fs.access(sessionFile);
      context = await browser.newContext({ storageState: sessionFile });
      console.log("[GOAT-PW] Loaded existing session");
    } catch {
      context = await browser.newContext();
      console.log("[GOAT-PW] No session found, fresh context");
    }

    const page = await context.newPage();
    const allOrdersRaw: any[] = [];

    page.on("response", async (response) => {
      try {
        if (!response.url().includes("/web-api/v1/orders")) return;
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

    if (!collectOrders) {
      await context.storageState({ path: sessionFile });
      await browser.close();
      return NextResponse.json({
        ok: true,
        sessionReady: true,
        count: 0,
        orders: [],
        sessionFile,
      });
    }

    const start = Date.now();
    while (allOrdersRaw.length === 0 && Date.now() - start < maxWaitMs) {
      await page.waitForTimeout(2000);
    }

    await context.storageState({ path: sessionFile });
    console.log("[GOAT-PW] Session saved");

    if (allOrdersRaw.length === 0) {
      await browser.close();
      return NextResponse.json({
        ok: true,
        count: 0,
        orders: [],
        sessionFile,
        loginRequired: true,
        warning:
          "No GOAT orders detected yet. If this is first login or 2FA flow, complete auth in remote desktop then retry.",
      });
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

    await browser.close();

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

