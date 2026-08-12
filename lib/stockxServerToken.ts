import fs from "node:fs/promises";
import path from "node:path";
import {
  GALAXUS_STOCKX_TOKEN_FILE,
  readGalaxusStockxToken,
} from "@/lib/stockxGalaxusAuth";

export const DASHBOARD_STOCKX_TOKEN_FILE = path.join(
  process.cwd(),
  ".data",
  "stockx-token.json"
);

type TokenFilePayload = {
  token: string;
  updatedAt: string;
};

function normalizeToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = String(raw).trim().replace(/^Bearer\s+/i, "");
  return value.length > 0 ? value : null;
}

function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const payload = token.split(".")[1] || "";
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export function stockxTokenExpiresAt(token: string): Date | null {
  const exp = decodeJwtPayload(token)?.exp;
  return typeof exp === "number" ? new Date(exp * 1000) : null;
}

export async function writeServerStockxToken(
  token: string,
  tokenFile = DASHBOARD_STOCKX_TOKEN_FILE
): Promise<void> {
  const normalized = normalizeToken(token);
  if (!normalized) throw new Error("Invalid StockX token");
  await fs.mkdir(path.dirname(tokenFile), { recursive: true });
  const payload: TokenFilePayload = {
    token: normalized,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(tokenFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/**
 * Scheduled jobs have no browser to paste from, so they fall back to whichever stored bearer is
 * still inside its (12h) validity window: the dashboard file first, then the Galaxus one.
 */
export async function readServerStockxToken(): Promise<{
  token: string;
  source: "dashboard" | "galaxus";
  expiresAt: Date | null;
} | null> {
  const dashboard = await readGalaxusStockxToken(DASHBOARD_STOCKX_TOKEN_FILE);
  if (dashboard) {
    return { token: dashboard, source: "dashboard", expiresAt: stockxTokenExpiresAt(dashboard) };
  }
  const galaxus = await readGalaxusStockxToken(GALAXUS_STOCKX_TOKEN_FILE);
  if (galaxus) {
    return { token: galaxus, source: "galaxus", expiresAt: stockxTokenExpiresAt(galaxus) };
  }
  return null;
}
