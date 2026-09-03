import { prisma } from "@/app/lib/prisma";
import {
  GALAXUS_STOCKX_TOKEN_FILE,
  readGalaxusStockxToken,
} from "@/lib/stockxGalaxusAuth";
import {
  DASHBOARD_STOCKX_TOKEN_FILE,
  readServerStockxToken,
  stockxTokenExpiresAt,
} from "@/lib/stockxServerToken";

/**
 * Get the current valid Supplier token from database.
 * If no token or expired, returns null.
 */
export async function getSupplierToken(): Promise<string | null> {
  try {
    const tokenData = await prisma.stockXToken.findFirst({
      orderBy: { createdAt: "desc" },
      select: { token: true, expiresAt: true },
    });

    if (!tokenData) {
      console.warn("[TOKEN] No token found in database");
      return null;
    }

    const isExpired = new Date() > tokenData.expiresAt;

    if (isExpired) {
      console.warn("[TOKEN] Token expired, cron should refresh soon");
      return null;
    }

    return tokenData.token;
  } catch (error) {
    console.error("[TOKEN] Error fetching token:", error);
    return null;
  }
}

/** Persist bearer into StockXToken (same table backfill / cron use). */
export async function persistSupplierToken(token: string): Promise<void> {
  const cleaned = String(token || "")
    .trim()
    .replace(/^Bearer\s+/i, "");
  if (!cleaned) throw new Error("Invalid StockX token");
  const expiresAt = stockxTokenExpiresAt(cleaned) ?? new Date(Date.now() + 12 * 60 * 60 * 1000);
  await prisma.stockXToken.create({
    data: { token: cleaned, expiresAt },
  });
}

/**
 * One auth path for manual link, auto-link, and backfill:
 * 1) DB StockXToken (cron / dashboard refresh)
 * 2) dashboard file, then Galaxus file
 */
export async function resolveStockxBearerToken(): Promise<{
  token: string;
  source: "db" | "dashboard" | "galaxus";
} | null> {
  const db = await getSupplierToken();
  if (db) return { token: db, source: "db" };

  const file = await readServerStockxToken();
  if (!file) return null;
  return { token: file.token, source: file.source };
}

/** Galaxus direct-delivery / warehouse: prefer `.data/stockx-token-galaxus.json` over cron DB token. */
export async function resolveGalaxusStockxBearerToken(): Promise<{
  token: string;
  source: "galaxus" | "db" | "dashboard";
} | null> {
  const galaxus = await readGalaxusStockxToken();
  if (galaxus) return { token: galaxus, source: "galaxus" };
  return resolveStockxBearerToken();
}

/** JWT `customer_uuid` claim (lowercased), used to dedupe tokens that back the same account. */
function decodeCustomerUuid(token: string): string | null {
  try {
    const part = (token.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = part.padEnd(Math.ceil(part.length / 4) * 4, "=");
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<
      string,
      unknown
    >;
    const raw = payload["https://stockx.com/customer_uuid"];
    return typeof raw === "string" && raw.trim() ? raw.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

function looksLikeStockxJwt(value: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

export type StockxAccountToken = {
  token: string;
  source: "db" | "galaxus" | "dashboard";
  /** JWT `customer_uuid`, lowercased. `null` when the JWT can't be decoded. */
  customerUuid: string | null;
};

/**
 * Return one bearer per StockX account currently known to the server (dedup by
 * JWT `customer_uuid`). Used by AWB backfill / resync so a Galaxus warehouse
 * label that belongs to account B is not silently dropped when the DB happens
 * to hold account A's token this hour.
 *
 * Order: DB rows (newest first) → `.data/stockx-token.json` (dashboard) →
 * `.data/stockx-token-galaxus.json`. First occurrence wins per uuid so the
 * freshest bearer for each account is used.
 */
export async function listStockxAccountTokens(): Promise<StockxAccountToken[]> {
  const out: StockxAccountToken[] = [];
  const seenUuid = new Set<string>();
  const seenToken = new Set<string>();
  const push = (token: string | null | undefined, source: StockxAccountToken["source"]) => {
    const cleaned = String(token ?? "")
      .trim()
      .replace(/^Bearer\s+/i, "");
    if (!cleaned || seenToken.has(cleaned)) return;
    // Skip legacy non-JWT stubs (short opaque strings) — they can't authenticate
    // against StockX and would waste a retry slot for every buy lookup.
    if (!looksLikeStockxJwt(cleaned)) return;
    const uuid = decodeCustomerUuid(cleaned);
    if (uuid && seenUuid.has(uuid)) return;
    if (uuid) seenUuid.add(uuid);
    seenToken.add(cleaned);
    out.push({ token: cleaned, source, customerUuid: uuid });
  };

  try {
    const rows = await prisma.stockXToken.findMany({
      orderBy: { createdAt: "desc" },
      select: { token: true, expiresAt: true },
    });
    for (const row of rows) {
      if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) continue;
      push(row.token, "db");
    }
  } catch (error) {
    console.warn("[TOKEN] Failed to load StockXToken rows for multi-account:", error);
  }

  push(await readGalaxusStockxToken(DASHBOARD_STOCKX_TOKEN_FILE), "dashboard");
  push(await readGalaxusStockxToken(GALAXUS_STOCKX_TOKEN_FILE), "galaxus");

  return out;
}
