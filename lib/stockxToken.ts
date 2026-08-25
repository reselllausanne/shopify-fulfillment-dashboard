import { prisma } from "@/app/lib/prisma";
import { readGalaxusStockxToken } from "@/lib/stockxGalaxusAuth";
import { readServerStockxToken, stockxTokenExpiresAt } from "@/lib/stockxServerToken";

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
