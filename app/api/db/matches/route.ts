import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const dynamic = 'force-dynamic';

/**
 * GET /api/db/matches
 * 
 * Retrieves all order matches from the database.
 * Query params:
 *   - synced: "true" | "false" | undefined (filter by metafields sync status)
 *   - confidence: "high" | "medium" | "low" (filter by match confidence)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const syncedFilter = searchParams.get("synced");
    const confidenceFilter = searchParams.get("confidence");

    const where: any = {};

    if (syncedFilter === "true") {
      where.shopifyMetafieldsSynced = true;
    } else if (syncedFilter === "false") {
      where.shopifyMetafieldsSynced = false;
    }

    if (confidenceFilter) {
      where.matchConfidence = confidenceFilter;
    }

    console.log(`[DB] Fetching matches with filters:`, where);

    const matches = await prisma.orderMatch.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    console.log(`[DB] Found ${matches.length} matches`);

    // Parse matchReasons back to array
    const parsedMatches = matches.map((match: (typeof matches)[number]) => ({
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


