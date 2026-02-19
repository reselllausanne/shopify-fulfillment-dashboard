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
    const headless = Boolean(body?.headless ?? false);
    const browserType = String(body?.browser || "firefox").toLowerCase();
    const sessionFile = String(body?.sessionFile || DEFAULT_SESSION_FILE);
    const maxWaitMs = Math.min(Number(body?.maxWaitMs || 120000), 300000);
    const includeRaw = Boolean(body?.includeRaw ?? false);

    await ensureSessionDir(sessionFile);

    const browser =
      browserType === "chromium"
        ? await chromium.launch({ headless, slowMo: 50 })
        : await firefox.launch({ headless, slowMo: 50 });

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

    const start = Date.now();
    while (allOrdersRaw.length === 0 && Date.now() - start < maxWaitMs) {
      await page.waitForTimeout(2000);
    }

    if (allOrdersRaw.length === 0) {
      await browser.close();
      return NextResponse.json(
        { ok: false, error: "No GOAT orders detected. Login required." },
        { status: 401 }
      );
    }

    await context.storageState({ path: sessionFile });
    console.log("[GOAT-PW] Session saved");

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

