import fs from "node:fs/promises";
import path from "node:path";

export const GALAXUS_STOCKX_SESSION_FILE = path.join(process.cwd(), ".data", "stockx-session-galaxus.json");
export const GALAXUS_STOCKX_TOKEN_FILE = path.join(process.cwd(), ".data", "stockx-token-galaxus.json");

type TokenPayload = {
  token: string;
  updatedAt: string;
};

function normalizeToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim().replace(/^Bearer\s+/i, "");
  return value.length > 0 ? value : null;
}

export async function readGalaxusStockxToken(tokenFile = GALAXUS_STOCKX_TOKEN_FILE): Promise<string | null> {
  try {
    const raw = await fs.readFile(tokenFile, "utf8");
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{")) {
      const parsed = JSON.parse(trimmed) as Partial<TokenPayload>;
      return normalizeToken(parsed?.token ?? null);
    }
    return normalizeToken(trimmed);
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

