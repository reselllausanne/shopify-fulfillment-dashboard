import { prisma } from "@/app/lib/prisma";

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

/**
 * Check if token needs refresh (expires in < 2 hours).
 */
export async function tokenNeedsRefresh(): Promise<boolean> {
  try {
    const tokenData = await prisma.stockXToken.findFirst({
      orderBy: { createdAt: "desc" },
      select: { expiresAt: true },
    });

    if (!tokenData) {
      return true; // No token = needs refresh
    }

    const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000);

    return new Date(tokenData.expiresAt) < twoHoursFromNow;
  } catch (error) {
    return true; // Error = assume needs refresh
  }
}

