import fs from "node:fs/promises";
import path from "node:path";

export type StockxSessionHeaders = {
  cookie: string | null;
  deviceId: string | null;
  sessionId: string | null;
  sessionFile: string | null;
};

const DEFAULT_SESSION_FILE = path.join(process.cwd(), ".data", "stockx-session.json");
const FALLBACK_SESSION_FILE = path.join(process.cwd(), ".data", "stockx-session-galaxus.json");
const CACHE_TTL_MS = 30_000;
let cached: { value: StockxSessionHeaders | null; at: number } | null = null;

type StoredCookie = {
  name?: string;
  value?: string;
  domain?: string;
  expires?: number;
};

const isExpired = (cookie: StoredCookie, nowSeconds: number): boolean => {
  if (!cookie.expires || cookie.expires <= 0) return false;
  return cookie.expires < nowSeconds - 30;
};

const pickSessionFile = async (): Promise<string | null> => {
  try {
    await fs.access(DEFAULT_SESSION_FILE);
    return DEFAULT_SESSION_FILE;
  } catch {
    // ignore
  }
  try {
    await fs.access(FALLBACK_SESSION_FILE);
    return FALLBACK_SESSION_FILE;
  } catch {
    return null;
  }
};

export async function readStockxSessionHeaders(): Promise<StockxSessionHeaders | null> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }
  const sessionFile = await pickSessionFile();
  if (!sessionFile) {
    cached = { value: null, at: Date.now() };
    return null;
  }
  try {
    const raw = await fs.readFile(sessionFile, "utf8");
    const parsed = JSON.parse(raw) as { cookies?: StoredCookie[] };
    const cookies = Array.isArray(parsed?.cookies) ? parsed.cookies : [];
    const nowSeconds = Date.now() / 1000;
    const parts: string[] = [];
    let deviceId: string | null = null;
    let sessionId: string | null = null;

    for (const cookie of cookies) {
      const name = String(cookie?.name ?? "").trim();
      const value = String(cookie?.value ?? "").trim();
      const domain = String(cookie?.domain ?? "").trim().toLowerCase();
      if (!name || !value) continue;
      if (!domain.endsWith("stockx.com")) continue;
      if (isExpired(cookie, nowSeconds)) continue;
      if (name === "stockx_device_id") deviceId = value;
      if (name === "stockx_session_id") sessionId = value;
      parts.push(`${name}=${value}`);
    }

    const cookieHeader = parts.length ? parts.join("; ") : null;
    const result: StockxSessionHeaders | null = cookieHeader
      ? { cookie: cookieHeader, deviceId, sessionId, sessionFile }
      : null;
    cached = { value: result, at: Date.now() };
    return result;
  } catch {
    cached = { value: null, at: Date.now() };
    return null;
  }
}
