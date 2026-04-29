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

function normalizeToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim().replace(/^Bearer\s+/i, "");
  return value.length > 0 ? value : null;
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

