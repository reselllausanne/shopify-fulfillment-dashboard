import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { toCsv } from "@/galaxus/exports/csv";

export const dynamic = "force-dynamic";

function serializeValue(value: any): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * GET /api/db/matches/export
 *
 * Downloads all order matches as CSV.
 * Optional query params:
 *   - synced: "true" | "false"
 *   - confidence: "high" | "medium" | "low"
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

    const matches = await prisma.orderMatch.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    const headerSet = new Set<string>();
    for (const match of matches) {
      Object.keys(match).forEach((key) => headerSet.add(key));
    }
    const headers = Array.from(headerSet);

    const rows = matches.map((match) => {
      const row: Record<string, string> = {};
      for (const key of headers) {
        row[key] = serializeValue((match as any)[key]);
      }
      return row;
    });

    const csv = toCsv(headers, rows);
    const filename = `db-matches-${Date.now()}.csv`;
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    console.error("[DB] Error exporting matches:", error);
    return NextResponse.json(
      { error: "Failed to export matches", details: error.message },
      { status: 500 }
    );
  }
}

