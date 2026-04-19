import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    const [total, byCategory, bySource, byConfidence, byStatus, lastGenerated] =
      await Promise.all([
        prisma.expectedCashEvent.count(),
        prisma.expectedCashEvent.groupBy({ by: ["category"], _count: { _all: true } }),
        prisma.expectedCashEvent.groupBy({ by: ["sourceType"], _count: { _all: true } }),
        prisma.expectedCashEvent.groupBy({ by: ["confidence"], _count: { _all: true } }),
        prisma.expectedCashEvent.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.expectedCashEvent.aggregate({ _max: { updatedAt: true } }),
      ]);

    return NextResponse.json({
      success: true,
      total,
      byCategory,
      bySource,
      byConfidence,
      byStatus,
      lastGeneratedAt: lastGenerated._max.updatedAt,
    });
  } catch (error: any) {
    console.error("[FINANCE][EXPECTED_CASH][STATS] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch expected cash stats", details: error.message },
      { status: 500 }
    );
  }
}
