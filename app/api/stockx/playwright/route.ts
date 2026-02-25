import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, firefox } from "playwright";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SESSION_FILE = path.join(process.cwd(), ".data", "stockx-session.json");

const ensureSessionDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
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
    const maxWaitMs = Math.min(Number(body?.maxWaitMs || 600000), 900000);
    const forceLogin = Boolean(body?.forceLogin ?? false);

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
    if (forceLogin) {
      try {
        await fs.unlink(sessionFile);
        console.log("[STOCKX-PW] Deleted existing session (force login)");
      } catch {
        // ignore missing file
      }
      context = await browser.newContext();
      console.log("[STOCKX-PW] Force login: fresh context");
    } else {
      try {
        await fs.access(sessionFile);
        context = await browser.newContext({ storageState: sessionFile });
        console.log("[STOCKX-PW] Loaded existing session");
      } catch {
        context = await browser.newContext();
        console.log("[STOCKX-PW] No session found, fresh context");
      }
    }

    let capturedToken: string | null = null;

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
        !url.includes("pro.stockx.com")
      ) {
        return;
      }
      const headers = res.headers();
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
    await page.goto("https://stockx.com/login", { waitUntil: "domcontentloaded" });

    const start = Date.now();
    while (!capturedToken && Date.now() - start < maxWaitMs) {
      await page.waitForTimeout(2000);
      if (capturedToken) break;
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
    }

    await context.storageState({ path: sessionFile });
    console.log("[STOCKX-PW] Session saved");
    await browser.close();

    if (!capturedToken) {
      return NextResponse.json(
        { ok: false, error: "StockX token not found. Login may be incomplete." },
        { status: 401 }
      );
    }

    return NextResponse.json({
      ok: true,
      token: stripBearer(capturedToken),
      sessionFile,
    });
  } catch (error: any) {
    console.error("[STOCKX-PW] Error:", error?.message || error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Playwright failure" },
      { status: 500 }
    );
  }
}

