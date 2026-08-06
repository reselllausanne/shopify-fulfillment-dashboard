import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { isPackageProtectionShopifyLine } from "@/app/utils/matching";
import { PACKAGE_PROTECTION_MATCH_TYPE } from "@/shopify/protection/upsertPackageProtectionMatches";

export const dynamic = 'force-dynamic';

/**
 * GET /api/db/matches
 * 
 * Retrieves all order matches from the database.
 * Query params:
 *   - synced: "true" | "false" | undefined (filter by metafields sync status)
 *   - confidence: "high" | "medium" | "low" (filter by match confidence)
 *   - includeProtection: "true" to include package-protection auto rows (hidden by default)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const syncedFilter = searchParams.get("synced");
    const confidenceFilter = searchParams.get("confidence");
    const includeProtection = searchParams.get("includeProtection") === "true";
    const limitParam = searchParams.get("limit");
    const limit =
      limitParam != null && limitParam !== ""
        ? Math.min(Math.max(Number(limitParam), 1), 5000)
        : undefined;

    const where: any = {};

    if (syncedFilter === "true") {
      where.shopifyMetafieldsSynced = true;
    } else if (syncedFilter === "false") {
      where.shopifyMetafieldsSynced = false;
    }

    if (confidenceFilter) {
      where.matchConfidence = confidenceFilter;
    }

    if (!includeProtection) {
      where.matchType = { not: PACKAGE_PROTECTION_MATCH_TYPE };
    }

    console.log(`[DB] Fetching matches with filters:`, where);

    const matches = await prisma.orderMatch.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...(limit != null ? { take: limit } : {}),
    });

    // Belt-and-suspenders: hide any legacy protection rows without matchType set.
    const visible = includeProtection
      ? matches
      : matches.filter(
          (m) => !isPackageProtectionShopifyLine(m.shopifyProductTitle, m.shopifySku)
        );

    console.log(`[DB] Found ${visible.length} matches`);

    // Parse matchReasons back to array
    const parsedMatches = visible.map((match: (typeof matches)[number]) => ({
      ...match,
      matchReasons: match.matchReasons ? JSON.parse(match.matchReasons) : [],
    }));

    return NextResponse.json({ matches: parsedMatches }, { status: 200 });
  } catch (error: any) {
    console.error("[DB] Error fetching matches:", error);
    return NextResponse.json(
      { error: "Failed to fetch matches", details: error.message },
      { status: 500 }
    );
  }
}


