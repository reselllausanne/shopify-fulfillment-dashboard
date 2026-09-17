import fs from "node:fs/promises";
import path from "node:path";

const COOKIE_FILE = path.join(process.cwd(), ".data", "goat-cookie.json");
const SESSION_FILE = path.join(process.cwd(), ".data", "goat-session.json");

export type GoatCookieAuth = {
  cookie: string;
  csrfToken: string | null;
  updatedAt: string;
  source: "cookie-file" | "playwright-session";
};

async function ensureDir(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function cookieHeaderFromStorageState(session: unknown): string | null {
  if (!session || typeof session !== "object") return null;
  const cookies = (session as { cookies?: Array<{ name?: string; value?: string }> }).cookies;
  if (!Array.isArray(cookies) || cookies.length === 0) return null;
  const parts = cookies
    .map((c) => {
      const name = String(c?.name ?? "").trim();
      const value = String(c?.value ?? "").trim();
      if (!name || !value) return null;
      return `${name}=${value}`;
    })
    .filter((p): p is string => Boolean(p));
  return parts.length ? parts.join("; ") : null;
}

export async function saveGoatCookie(cookie: string, csrfToken?: string | null): Promise<GoatCookieAuth> {
  const cleaned = String(cookie ?? "").trim();
  if (!cleaned) throw new Error("Empty GOAT cookie");
  const payload: GoatCookieAuth = {
    cookie: cleaned,
    csrfToken: String(csrfToken ?? "").trim() || null,
    updatedAt: new Date().toISOString(),
    source: "cookie-file",
  };
  await ensureDir(COOKIE_FILE);
  await fs.writeFile(COOKIE_FILE, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

export async function loadGoatCookie(): Promise<GoatCookieAuth | null> {
  try {
    const raw = await fs.readFile(COOKIE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<GoatCookieAuth>;
    const cookie = String(parsed.cookie ?? "").trim();
    if (cookie) {
      return {
        cookie,
        csrfToken: String(parsed.csrfToken ?? "").trim() || null,
        updatedAt: String(parsed.updatedAt ?? ""),
        source: "cookie-file",
      };
    }
  } catch {
    // fall through to Playwright storageState
  }

  try {
    const raw = await fs.readFile(SESSION_FILE, "utf8");
    const session = JSON.parse(raw);
    const cookie = cookieHeaderFromStorageState(session);
    if (!cookie) return null;
    return {
      cookie,
      csrfToken: null,
      updatedAt: "",
      source: "playwright-session",
    };
  } catch {
    return null;
  }
}
