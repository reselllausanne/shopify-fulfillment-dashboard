import fs from "node:fs/promises";
import path from "node:path";

export const GALAXUS_STOCKX_SESSION_FILE = path.join(process.cwd(), ".data", "stockx-session-galaxus.json");
export const GALAXUS_STOCKX_TOKEN_FILE = path.join(process.cwd(), ".data", "stockx-token-galaxus.json");
export const GALAXUS_STOCKX_SESSION_META_FILE = path.join(
  process.cwd(),
  ".data",
  "stockx-session-meta-galaxus.json"
);
export const GALAXUS_STOCKX_PERSISTED_HASHES_FILE = path.join(
  process.cwd(),
  ".data",
  "stockx-persisted-hashes-galaxus.json"
);

type TokenPayload = {
  token: string;
  updatedAt: string;
};

const STOCKX_JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

/** True when JWT payload looks like StockX (not Supabase / other pasted noise). */
export function isStockxJwt(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  const iss = String(payload.iss ?? "");
  if (iss.includes("stockx.com")) return true;
  const aud = payload.aud;
  if (Array.isArray(aud) && aud.some((a) => String(a).includes("stockx"))) return true;
  if (typeof aud === "string" && aud.includes("stockx")) return true;
  return false;
}

/**
 * Manual paste sometimes appends a second JWT (e.g. Supabase) after the StockX bearer.
 * Extract the StockX JWT only so listStockxAccountTokens / GraphQL auth work.
 */
export function sanitizeStockxBearerToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim().replace(/^Bearer\s+/i, "");
  if (!value) return null;
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
    return value;
  }
  const matches = value.match(STOCKX_JWT_RE) ?? [];
  for (const candidate of matches) {
    if (isStockxJwt(candidate)) return candidate;
  }
  return matches[0] ?? null;
}

function normalizeToken(raw: string | null | undefined): string | null {
  return sanitizeStockxBearerToken(raw);
}

function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const payload = token.split(".")[1] || "";
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, any>;
  } catch {
    return null;
  }
}

function isTokenExpired(token: string, skewSeconds = 60): boolean {
  const payload = decodeJwtPayload(token);
  const exp = typeof payload?.exp === "number" ? payload.exp : null;
  if (!exp) return true;
  const now = Math.floor(Date.now() / 1000);
  return exp <= now + skewSeconds;
}

export async function readGalaxusStockxToken(tokenFile = GALAXUS_STOCKX_TOKEN_FILE): Promise<string | null> {
  try {
    const raw = await fs.readFile(tokenFile, "utf8");
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{")) {
      const parsed = JSON.parse(trimmed) as Partial<TokenPayload>;
      const token = normalizeToken(parsed?.token ?? null);
      if (!token || isTokenExpired(token)) return null;
      return token;
    }
    const token = normalizeToken(trimmed);
    if (!token || isTokenExpired(token)) return null;
    return token;
  } catch {
    return null;
  }
}

export async function writeGalaxusStockxToken(
  token: string,
  tokenFile = GALAXUS_STOCKX_TOKEN_FILE
): Promise<void> {
  const normalized = normalizeToken(token);
  if (!normalized) throw new Error("Invalid StockX token");
  await fs.mkdir(path.dirname(tokenFile), { recursive: true });
  const payload: TokenPayload = {
    token: normalized,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(tokenFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

